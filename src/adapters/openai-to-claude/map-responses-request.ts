import { openAIResponsesSchema } from '../../schemas/openai/responses-schema.js'
import { buildAnthropicMessagesRequest, createTextPart } from '../shared.js'
import type { NormalizedMessage, NormalizedRequest, RuntimeConfig } from '../../shared/types.js'
import type { ToolChoice } from '../../shared/contracts.js'
import { createUnsupportedParameterError, createUnsupportedToolError } from '../../shared/errors.js'
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

function normalizeInputItems(input: string | ReturnType<typeof openAIResponsesSchema.parse>['input']): NormalizedMessage[] {
  if (typeof input === 'string') {
    return [{ role: 'user', parts: [createTextPart(input)] }]
  }

  return input.map((item) => {
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
        return {
          role: normalizedRole,
          parts: [createTextPart(item.content)],
        }
      }

      const contentParts = Array.isArray(item.content) ? item.content : []

      return {
        role: normalizedRole,
        parts: contentParts.flatMap((part: unknown) => isRecord(part) && typeof part.text === 'string' ? [createTextPart(part.text)] : []),
      }
    }

    if (item.type === 'function_call') {
      return {
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: item.call_id,
            name: item.name,
            argumentsJson: item.arguments,
          },
        ],
      }
    }

    return {
      role: 'user',
      parts: [
        {
          type: 'tool-result',
          toolCallId: item.call_id,
          output: item.output,
        },
      ],
    }
  })
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
  const messages = coalesceAnthropicTurns(normalizeInputItems(parsed.input))
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
    requestId,
  }
}

export function mapOpenAIResponsesToClaudeRequest(config: RuntimeConfig, request: NormalizedRequest) {
  return buildAnthropicMessagesRequest(config, request)
}
