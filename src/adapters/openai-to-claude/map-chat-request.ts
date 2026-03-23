import { openAIChatCompletionsSchema } from '../../schemas/openai/chat-completions-schema.js'
import { buildAnthropicMessagesRequest, createTextPart, normalizeStopSequences } from '../shared.js'
import type { NormalizedMessage, NormalizedRequest, RuntimeConfig } from '../../shared/types.js'
import type { ToolChoice } from '../../shared/contracts.js'
import { createUnsupportedParameterError, createUnsupportedToolError } from '../../shared/errors.js'
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

  if (Array.isArray(body.modalities) && body.modalities.some((modality) => modality !== 'text')) {
    throw createUnsupportedParameterError('Only text output modalities are supported in V1', 'modalities')
  }

  if ('audio' in body && body.audio !== undefined) {
    throw createUnsupportedParameterError('Audio output is not supported in V1', 'audio')
  }

  const tools = Array.isArray(body.tools) ? body.tools : []
  for (const tool of tools) {
    if (isRecord(tool) && tool.type !== 'function') {
      throw createUnsupportedToolError('Only function tools are supported in V1')
    }
  }
}

function normalizeMessages(messages: ReturnType<typeof openAIChatCompletionsSchema.parse>['messages']): NormalizedMessage[] {
  return messages.map((message) => {
    if (message.role === 'system' || message.role === 'user') {
      return {
        role: message.role,
        parts: [createTextPart(message.content)],
      }
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
      return {
        role: 'assistant',
        parts,
      }
    }

    return {
      role: 'user',
      parts: [
        {
          type: 'tool-result',
          toolCallId: message.tool_call_id,
          output: message.content,
        },
      ],
    }
  })
}

export function normalizeOpenAIChatRequest(body: unknown, mode: RuntimeConfig['server']['mode'], requestId: string): NormalizedRequest {
  validateCompatibleOpenAIChatRequest(body)
  const parsed = openAIChatCompletionsSchema.parse(body)
  const messages = normalizeMessages(parsed.messages)
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
  const toolNameAliases = createAnthropicToolNameAliases(allTools, messages, toolChoice)

  return {
    mode,
    contract: 'chat-completions',
    transport: parsed.stream ? 'sse' : 'json',
    model: parsed.model,
    messages,
    tools: allTools,
    toolChoice,
    maxOutputTokens: parsed.max_completion_tokens ?? parsed.max_tokens,
    temperature: parsed.temperature,
    topP: parsed.top_p,
    stopSequences: normalizeStopSequences(parsed.stop),
    reasoning: parsed.reasoning_effort ? { effort: parsed.reasoning_effort } : undefined,
    toolNameAliases,
    requestId,
  }
}

export function mapOpenAIChatToClaudeRequest(config: RuntimeConfig, request: NormalizedRequest) {
  return buildAnthropicMessagesRequest(config, request)
}
