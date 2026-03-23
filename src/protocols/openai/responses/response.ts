import { formatSseEvent } from '../../../shared/sse.js'
import type { NormalizedContentPart, NormalizedResponse } from '../../../shared/types.js'

function buildStreamingResponseResource(
  responseId: string,
  publicModel: string,
  status: 'in_progress' | 'completed',
  output: Record<string, unknown>[],
  createdAt: number,
): Record<string, unknown> {
  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    model: publicModel,
    output,
    output_text: output
      .filter((item) => item.type === 'message')
      .flatMap((item) => {
        const content = Array.isArray(item.content) ? item.content : []
        return content
      })
      .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join(''),
  }
}

function createMessageItem(id: string, textParts: Extract<NormalizedContentPart, { type: 'text' }>[]): Record<string, unknown> | undefined {
  if (textParts.length === 0) {
    return undefined
  }

  return {
    type: 'message',
    id,
    status: 'completed',
    role: 'assistant',
    content: textParts.map((part) => ({
      type: 'output_text',
      text: part.text,
      annotations: [],
    })),
  }
}

function createFunctionCallItems(parts: NormalizedContentPart[]): Record<string, unknown>[] {
  return parts
    .filter((part): part is Extract<NormalizedContentPart, { type: 'tool-call' }> => part.type === 'tool-call')
    .map((part) => ({
      type: 'function_call',
      id: part.id,
      call_id: part.id,
      name: part.name,
      arguments: part.argumentsJson,
      status: 'completed',
    }))
}

export function buildOpenAIResponsesResponse(response: NormalizedResponse, publicModel: string): Record<string, unknown> {
  const textParts = response.message.parts.filter(
    (part): part is Extract<NormalizedContentPart, { type: 'text' }> => part.type === 'text',
  )
  const output: Record<string, unknown>[] = []
  const messageItem = createMessageItem(`${response.responseId}_message`, textParts)

  if (messageItem) {
    output.push(messageItem)
  }

  output.push(...createFunctionCallItems(response.message.parts))

  return {
    id: response.responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: response.status,
    model: publicModel,
    output,
    usage: response.usage
      ? {
          input_tokens: response.usage.inputTokens,
          output_tokens: response.usage.outputTokens,
          total_tokens: response.usage.totalTokens,
        }
      : undefined,
  }
}

export function createResponsesCreatedEvent(
  responseId: string,
  publicModel: string,
  sequenceNumber: number,
  createdAt: number,
): string {
  return formatSseEvent('response.created', {
    type: 'response.created',
    sequence_number: sequenceNumber,
    response: buildStreamingResponseResource(responseId, publicModel, 'in_progress', [], createdAt),
  })
}

export function createResponsesMessageItemAddedEvent(responseId: string, itemId: string, outputIndex: number, sequenceNumber: number): string {
  return formatSseEvent('response.output_item.added', {
    type: 'response.output_item.added',
    sequence_number: sequenceNumber,
    response_id: responseId,
    output_index: outputIndex,
    item: {
      type: 'message',
      id: itemId,
      role: 'assistant',
      status: 'in_progress',
      content: [{
        type: 'output_text',
        text: '',
        annotations: [],
      }],
    },
  })
}

export function createResponsesToolItemAddedEvent(responseId: string, outputIndex: number, itemId: string, name: string, sequenceNumber: number): string {
  return formatSseEvent('response.output_item.added', {
    type: 'response.output_item.added',
    sequence_number: sequenceNumber,
    response_id: responseId,
    output_index: outputIndex,
    item: {
      type: 'function_call',
      id: itemId,
      call_id: itemId,
      name,
      arguments: '',
      status: 'in_progress',
    },
  })
}

export function createResponsesTextDeltaEvent(itemId: string, text: string, outputIndex: number, contentIndex: number, sequenceNumber: number): string {
  return formatSseEvent('response.output_text.delta', {
    type: 'response.output_text.delta',
    sequence_number: sequenceNumber,
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
    delta: text,
    logprobs: [],
  })
}

export function createResponsesTextDoneEvent(itemId: string, text: string, outputIndex: number, contentIndex: number, sequenceNumber: number): string {
  return formatSseEvent('response.output_text.done', {
    type: 'response.output_text.done',
    sequence_number: sequenceNumber,
    item_id: itemId,
    output_index: outputIndex,
    content_index: contentIndex,
    text,
    logprobs: [],
  })
}

export function createResponsesToolArgsDeltaEvent(itemId: string, delta: string, outputIndex: number, sequenceNumber: number): string {
  return formatSseEvent('response.function_call_arguments.delta', {
    type: 'response.function_call_arguments.delta',
    sequence_number: sequenceNumber,
    item_id: itemId,
    output_index: outputIndex,
    delta,
  })
}

export function createResponsesToolArgsDoneEvent(
  itemId: string,
  argumentsJson: string,
  name: string,
  outputIndex: number,
  sequenceNumber: number,
): string {
  return formatSseEvent('response.function_call_arguments.done', {
    type: 'response.function_call_arguments.done',
    sequence_number: sequenceNumber,
    item_id: itemId,
    output_index: outputIndex,
    arguments: argumentsJson,
    name,
  })
}

export function createResponsesOutputItemDoneEvent(responseId: string, outputIndex: number, item: Record<string, unknown>, sequenceNumber: number): string {
  return formatSseEvent('response.output_item.done', {
    type: 'response.output_item.done',
    sequence_number: sequenceNumber,
    response_id: responseId,
    output_index: outputIndex,
    item,
  })
}

export function createResponsesCompletedEvent(
  responseId: string,
  publicModel: string,
  output: Record<string, unknown>[],
  sequenceNumber: number,
  createdAt: number,
): string {
  return formatSseEvent('response.completed', {
    type: 'response.completed',
    sequence_number: sequenceNumber,
    response: buildStreamingResponseResource(responseId, publicModel, 'completed', output, createdAt),
  })
}
