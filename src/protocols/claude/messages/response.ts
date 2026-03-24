import { mapOpenAIFinishReasonToClaude } from '../../../shared/errors.js'
import { formatSseEvent } from '../../../shared/sse.js'
import { parseToolArguments } from '../../../adapters/shared.js'
import type { NormalizedContentPart, NormalizedResponse } from '../../../shared/types.js'

function createClaudeContent(response: NormalizedResponse): Record<string, unknown>[] {
  return response.message.parts.flatMap((part): Record<string, unknown>[] => {
    if (part.type === 'text') {
      return [{
        type: 'text',
        text: part.text,
      }]
    }

    if (part.type === 'tool-call') {
      return [{
        type: 'tool_use',
        id: part.id,
        name: part.name,
        input: parseToolArguments(part.argumentsJson),
      }]
    }

    return []
  })
}

export function buildClaudeMessagesResponse(response: NormalizedResponse, publicModel: string): Record<string, unknown> {
  const hasToolCalls = response.message.parts.some((part) => part.type === 'tool-call')
  return {
    id: response.responseId,
    type: 'message',
    role: 'assistant',
    model: publicModel,
    content: createClaudeContent(response),
    stop_reason: mapOpenAIFinishReasonToClaude(response.finishReason, hasToolCalls),
    stop_sequence: null,
    usage: response.usage
      ? {
          input_tokens: response.usage.inputTokens,
          output_tokens: response.usage.outputTokens,
        }
      : undefined,
  }
}

export function createClaudeMessageStartEvent(responseId: string, publicModel: string): string {
  return formatSseEvent('message_start', {
    type: 'message_start',
    message: {
      id: responseId,
      type: 'message',
      role: 'assistant',
      model: publicModel,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  })
}

export function createClaudeTextBlockStartEvent(index: number): string {
  return formatSseEvent('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'text',
      text: '',
    },
  })
}

export function createClaudeToolBlockStartEvent(index: number, id: string, name: string): string {
  return formatSseEvent('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'tool_use',
      id,
      name,
      input: {},
    },
  })
}

export function createClaudeTextDeltaEvent(index: number, text: string): string {
  return formatSseEvent('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: {
      type: 'text_delta',
      text,
    },
  })
}

export function createClaudeToolInputDeltaEvent(index: number, partialJson: string): string {
  return formatSseEvent('content_block_delta', {
    type: 'content_block_delta',
    index,
    delta: {
      type: 'input_json_delta',
      partial_json: partialJson,
    },
  })
}

export function createClaudeContentBlockStopEvent(index: number): string {
  return formatSseEvent('content_block_stop', {
    type: 'content_block_stop',
    index,
  })
}

export function createClaudeMessageDeltaEvent(
  stopReason: string,
  usage?: { input_tokens?: number; output_tokens?: number },
): string {
  return formatSseEvent('message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: usage ?? {},
  })
}

export function createClaudeMessageStopEvent(): string {
  return formatSseEvent('message_stop', {
    type: 'message_stop',
  })
}
