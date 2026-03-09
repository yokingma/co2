import {
  buildOpenAIResponsesResponse,
  createResponsesCompletedEvent,
  createResponsesCreatedEvent,
  createResponsesMessageItemAddedEvent,
  createResponsesOutputItemDoneEvent,
  createResponsesTextDeltaEvent,
  createResponsesTextDoneEvent,
  createResponsesToolArgsDeltaEvent,
  createResponsesToolArgsDoneEvent,
  createResponsesToolItemAddedEvent,
} from '../../protocols/openai/responses/response.js'
import { createTextPart, stringifyToolInput } from '../shared.js'
import type { ClaudeMessagesResponse, ClaudeStreamEvent, NormalizedResponse } from '../../shared/types.js'

function contentBlocksToParts(content: ClaudeMessagesResponse['content']): NormalizedResponse['message']['parts'] {
  return content.flatMap((block) => {
    if (block.type === 'text') {
      return [createTextPart(block.text)]
    }

    if (block.type === 'tool_use') {
      return [{
        type: 'tool-call' as const,
        id: block.id,
        name: block.name,
        argumentsJson: stringifyToolInput(block.input),
      }]
    }

    return []
  })
}

export function mapClaudeResponseToOpenAIResponsesResponse(response: ClaudeMessagesResponse, publicModel: string): Record<string, unknown> {
  return buildOpenAIResponsesResponse(
    {
      responseId: response.id,
      model: publicModel,
      message: {
        role: 'assistant',
        parts: contentBlocksToParts(response.content),
      },
      finishReason: response.stop_reason ?? undefined,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0),
          }
        : undefined,
      status: 'completed',
    },
    publicModel,
  )
}

export async function* encodeClaudeStreamToOpenAIResponses(stream: AsyncIterable<ClaudeStreamEvent>, responseId: string, publicModel: string): AsyncIterable<string> {
  let started = false
  let currentMessageItemId = `${responseId}_message`
  let textBuffer = ''
  const toolItems = new Map<number, { itemId: string; name: string; argumentsJson: string }>()

  for await (const event of stream) {
    if (event.type === 'message_start' && !started) {
      started = true
      yield createResponsesCreatedEvent(responseId, publicModel)
      continue
    }

    if (event.type === 'content_block_start') {
      const block = event.content_block as Record<string, unknown> | undefined
      if (block?.type === 'text') {
        yield createResponsesMessageItemAddedEvent(responseId, currentMessageItemId)
      }
      if (block?.type === 'tool_use' && typeof event.index === 'number') {
        const itemId = String(block.id)
        toolItems.set(event.index, {
          itemId,
          name: String(block.name),
          argumentsJson: '',
        })
        yield createResponsesToolItemAddedEvent(responseId, event.index, itemId, String(block.name))
      }
      continue
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        textBuffer += delta.text
        yield createResponsesTextDeltaEvent(currentMessageItemId, delta.text)
      }
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && typeof event.index === 'number') {
        const toolItem = toolItems.get(event.index)
        const itemId = toolItem?.itemId ?? `${responseId}_tool_${event.index}`
        if (toolItem) {
          toolItem.argumentsJson += delta.partial_json
        }
        yield createResponsesToolArgsDeltaEvent(itemId, delta.partial_json)
      }
      continue
    }

    if (event.type === 'content_block_stop' && typeof event.index === 'number') {
      const toolItem = toolItems.get(event.index)
      if (toolItem) {
        yield createResponsesToolArgsDoneEvent(toolItem.itemId, toolItem.argumentsJson)
        yield createResponsesOutputItemDoneEvent(responseId, event.index, {
          type: 'function_call',
          id: toolItem.itemId,
          call_id: toolItem.itemId,
          name: toolItem.name,
          arguments: toolItem.argumentsJson,
          status: 'completed',
        })
      } else if (textBuffer.length > 0) {
        yield createResponsesTextDoneEvent(currentMessageItemId, textBuffer)
        yield createResponsesOutputItemDoneEvent(responseId, 0, {
          type: 'message',
          id: currentMessageItemId,
          role: 'assistant',
          status: 'completed',
          content: [{
            type: 'output_text',
            text: textBuffer,
            annotations: [],
          }],
        })
      }
      continue
    }
  }

  if (!started) {
    yield createResponsesCreatedEvent(responseId, publicModel)
  }
  yield createResponsesCompletedEvent(responseId, publicModel)
}
