import { buildOpenAIChatCompletionResponse, createChatDoneChunk, createChatFinishChunk, createChatStartChunk, createChatTextChunk, createChatToolArgumentsChunk, createChatToolStartChunk, createChatUsageChunk } from '../../protocols/openai/chat-completions/response.js'
import { createTextPart, extractUsageFromRecord, stringifyToolInput } from '../shared.js'
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

export function mapClaudeResponseToOpenAIChatResponse(
  response: ClaudeMessagesResponse,
  publicModel: string,
  toolNameAliases?: ToolNameAliases,
): Record<string, unknown> {
  return buildOpenAIChatCompletionResponse(
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

export async function* encodeClaudeStreamToOpenAIChat(
  stream: AsyncIterable<ClaudeStreamEvent>,
  responseId: string,
  publicModel: string,
  toolNameAliases?: ToolNameAliases,
  includeUsage = false,
): AsyncIterable<string> {
  const toolIndexes = new Map<number, number>()
  let nextToolIndex = 0
  let started = false
  let latestUsage: NormalizedResponse['usage'] | undefined

  for await (const event of stream) {
    if (event.type === 'message_start' && !started) {
      started = true
      const message = 'message' in event && typeof event.message === 'object' && event.message !== null
        ? event.message as Record<string, unknown>
        : undefined
      latestUsage = extractUsageFromRecord(message?.usage, latestUsage)
      yield createChatStartChunk(responseId, publicModel, includeUsage)
      continue
    }

    if (event.type === 'content_block_start') {
      const block = event.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use' && typeof event.index === 'number') {
        const toolIndex = nextToolIndex
        nextToolIndex += 1
        toolIndexes.set(event.index, toolIndex)
        yield createChatToolStartChunk(
          responseId,
          publicModel,
          toolIndex,
          String(block.id),
          fromAnthropicToolName(String(block.name), toolNameAliases),
          includeUsage,
        )
      }
      continue
    }

    if (event.type === 'content_block_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        yield createChatTextChunk(responseId, publicModel, delta.text, includeUsage)
      }
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string' && typeof event.index === 'number') {
        const toolIndex = toolIndexes.get(event.index) ?? 0
        yield createChatToolArgumentsChunk(responseId, publicModel, toolIndex, delta.partial_json, includeUsage)
      }
      continue
    }

    if (event.type === 'message_delta') {
      const delta = event.delta as Record<string, unknown> | undefined
      const usage = 'usage' in event && typeof event.usage === 'object' && event.usage !== null
        ? event.usage as Record<string, unknown>
        : undefined
      latestUsage = extractUsageFromRecord(usage, latestUsage)
      if (typeof delta?.stop_reason === 'string') {
        const finishReason = delta.stop_reason === 'tool_use' ? 'tool_calls' : delta.stop_reason === 'max_tokens' ? 'length' : 'stop'
        yield createChatFinishChunk(responseId, publicModel, finishReason, includeUsage)
      }
      continue
    }
  }

  if (!started) {
    yield createChatStartChunk(responseId, publicModel, includeUsage)
  }

  if (
    includeUsage
    && latestUsage?.inputTokens !== undefined
    && latestUsage.outputTokens !== undefined
    && latestUsage.totalTokens !== undefined
  ) {
    yield createChatUsageChunk(responseId, publicModel, {
      prompt_tokens: latestUsage.inputTokens,
      completion_tokens: latestUsage.outputTokens,
      total_tokens: latestUsage.totalTokens,
    })
  }

  yield createChatDoneChunk()
}
