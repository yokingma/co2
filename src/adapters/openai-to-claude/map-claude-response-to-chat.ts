import { buildOpenAIChatCompletionResponse, createChatDoneChunk, createChatFinishChunk, createChatStartChunk, createChatTextChunk, createChatToolArgumentsChunk, createChatToolStartChunk } from '../../protocols/openai/chat-completions/response.js'
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

export function mapClaudeResponseToOpenAIChatResponse(response: ClaudeMessagesResponse, publicModel: string): Record<string, unknown> {
  return buildOpenAIChatCompletionResponse(
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

export async function* encodeClaudeStreamToOpenAIChat(stream: AsyncIterable<ClaudeStreamEvent>, responseId: string, publicModel: string): AsyncIterable<string> {
  const toolIndexes = new Map<number, number>()
  let nextToolIndex = 0
  let started = false

  for await (const event of stream) {
    if (event.type === 'message_start' && !started) {
      started = true
      yield createChatStartChunk(responseId, publicModel)
      continue
    }

    if (event.type === 'content_block_start') {
      const block = event.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use' && typeof event.index === 'number') {
        const toolIndex = nextToolIndex
        nextToolIndex += 1
        toolIndexes.set(event.index, toolIndex)
        yield createChatToolStartChunk(responseId, publicModel, toolIndex, String(block.id), String(block.name))
      }
      continue
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        yield createChatTextChunk(responseId, publicModel, delta.text)
      }
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && typeof event.index === 'number') {
        const toolIndex = toolIndexes.get(event.index) ?? 0
        yield createChatToolArgumentsChunk(responseId, publicModel, toolIndex, delta.partial_json)
      }
      continue
    }

    if (event.type === 'message_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      if (typeof delta?.stop_reason === 'string') {
        const finishReason = delta.stop_reason === 'tool_use' ? 'tool_calls' : delta.stop_reason === 'max_tokens' ? 'length' : 'stop'
        yield createChatFinishChunk(responseId, publicModel, finishReason)
      }
      continue
    }
  }

  if (!started) {
    yield createChatStartChunk(responseId, publicModel)
  }

  yield createChatDoneChunk()
}
