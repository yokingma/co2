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
import type { ClaudeMessagesResponse, ClaudeStreamEvent, NormalizedResponse, ToolNameAliases } from '../../shared/types.js'
import { fromAnthropicToolName } from './tool-name-aliasing.js'

function contentBlocksToParts(
  content: ClaudeMessagesResponse['content'],
  toolNameAliases: ToolNameAliases | undefined,
): NormalizedResponse['message']['parts'] {
  return content.flatMap((block) => {
    if (block.type === 'text') {
      return [createTextPart(block.text)]
    }

    if (block.type === 'tool_use') {
      return [{
        type: 'tool-call' as const,
        id: block.id,
        name: fromAnthropicToolName(block.name, toolNameAliases),
        argumentsJson: stringifyToolInput(block.input),
      }]
    }

    return []
  })
}

export function mapClaudeResponseToOpenAIResponsesResponse(
  response: ClaudeMessagesResponse,
  publicModel: string,
  toolNameAliases?: ToolNameAliases,
): Record<string, unknown> {
  return buildOpenAIResponsesResponse(
    {
      responseId: response.id,
      model: publicModel,
      message: {
        role: 'assistant',
        parts: contentBlocksToParts(response.content, toolNameAliases),
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

export async function* encodeClaudeStreamToOpenAIResponses(
  stream: AsyncIterable<ClaudeStreamEvent>,
  responseId: string,
  publicModel: string,
  toolNameAliases?: ToolNameAliases,
): AsyncIterable<string> {
  let started = false
  let sequenceNumber = 1
  const toolItems = new Map<number, { itemId: string; name: string; argumentsJson: string }>()
  const textItems = new Map<number, { itemId: string; text: string }>()
  const outputItems = new Map<number, Record<string, unknown>>()
  let createdAt: number | undefined

  const nextSequenceNumber = (): number => {
    const value = sequenceNumber
    sequenceNumber += 1
    return value
  }

  const resolveCreatedAt = (): number => {
    // OpenAI treats response.created and response.completed as snapshots of the
    // same logical resource, so created_at must stay stable across the stream.
    createdAt ??= Math.floor(Date.now() / 1000)
    return createdAt
  }

  const getTextItemId = (outputIndex: number): string =>
    outputIndex === 0 ? `${responseId}_message` : `${responseId}_message_${outputIndex}`

  for await (const event of stream) {
    if (event.type === 'message_start' && !started) {
      started = true
      yield createResponsesCreatedEvent(responseId, publicModel, nextSequenceNumber(), resolveCreatedAt())
      continue
    }

    if (event.type === 'content_block_start') {
      const block = event.content_block as Record<string, unknown> | undefined
      if (block?.type === 'text') {
        const outputIndex = typeof event.index === 'number' ? event.index : 0
        const itemId = getTextItemId(outputIndex)
        const item = {
          type: 'message',
          id: itemId,
          role: 'assistant',
          status: 'in_progress',
          content: [{
            type: 'output_text',
            text: '',
            annotations: [],
          }],
        }
        textItems.set(outputIndex, { itemId, text: '' })
        outputItems.set(outputIndex, item)
        // Preserve Claude's content-block index so mixed tool/text streams keep
        // a stable output ordering for OpenAI Responses consumers.
        yield createResponsesMessageItemAddedEvent(responseId, itemId, outputIndex, nextSequenceNumber())
      }
      if (block?.type === 'tool_use' && typeof event.index === 'number') {
        const itemId = String(block.id)
        const outputIndex = event.index
        const restoredToolName = fromAnthropicToolName(String(block.name), toolNameAliases)
        toolItems.set(event.index, {
          itemId,
          name: restoredToolName,
          argumentsJson: '',
        })
        outputItems.set(outputIndex, {
          type: 'function_call',
          id: itemId,
          call_id: itemId,
          name: restoredToolName,
          arguments: '',
          status: 'in_progress',
        })
        yield createResponsesToolItemAddedEvent(responseId, outputIndex, itemId, restoredToolName, nextSequenceNumber())
      }
      continue
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        const outputIndex = typeof event.index === 'number' ? event.index : 0
        const textItem = textItems.get(outputIndex)
        if (textItem) {
          textItem.text += delta.text
        }
        const outputItem = outputItems.get(outputIndex)
        if (outputItem?.type === 'message') {
          const content = Array.isArray(outputItem.content) ? outputItem.content : []
          const firstPart = content[0]
          if (firstPart && typeof firstPart === 'object' && firstPart.type === 'output_text' && typeof firstPart.text === 'string') {
            firstPart.text += delta.text
          }
        }
        yield createResponsesTextDeltaEvent(
          textItem?.itemId ?? getTextItemId(outputIndex),
          delta.text,
          outputIndex,
          0,
          nextSequenceNumber(),
        )
      }
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && typeof event.index === 'number') {
        const toolItem = toolItems.get(event.index)
        const itemId = toolItem?.itemId ?? `${responseId}_tool_${event.index}`
        if (toolItem) {
          toolItem.argumentsJson += delta.partial_json
        }
        const outputItem = outputItems.get(event.index)
        if (outputItem?.type === 'function_call' && typeof outputItem.arguments === 'string') {
          outputItem.arguments += delta.partial_json
        }
        yield createResponsesToolArgsDeltaEvent(itemId, delta.partial_json, event.index, nextSequenceNumber())
      }
      continue
    }

    if (event.type === 'content_block_stop' && typeof event.index === 'number') {
      const toolItem = toolItems.get(event.index)
      if (toolItem) {
        const completedItem = {
          type: 'function_call',
          id: toolItem.itemId,
          call_id: toolItem.itemId,
          name: toolItem.name,
          arguments: toolItem.argumentsJson,
          status: 'completed',
        }
        outputItems.set(event.index, completedItem)
        yield createResponsesToolArgsDoneEvent(toolItem.itemId, toolItem.argumentsJson, toolItem.name, event.index, nextSequenceNumber())
        yield createResponsesOutputItemDoneEvent(responseId, event.index, completedItem, nextSequenceNumber())
      } else {
        const textItem = textItems.get(event.index)
        if (!textItem || textItem.text.length === 0) {
          continue
        }
        const completedItem = {
          type: 'message',
          id: textItem.itemId,
          role: 'assistant',
          status: 'completed',
          content: [{
            type: 'output_text',
            text: textItem.text,
            annotations: [],
          }],
        }
        outputItems.set(event.index, completedItem)
        yield createResponsesTextDoneEvent(textItem.itemId, textItem.text, event.index, 0, nextSequenceNumber())
        yield createResponsesOutputItemDoneEvent(responseId, event.index, completedItem, nextSequenceNumber())
      }
      continue
    }
  }

  if (!started) {
    yield createResponsesCreatedEvent(responseId, publicModel, nextSequenceNumber(), resolveCreatedAt())
  }
  const finalizedOutput = Array.from(outputItems.entries())
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, item]) => item)
  yield createResponsesCompletedEvent(
    responseId,
    publicModel,
    finalizedOutput,
    nextSequenceNumber(),
    resolveCreatedAt(),
  )
}
