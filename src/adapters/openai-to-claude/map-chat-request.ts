import { openAIChatCompletionsSchema } from '../../schemas/openai/chat-completions-schema.js'
import { buildAnthropicMessagesRequest, createNormalizationWarning, createTextPart, normalizeStopSequences, parseOpenAIImageUrl } from '../shared.js'
import type { NormalizationWarning, NormalizedMessage, NormalizedRequest, RuntimeConfig } from '../../shared/types.js'
import type { ToolChoice } from '../../shared/contracts.js'
import { createUnsupportedParameterError, createUnsupportedToolError, createValidationError } from '../../shared/errors.js'
import { createAnthropicToolNameAliases } from './tool-name-aliasing.js'

function normalizeToolChoice(toolChoice: string | { type: 'function'; function: { name: string } } | undefined): ToolChoice | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice as ToolChoice
  }

  return { name: toolChoice.function.name }
}

function normalizeLegacyFunctionCall(toolChoice: string | { name: string } | undefined): ToolChoice | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice as ToolChoice
  }

  return { name: toolChoice.name }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateCompatibleOpenAIChatRequest(body: unknown): void {
  if (!isRecord(body)) {
    return
  }

  if (body.parallel_tool_calls === true) {
    throw createUnsupportedParameterError(
      'parallel_tool_calls=true is not supported in V1; only sequential tool use is supported',
      'parallel_tool_calls',
    )
  }

  const tools = Array.isArray(body.tools) ? body.tools : []
  for (const tool of tools) {
    if (isRecord(tool) && tool.type !== 'function') {
      throw createUnsupportedToolError('Only function tools are supported in V1')
    }
  }
}

function sanitizeCompatibleOpenAIChatRequest(body: unknown): { body: unknown; warnings: NormalizationWarning[] } {
  if (!isRecord(body)) {
    return { body, warnings: [] }
  }

  const warnings: NormalizationWarning[] = []
  const sanitizedBody: Record<string, unknown> = { ...body }

  if (Array.isArray(body.modalities) && body.modalities.some((modality) => modality !== 'text')) {
    delete sanitizedBody.modalities
    warnings.push(createNormalizationWarning('modalities', 'Only text output modalities are supported in V1'))
  }

  if ('audio' in body && body.audio !== undefined) {
    delete sanitizedBody.audio
    warnings.push(createNormalizationWarning('audio', 'Audio output is not supported in V1'))
  }

  return {
    body: sanitizedBody,
    warnings,
  }
}

function ensureMessageHasParts(parts: NormalizedMessage['parts'], path: string): void {
  if (parts.length === 0) {
    throw createValidationError('Message must contain at least one supported content part', path)
  }
}

function normalizeMessages(
  messages: ReturnType<typeof openAIChatCompletionsSchema.parse>['messages'],
): { messages: NormalizedMessage[]; warnings: NormalizationWarning[] } {
  const normalizedMessages: NormalizedMessage[] = []
  const warnings: NormalizationWarning[] = []

  for (const [messageIndex, message] of messages.entries()) {
    if (message.role === 'system') {
      normalizedMessages.push({
        role: 'system',
        parts: [createTextPart(message.content)],
      })
      continue
    }

    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        normalizedMessages.push({
          role: 'user',
          parts: [createTextPart(message.content)],
        })
        continue
      }

      const parts: NormalizedMessage['parts'] = []
      for (const [partIndex, part] of message.content.entries()) {
        const path = `messages[${messageIndex}].content[${partIndex}]`

        if (part.type === 'text') {
          parts.push(createTextPart(part.text))
          continue
        }

        if (part.image_url.detail !== undefined) {
          warnings.push(createNormalizationWarning(`${path}.image_url.detail`, 'Image detail is not supported in V1 and was ignored'))
        }

        const parsedImage = parseOpenAIImageUrl(part.image_url.url)
        if (parsedImage.part) {
          parts.push(parsedImage.part)
          continue
        }

        warnings.push(createNormalizationWarning(path, parsedImage.reason ?? 'Unsupported image input'))
      }

      ensureMessageHasParts(parts, `messages[${messageIndex}].content`)
      normalizedMessages.push({
        role: 'user',
        parts,
      })
      continue
    }

    if (message.role === 'assistant') {
      const parts = [] as NormalizedMessage['parts']
      if (message.content) {
        parts.push(createTextPart(message.content))
      }
      for (const toolCall of message.tool_calls ?? []) {
        parts.push({
          type: 'tool-call',
          id: toolCall.id,
          name: toolCall.function.name,
          argumentsJson: toolCall.function.arguments,
        })
      }
      normalizedMessages.push({
        role: 'assistant',
        parts,
      })
      continue
    }

    normalizedMessages.push({
      role: 'user',
      parts: [
        {
          type: 'tool-result',
          toolCallId: message.tool_call_id,
          output: message.content,
        },
      ],
    })
  }

  return {
    messages: normalizedMessages,
    warnings,
  }
}

export function normalizeOpenAIChatRequest(body: unknown, mode: RuntimeConfig['server']['mode'], requestId: string): NormalizedRequest {
  const sanitizedRequest = sanitizeCompatibleOpenAIChatRequest(body)
  validateCompatibleOpenAIChatRequest(sanitizedRequest.body)
  const parsed = openAIChatCompletionsSchema.parse(sanitizedRequest.body)
  const normalizedMessages = normalizeMessages(parsed.messages)
  const normalizedTools = (parsed.tools ?? []).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: tool.function.parameters ?? { type: 'object', properties: {} },
  }))
  const legacyFunctions = (parsed.functions ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters ?? { type: 'object', properties: {} },
  }))
  const allTools = normalizedTools.length > 0 ? normalizedTools : legacyFunctions
  const toolChoice =
    normalizeToolChoice(parsed.tool_choice)
    ?? normalizeLegacyFunctionCall(parsed.function_call)
    ?? (allTools.length > 0 ? 'auto' : undefined)
  const toolNameAliases = createAnthropicToolNameAliases(allTools, normalizedMessages.messages, toolChoice)

  return {
    mode,
    contract: 'chat-completions',
    transport: parsed.stream ? 'sse' : 'json',
    model: parsed.model,
    messages: normalizedMessages.messages,
    tools: allTools,
    toolChoice,
    maxOutputTokens: parsed.max_completion_tokens ?? parsed.max_tokens,
    temperature: parsed.temperature,
    topP: parsed.top_p,
    stopSequences: normalizeStopSequences(parsed.stop),
    reasoning: parsed.reasoning_effort ? { effort: parsed.reasoning_effort } : undefined,
    streamIncludeUsage: parsed.stream_options?.include_usage,
    toolNameAliases,
    warnings: [...sanitizedRequest.warnings, ...normalizedMessages.warnings],
    requestId,
  }
}

export function mapOpenAIChatToClaudeRequest(config: RuntimeConfig, request: NormalizedRequest) {
  return buildAnthropicMessagesRequest(config, request)
}
