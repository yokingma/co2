import { openAIResponsesSchema } from '../../schemas/openai/responses-schema.js'
import { buildAnthropicMessagesRequest, createNormalizationWarning, createTextPart, parseOpenAIImageUrl } from '../shared.js'
import type { NormalizationWarning, NormalizedMessage, NormalizedRequest, RuntimeConfig } from '../../shared/types.js'
import type { ToolChoice } from '../../shared/contracts.js'
import { createUnsupportedParameterError, createUnsupportedToolError, createValidationError } from '../../shared/errors.js'
import { createAnthropicToolNameAliases } from './tool-name-aliasing.js'

function normalizeToolChoice(toolChoice: string | { type: 'function'; name: string } | undefined): ToolChoice | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice as ToolChoice
  }

  return { name: toolChoice.name }
}

function ensureMessageHasParts(parts: NormalizedMessage['parts'], path: string): void {
  if (parts.length === 0) {
    throw createValidationError('Message must contain at least one supported content part', path)
  }
}

function normalizeInputItems(
  input: string | ReturnType<typeof openAIResponsesSchema.parse>['input'],
): { messages: NormalizedMessage[]; warnings: NormalizationWarning[] } {
  if (typeof input === 'string') {
    return {
      messages: [{ role: 'user', parts: [createTextPart(input)] }],
      warnings: [],
    }
  }

  const messages: NormalizedMessage[] = []
  const warnings: NormalizationWarning[] = []

  for (const [itemIndex, item] of input.entries()) {
    if ('role' in item) {
      const normalizedRole: NormalizedMessage['role'] =
        item.role === 'tool'
          ? 'user'
          : item.role === 'developer'
            ? 'system'
            : item.role === 'system' || item.role === 'user' || item.role === 'assistant'
              ? item.role
              : 'user'

      if (typeof item.content === 'string') {
        messages.push({
          role: normalizedRole,
          parts: [createTextPart(item.content)],
        })
        continue
      }

      const contentParts = Array.isArray(item.content) ? item.content : []
      const parts: NormalizedMessage['parts'] = []

      for (const [partIndex, part] of contentParts.entries()) {
        if (!isRecord(part)) {
          continue
        }

        const path = `input[${itemIndex}].content[${partIndex}]`

        if (typeof part.text === 'string') {
          parts.push(createTextPart(part.text))
          continue
        }

        if (part.type === 'input_image') {
          if (typeof part.file_id === 'string') {
            throw createUnsupportedParameterError(
              'input_image.file_id is not supported in V1; use image_url or data:image/...;base64,... instead',
              `${path}.file_id`,
            )
          }

          if (part.detail !== undefined) {
            warnings.push(createNormalizationWarning(`${path}.detail`, 'Image detail is not supported in V1 and was ignored'))
          }

          if (typeof part.image_url !== 'string') {
            throw createValidationError('input_image must include image_url', `${path}.image_url`)
          }

          if (normalizedRole !== 'user') {
            warnings.push(createNormalizationWarning(path, 'Image content is only supported on user messages'))
            continue
          }

          const parsedImage = parseOpenAIImageUrl(part.image_url)
          if (parsedImage.part) {
            parts.push(parsedImage.part)
            continue
          }

          warnings.push(createNormalizationWarning(path, parsedImage.reason ?? 'Unsupported image input'))
        }
      }

      ensureMessageHasParts(parts, `input[${itemIndex}].content`)
      messages.push({
        role: normalizedRole,
        parts,
      })
      continue
    }

    if (item.type === 'function_call') {
      messages.push({
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: item.call_id,
            name: item.name,
            argumentsJson: item.arguments,
          },
        ],
      })
      continue
    }

    messages.push({
      role: 'user',
      parts: [
        {
          type: 'tool-result',
          toolCallId: item.call_id,
          output: item.output,
        },
      ],
    })
  }

  return {
    messages,
    warnings,
  }
}

function coalesceAnthropicTurns(messages: NormalizedMessage[]): NormalizedMessage[] {
  const coalesced: NormalizedMessage[] = []

  for (const message of messages) {
    const previousMessage = coalesced.at(-1)
    if (previousMessage && previousMessage.role === message.role && message.role !== 'system') {
      previousMessage.parts.push(...message.parts)
      continue
    }

    coalesced.push({
      role: message.role,
      parts: [...message.parts],
    })
  }

  return coalesced
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateCompatibleOpenAIResponsesRequest(body: unknown): void {
  if (!isRecord(body)) {
    return
  }

  if (body.previous_response_id !== undefined && body.previous_response_id !== null) {
    throw createUnsupportedParameterError('previous_response_id is not supported in V1', 'previous_response_id')
  }

  if (body.conversation !== undefined && body.conversation !== null) {
    throw createUnsupportedParameterError('conversation state is not supported in V1', 'conversation')
  }

  if (body.parallel_tool_calls === true) {
    throw createUnsupportedParameterError(
      'parallel_tool_calls=true is not supported in V1; only sequential tool use is supported',
      'parallel_tool_calls',
    )
  }

  if (body.text !== undefined && body.text !== null) {
    throw createUnsupportedParameterError('text response configuration is not supported in V1', 'text')
  }

  const tools = Array.isArray(body.tools) ? body.tools : []
  for (const tool of tools) {
    if (isRecord(tool) && tool.type !== 'function') {
      throw createUnsupportedToolError('Only function tools are supported in V1')
    }
  }
}

export function normalizeOpenAIResponsesRequest(body: unknown, mode: RuntimeConfig['server']['mode'], requestId: string): NormalizedRequest {
  validateCompatibleOpenAIResponsesRequest(body)
  const parsed = openAIResponsesSchema.parse(body)
  const normalizedInput = normalizeInputItems(parsed.input)
  const messages = coalesceAnthropicTurns(normalizedInput.messages)
  const normalizedTools = (parsed.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters ?? { type: 'object', properties: {} },
  }))
  const toolChoice = normalizeToolChoice(parsed.tool_choice) ?? (normalizedTools.length > 0 ? 'auto' : undefined)
  const toolNameAliases = createAnthropicToolNameAliases(normalizedTools, messages, toolChoice)

  return {
    mode,
    contract: 'responses',
    transport: parsed.stream ? 'sse' : 'json',
    model: parsed.model,
    messages,
    tools: normalizedTools,
    toolChoice,
    maxOutputTokens: parsed.max_output_tokens,
    temperature: parsed.temperature,
    topP: parsed.top_p,
    instructions: parsed.instructions,
    reasoning: parsed.reasoning ? {
      effort: parsed.reasoning.effort,
      summary: parsed.reasoning.summary ?? parsed.reasoning.generate_summary,
    } : undefined,
    toolNameAliases,
    warnings: normalizedInput.warnings,
    requestId,
  }
}

export function mapOpenAIResponsesToClaudeRequest(config: RuntimeConfig, request: NormalizedRequest) {
  return buildAnthropicMessagesRequest(config, request)
}
