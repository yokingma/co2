import { formatSseEvent } from '../../../shared/sse.js'
import type { NormalizedContentPart, NormalizedResponse } from '../../../shared/types.js'

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

export function createResponsesCreatedEvent(responseId: string, publicModel: string): string {
  return formatSseEvent('response.created', {
    type: 'response.created',
    response: {
      id: responseId,
      object: 'response',
      status: 'in_progress',
      model: publicModel,
    },
  })
}

export function createResponsesMessageItemAddedEvent(responseId: string, itemId: string): string {
  return formatSseEvent('response.output_item.added', {
    type: 'response.output_item.added',
    response_id: responseId,
    output_index: 0,
    item: {
      type: 'message',
      id: itemId,
      role: 'assistant',
      status: 'in_progress',
      content: [],
    },
  })
}

export function createResponsesToolItemAddedEvent(responseId: string, outputIndex: number, itemId: string, name: string): string {
  return formatSseEvent('response.output_item.added', {
    type: 'response.output_item.added',
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

export function createResponsesTextDeltaEvent(itemId: string, text: string): string {
  return formatSseEvent('response.output_text.delta', {
    type: 'response.output_text.delta',
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    delta: text,
  })
}

export function createResponsesTextDoneEvent(itemId: string, text: string): string {
  return formatSseEvent('response.output_text.done', {
    type: 'response.output_text.done',
    item_id: itemId,
    output_index: 0,
    content_index: 0,
    text,
  })
}

export function createResponsesToolArgsDeltaEvent(itemId: string, delta: string): string {
  return formatSseEvent('response.function_call_arguments.delta', {
    type: 'response.function_call_arguments.delta',
    item_id: itemId,
    output_index: 0,
    delta,
  })
}

export function createResponsesToolArgsDoneEvent(itemId: string, argumentsJson: string): string {
  return formatSseEvent('response.function_call_arguments.done', {
    type: 'response.function_call_arguments.done',
    item_id: itemId,
    output_index: 0,
    arguments: argumentsJson,
  })
}

export function createResponsesOutputItemDoneEvent(responseId: string, outputIndex: number, item: Record<string, unknown>): string {
  return formatSseEvent('response.output_item.done', {
    type: 'response.output_item.done',
    response_id: responseId,
    output_index: outputIndex,
    item,
  })
}

export function createResponsesCompletedEvent(responseId: string, publicModel: string): string {
  return formatSseEvent('response.completed', {
    type: 'response.completed',
    response: {
      id: responseId,
      object: 'response',
      status: 'completed',
      model: publicModel,
    },
  })
}
