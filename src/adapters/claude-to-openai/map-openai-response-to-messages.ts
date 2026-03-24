import {
  buildClaudeMessagesResponse,
  createClaudeContentBlockStopEvent,
  createClaudeMessageDeltaEvent,
  createClaudeMessageStartEvent,
  createClaudeMessageStopEvent,
  createClaudeTextBlockStartEvent,
  createClaudeTextDeltaEvent,
  createClaudeToolBlockStartEvent,
  createClaudeToolInputDeltaEvent,
} from '../../protocols/claude/messages/response.js'
import { createTextPart, extractUsageFromRecord } from '../shared.js'
import type { NormalizedResponse, OpenAIResponsesResponse, OpenAIResponsesStreamEvent } from '../../shared/types.js'

function outputItemsToParts(output: OpenAIResponsesResponse['output']): NormalizedResponse['message']['parts'] {
  return output.flatMap((item) => {
    if (item.type === 'message') {
      return item.content.map((part) => createTextPart(part.text))
    }

    if (item.type === 'function_call') {
      return [{
        type: 'tool-call' as const,
        id: item.call_id,
        name: item.name,
        argumentsJson: item.arguments,
      }]
    }

    return []
  })
}

export function mapOpenAIResponsesToClaudeResponse(response: OpenAIResponsesResponse, publicModel: string): Record<string, unknown> {
  const hasToolCalls = response.output.some((item) => item.type === 'function_call')
  return buildClaudeMessagesResponse(
    {
      responseId: response.id,
      model: publicModel,
      message: {
        role: 'assistant',
        parts: outputItemsToParts(response.output),
      },
      finishReason: hasToolCalls ? 'tool_calls' : 'stop',
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
      status: response.status === 'failed' ? 'failed' : 'completed',
    },
    publicModel,
  )
}

export async function* encodeOpenAIResponsesStreamToClaude(stream: AsyncIterable<OpenAIResponsesStreamEvent>, responseId: string, publicModel: string): AsyncIterable<string> {
  let started = false
  let textBlockIndex = 0
  const toolIndexes = new Map<string, number>()
  let nextIndex = 0
  let sawToolCall = false
  let finalUsage: { input_tokens?: number; output_tokens?: number } | undefined

  for await (const event of stream) {
    if (event.type === 'response.created' && !started) {
      started = true
      yield createClaudeMessageStartEvent(responseId, publicModel)
      continue
    }

    if (event.type === 'response.output_item.added') {
      const item = event.item as Record<string, unknown> | undefined
      if (item?.type === 'message') {
        textBlockIndex = nextIndex
        nextIndex += 1
        yield createClaudeTextBlockStartEvent(textBlockIndex)
      }
      if (item?.type === 'function_call') {
        sawToolCall = true
        const toolIndex = nextIndex
        nextIndex += 1
        const itemId = String(item.id ?? item.call_id ?? `tool_${toolIndex}`)
        toolIndexes.set(itemId, toolIndex)
        yield createClaudeToolBlockStartEvent(toolIndex, String(item.call_id ?? itemId), String(item.name ?? itemId))
      }
      continue
    }

    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      yield createClaudeTextDeltaEvent(textBlockIndex, event.delta)
      continue
    }

    if (event.type === 'response.output_text.done') {
      yield createClaudeContentBlockStopEvent(textBlockIndex)
      continue
    }

    if (event.type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
      const itemId = String(event.item_id ?? '')
      const toolIndex = toolIndexes.get(itemId) ?? 0
      yield createClaudeToolInputDeltaEvent(toolIndex, event.delta)
      continue
    }

    if (event.type === 'response.function_call_arguments.done') {
      const itemId = String(event.item_id ?? '')
      const toolIndex = toolIndexes.get(itemId) ?? 0
      yield createClaudeContentBlockStopEvent(toolIndex)
      continue
    }

    if (event.type === 'response.completed') {
      const response = 'response' in event && typeof event.response === 'object' && event.response !== null
        ? event.response as Record<string, unknown>
        : undefined
      const usage = extractUsageFromRecord(response?.usage)
      if (usage) {
        finalUsage = {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
        }
      }
      continue
    }
  }

  if (!started) {
    yield createClaudeMessageStartEvent(responseId, publicModel)
  }
  yield createClaudeMessageDeltaEvent(sawToolCall ? 'tool_use' : 'end_turn', finalUsage)
  yield createClaudeMessageStopEvent()
}
