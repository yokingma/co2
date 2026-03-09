import { openAIResponsesSchema } from '../../schemas/openai/responses-schema.js'
import { buildAnthropicMessagesRequest, createTextPart } from '../shared.js'
import type { NormalizedMessage, NormalizedRequest, RuntimeConfig } from '../../shared/types.js'
import type { ToolChoice } from '../../shared/contracts.js'

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
      if (typeof item.content === 'string') {
        return {
          role: item.role === 'tool' ? 'user' : item.role,
          parts: [createTextPart(item.content)],
        }
      }

      return {
        role: item.role === 'tool' ? 'user' : item.role,
        parts: item.content.map((part) => createTextPart(part.text)),
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

export function normalizeOpenAIResponsesRequest(body: unknown, mode: RuntimeConfig['server']['mode'], requestId: string): NormalizedRequest {
  const parsed = openAIResponsesSchema.parse(body)
  const normalizedTools = (parsed.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters ?? { type: 'object', properties: {} },
  }))

  return {
    mode,
    contract: 'responses',
    transport: parsed.stream ? 'sse' : 'json',
    model: parsed.model,
    messages: normalizeInputItems(parsed.input),
    tools: normalizedTools,
    toolChoice: normalizeToolChoice(parsed.tool_choice) ?? (normalizedTools.length > 0 ? 'auto' : undefined),
    maxOutputTokens: parsed.max_output_tokens,
    temperature: parsed.temperature,
    instructions: parsed.instructions,
    reasoning: parsed.reasoning ? {
      effort: parsed.reasoning.effort,
      summary: parsed.reasoning.summary ?? parsed.reasoning.generate_summary,
    } : undefined,
    requestId,
  }
}

export function mapOpenAIResponsesToClaudeRequest(config: RuntimeConfig, request: NormalizedRequest) {
  return buildAnthropicMessagesRequest(config, request)
}
