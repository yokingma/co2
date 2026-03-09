import { openAIChatCompletionsSchema } from '../../schemas/openai/chat-completions-schema.js'
import { buildAnthropicMessagesRequest, createTextPart, normalizeStopSequences } from '../shared.js'
import type { NormalizedMessage, NormalizedRequest, RuntimeConfig } from '../../shared/types.js'
import type { ToolChoice } from '../../shared/contracts.js'

function normalizeToolChoice(toolChoice: string | { type: 'function'; function: { name: string } } | undefined): ToolChoice | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice as ToolChoice
  }

  return { name: toolChoice.function.name }
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
  const parsed = openAIChatCompletionsSchema.parse(body)
  return {
    mode,
    contract: 'chat-completions',
    transport: parsed.stream ? 'sse' : 'json',
    model: parsed.model,
    messages: normalizeMessages(parsed.messages),
    tools: (parsed.tools ?? []).map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: tool.function.parameters ?? { type: 'object', properties: {} },
    })),
    toolChoice: normalizeToolChoice(parsed.tool_choice),
    maxOutputTokens: parsed.max_completion_tokens,
    temperature: parsed.temperature,
    stopSequences: normalizeStopSequences(parsed.stop),
    requestId,
  }
}

export function mapOpenAIChatToClaudeRequest(config: RuntimeConfig, request: NormalizedRequest) {
  return buildAnthropicMessagesRequest(config, request)
}
