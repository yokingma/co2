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
import type {
  NormalizedResponse,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionResponse,
  OpenAIChatChunkToolCall,
  OpenAIChatToolCall,
} from '../../shared/types.js'

function messageToParts(
  message: OpenAIChatCompletionResponse['choices'][number]['message'] | undefined,
): NormalizedResponse['message']['parts'] {
  if (!message) {
    return []
  }

  const parts: NormalizedResponse['message']['parts'] = []

  if (typeof message.content === 'string' && message.content.length > 0) {
    parts.push({
      type: 'text',
      text: message.content,
    })
  }

  for (const toolCall of message.tool_calls ?? []) {
    parts.push(toolCallToPart(toolCall))
  }

  return parts
}

function toolCallToPart(toolCall: OpenAIChatToolCall): Extract<NormalizedResponse['message']['parts'][number], { type: 'tool-call' }> {
  return {
    type: 'tool-call',
    id: toolCall.id,
    name: toolCall.function.name,
    argumentsJson: toolCall.function.arguments,
  }
}

function usageFromChat(response: OpenAIChatCompletionResponse | OpenAIChatCompletionChunk | undefined): NormalizedResponse['usage'] | undefined {
  const usage = response?.usage
  if (!usage) {
    return undefined
  }

  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  }
}

export function mapOpenAIChatCompletionToClaudeResponse(response: OpenAIChatCompletionResponse, publicModel: string): Record<string, unknown> {
  const firstChoice = response.choices[0]

  return buildClaudeMessagesResponse(
    {
      responseId: response.id,
      model: publicModel,
      message: {
        role: 'assistant',
        parts: messageToParts(firstChoice?.message),
      },
      finishReason: firstChoice?.finish_reason ?? undefined,
      usage: usageFromChat(response),
      status: 'completed',
    },
    publicModel,
  )
}

type ToolStreamState = {
  blockIndex: number
  started: boolean
  closed: boolean
  id: string
  name: string
}

export async function* encodeOpenAIChatCompletionStreamToClaude(
  stream: AsyncIterable<OpenAIChatCompletionChunk>,
  responseId: string,
  publicModel: string,
): AsyncIterable<string> {
  let started = false
  let nextBlockIndex = 0
  let textBlockIndex: number | undefined
  let textBlockClosed = false
  let sawToolCall = false
  let finalUsage: { input_tokens?: number; output_tokens?: number } | undefined
  let finalStopReason: 'tool_use' | 'max_tokens' | 'end_turn' | undefined
  const toolStates = new Map<number, ToolStreamState>()

  const ensureTextBlockStarted = () => {
    if (textBlockIndex !== undefined) {
      return undefined
    }

    textBlockIndex = nextBlockIndex
    nextBlockIndex += 1
    return createClaudeTextBlockStartEvent(textBlockIndex)
  }

  const ensureToolBlockStarted = (toolDelta: OpenAIChatChunkToolCall): string | undefined => {
    const toolCallIndex = toolDelta.index ?? 0
    const existing = toolStates.get(toolCallIndex)
    if (existing) {
      return undefined
    }

    const blockIndex = nextBlockIndex
    nextBlockIndex += 1
    const state: ToolStreamState = {
      blockIndex,
      started: true,
      closed: false,
      id: toolDelta.id ?? `tool_${toolCallIndex}`,
      name: toolDelta.function?.name ?? `tool_${toolCallIndex}`,
    }
    toolStates.set(toolCallIndex, state)
    return createClaudeToolBlockStartEvent(blockIndex, state.id, state.name)
  }

  for await (const chunk of stream) {
    if (!started) {
      started = true
      yield createClaudeMessageStartEvent(responseId, publicModel)
    }

    const usage = usageFromChat(chunk)
    if (usage) {
      finalUsage = {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
      }
    }

    for (const choice of chunk.choices) {
      if (choice.delta?.content) {
        const startEvent = ensureTextBlockStarted()
        if (startEvent) {
          yield startEvent
        }
        yield createClaudeTextDeltaEvent(textBlockIndex ?? 0, choice.delta.content)
      }

      for (const toolDelta of choice.delta?.tool_calls ?? []) {
        sawToolCall = true
        const startEvent = ensureToolBlockStarted(toolDelta)
        if (startEvent) {
          yield startEvent
        }

        const toolState = toolStates.get(toolDelta.index ?? 0)
        if (toolState && toolDelta.function?.arguments) {
          yield createClaudeToolInputDeltaEvent(toolState.blockIndex, toolDelta.function.arguments)
        }
      }

      if (choice.finish_reason) {
        if (textBlockIndex !== undefined && !textBlockClosed) {
          yield createClaudeContentBlockStopEvent(textBlockIndex)
          textBlockClosed = true
        }

        for (const toolState of toolStates.values()) {
          if (!toolState.closed) {
            yield createClaudeContentBlockStopEvent(toolState.blockIndex)
            toolState.closed = true
          }
        }

        finalStopReason = sawToolCall
          ? 'tool_use'
          : choice.finish_reason === 'length'
            ? 'max_tokens'
            : 'end_turn'
      }
    }
  }

  if (!started) {
    yield createClaudeMessageStartEvent(responseId, publicModel)
  }

  if (textBlockIndex !== undefined && !textBlockClosed) {
    yield createClaudeContentBlockStopEvent(textBlockIndex)
  }

  for (const toolState of toolStates.values()) {
    if (!toolState.closed) {
      yield createClaudeContentBlockStopEvent(toolState.blockIndex)
    }
  }

  yield createClaudeMessageDeltaEvent(finalStopReason ?? (sawToolCall ? 'tool_use' : 'end_turn'), finalUsage)

  yield createClaudeMessageStopEvent()
}
