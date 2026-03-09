import { formatDataOnlySse } from '../../../shared/sse.js'
import { mapAnthropicStopReasonToOpenAI } from '../../../shared/errors.js'
import type { NormalizedContentPart, NormalizedResponse } from '../../../shared/types.js'

function contentText(parts: NormalizedContentPart[]): string | null {
  const text = parts
    .filter((part): part is Extract<NormalizedContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')

  return text.length > 0 ? text : null
}

function toolCalls(parts: NormalizedContentPart[]): Record<string, unknown>[] | undefined {
  const calls = parts
    .filter((part): part is Extract<NormalizedContentPart, { type: 'tool-call' }> => part.type === 'tool-call')
    .map((part) => ({
      id: part.id,
      type: 'function',
      function: {
        name: part.name,
        arguments: part.argumentsJson,
      },
    }))

  return calls.length > 0 ? calls : undefined
}

export function buildOpenAIChatCompletionResponse(response: NormalizedResponse, publicModel: string): Record<string, unknown> {
  const calls = toolCalls(response.message.parts)
  const finishReason = mapAnthropicStopReasonToOpenAI(response.finishReason, Boolean(calls))
  return {
    id: response.responseId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: publicModel,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: contentText(response.message.parts),
          ...(calls ? { tool_calls: calls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: response.usage
      ? {
          prompt_tokens: response.usage.inputTokens,
          completion_tokens: response.usage.outputTokens,
          total_tokens: response.usage.totalTokens,
        }
      : undefined,
  }
}

function baseChunk(responseId: string, publicModel: string, delta: Record<string, unknown>, finishReason: string | null): Record<string, unknown> {
  return {
    id: responseId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: publicModel,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  }
}

export function createChatStartChunk(responseId: string, publicModel: string): string {
  return formatDataOnlySse(baseChunk(responseId, publicModel, { role: 'assistant' }, null))
}


export function createChatTextChunk(responseId: string, publicModel: string, text: string): string {
  return formatDataOnlySse(baseChunk(responseId, publicModel, { content: text }, null))
}

export function createChatToolStartChunk(responseId: string, publicModel: string, toolIndex: number, toolCallId: string, name: string): string {
  return formatDataOnlySse(
    baseChunk(
      responseId,
      publicModel,
      {
        tool_calls: [
          {
            index: toolIndex,
            id: toolCallId,
            type: 'function',
            function: {
              name,
              arguments: '',
            },
          },
        ],
      },
      null,
    ),
  )
}

export function createChatToolArgumentsChunk(responseId: string, publicModel: string, toolIndex: number, delta: string): string {
  return formatDataOnlySse(
    baseChunk(
      responseId,
      publicModel,
      {
        tool_calls: [
          {
            index: toolIndex,
            function: {
              arguments: delta,
            },
          },
        ],
      },
      null,
    ),
  )
}

export function createChatFinishChunk(responseId: string, publicModel: string, finishReason: string): string {
  return formatDataOnlySse(baseChunk(responseId, publicModel, {}, finishReason))
}

export function createChatDoneChunk(): string {
  return 'data: [DONE]\n\n'
}
