import { mapOpenAIFinishReasonToClaude } from '../../../shared/errors.js'
import { formatSseEvent } from '../../../shared/sse.js'
import { parseToolArguments } from '../../../adapters/shared.js'
import type { NormalizedContentPart, NormalizedResponse } from '../../../shared/types.js'

type ClaudeResponseUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number | null
  cache_read_input_tokens: number | null
  server_tool_use: null
  service_tier: null
  cache_creation: null
  inference_geo: null
  iterations: null
  speed: null
}

type ClaudeDeltaUsage = {
  input_tokens: number | null
  output_tokens: number
  cache_creation_input_tokens: number | null
  cache_read_input_tokens: number | null
  server_tool_use: null
  iterations: null
}

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

function createClaudeResponseUsage(usage: NormalizedResponse['usage'] | undefined): ClaudeResponseUsage {
  return {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    server_tool_use: null,
    service_tier: null,
    cache_creation: null,
    inference_geo: null,
    iterations: null,
    speed: null,
  }
}

function createClaudeDeltaUsage(
  usage?: { input_tokens?: number; output_tokens?: number },
): ClaudeDeltaUsage {
  return {
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? 0,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    server_tool_use: null,
    iterations: null,
  }
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
    usage: createClaudeResponseUsage(response.usage),
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
      usage: createClaudeResponseUsage(undefined),
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
    usage: createClaudeDeltaUsage(usage),
  })
}

export function createClaudeMessageStopEvent(): string {
  return formatSseEvent('message_stop', {
    type: 'message_stop',
  })
}
