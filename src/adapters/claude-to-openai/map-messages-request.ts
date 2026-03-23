import { claudeMessagesSchema } from '../../schemas/claude/messages-schema.js'
import { buildOpenAIResponsesRequest, createTextPart, mapClaudeThinkingToOpenAIReasoning, stringifyToolInput } from '../shared.js'
import type { NormalizedContentPart, NormalizedMessage, NormalizedRequest, RuntimeConfig } from '../../shared/types.js'
import type { ToolChoice } from '../../shared/contracts.js'
import { createUnsupportedParameterError, createUnsupportedToolError } from '../../shared/errors.js'

function normalizeToolChoice(toolChoice: ReturnType<typeof claudeMessagesSchema.parse>['tool_choice']): ToolChoice | undefined {
  if (!toolChoice || toolChoice.type === 'none') {
    return toolChoice?.type
  }

  if (toolChoice.type === 'auto') {
    return 'auto'
  }

  if (toolChoice.type === 'any') {
    return 'required'
  }

  return { name: toolChoice.name }
}

function normalizeBlocks(role: 'user' | 'assistant', content: string | ReturnType<typeof claudeMessagesSchema.parse>['messages'][number]['content']): NormalizedContentPart[] {
  if (typeof content === 'string') {
    return [createTextPart(content)]
  }

  return content.flatMap((block): NormalizedContentPart[] => {
    if (block.type === 'text') {
      return [createTextPart(block.text)]
    }

    if (block.type === 'tool_use') {
      return [{
        type: 'tool-call',
        id: block.id,
        name: block.name,
        argumentsJson: stringifyToolInput(block.input),
      }]
    }

    return [{
      type: 'tool-result',
      toolCallId: block.tool_use_id,
      output: typeof block.content === 'string' ? block.content : block.content.map((part) => part.text).join(''),
      isError: block.is_error,
    }]
  })
}

function normalizeMessages(parsed: ReturnType<typeof claudeMessagesSchema.parse>): NormalizedMessage[] {
  const messages: NormalizedMessage[] = []

  if (parsed.system) {
    messages.push({
      role: 'system',
      parts: typeof parsed.system === 'string' ? [createTextPart(parsed.system)] : parsed.system.map((block) => createTextPart(block.text)),
    })
  }

  for (const message of parsed.messages) {
    messages.push({
      role: message.role,
      parts: normalizeBlocks(message.role, message.content),
    })
  }

  return messages
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateCompatibleClaudeMessagesRequest(body: unknown): void {
  if (!isRecord(body)) {
    return
  }

  if (body.top_k !== undefined) {
    throw createUnsupportedParameterError('top_k is not supported because there is no accurate OpenAI Responses equivalent in V1', 'top_k')
  }

  const tools = Array.isArray(body.tools) ? body.tools : []
  for (const tool of tools) {
    if (isRecord(tool) && typeof tool.type === 'string') {
      throw createUnsupportedToolError('Only client-defined tools are supported in V1')
    }
  }
}

export function normalizeClaudeMessagesRequest(body: unknown, mode: RuntimeConfig['server']['mode'], requestId: string): NormalizedRequest {
  validateCompatibleClaudeMessagesRequest(body)
  const parsed = claudeMessagesSchema.parse(body)
  const normalizedTools = (parsed.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
  }))

  return {
    mode,
    contract: 'messages',
    transport: parsed.stream ? 'sse' : 'json',
    model: parsed.model,
    messages: normalizeMessages(parsed),
    tools: normalizedTools,
    toolChoice: normalizeToolChoice(parsed.tool_choice) ?? (normalizedTools.length > 0 ? 'auto' : undefined),
    maxOutputTokens: parsed.max_tokens,
    temperature: parsed.temperature,
    topP: parsed.top_p,
    stopSequences: parsed.stop_sequences,
    reasoning: mapClaudeThinkingToOpenAIReasoning(parsed.thinking ? parsed.thinking.type === 'enabled' ? { type: 'enabled', budgetTokens: parsed.thinking.budget_tokens } : { type: parsed.thinking.type } : undefined),
    requestId,
  }
}

export function mapClaudeMessagesToOpenAIResponsesRequest(config: RuntimeConfig, request: NormalizedRequest) {
  return buildOpenAIResponsesRequest(config, request)
}
