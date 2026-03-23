import type { ClaudeMessagesRequest, ClaudeMessagesResponse, ClaudeStreamEvent, Logger, OpenAIResponsesRequest, OpenAIResponsesResponse, OpenAIResponsesStreamEvent, RuntimeConfig } from '../src/shared/types.js'
import type { ClaudeUpstreamClient } from '../src/upstream/claude-client.js'
import type { OpenAIUpstreamClient } from '../src/upstream/openai-client.js'

export type CapturedLogEntry = {
  level: 'info' | 'error'
  message: string
  data?: Record<string, unknown>
}

export function createRuntimeConfig(mode: RuntimeConfig['server']['mode']): RuntimeConfig {
  return {
    server: {
      host: '127.0.0.1',
      port: 8000,
      mode,
      logLevel: 'debug',
    },
    providers: {
      openai: {
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.com/v1',
      },
      anthropic: {
        apiKey: 'anthropic-key',
        baseUrl: 'https://api.anthropic.com',
        version: '2023-06-01',
      },
    },
    routing: {
      defaultOpenAIModel: 'gpt-4.1',
      defaultClaudeModel: 'claude-sonnet-4-20250514',
      claudeOutputEffort: undefined,
      openAIReasoningEffort: undefined,
    },
    modelMap: {
      'gpt-4.1': 'claude-sonnet-4-20250514',
      'gpt-4.1-mini': 'claude-haiku-4-20250514',
      'claude-sonnet-4-20250514': 'gpt-4.1',
      'claude-haiku-4-20250514': 'gpt-4.1-mini',
    },
  }
}

export function createSilentLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  }
}

export function createCapturingLogger(): { entries: CapturedLogEntry[]; logger: Logger } {
  const entries: CapturedLogEntry[] = []

  return {
    entries,
    logger: {
      debug() {},
      info(message, data) {
        entries.push({ level: 'info', message, data })
      },
      warn() {},
      error(message, data) {
        entries.push({ level: 'error', message, data })
      },
    },
  }
}

export function createClaudeClient(options: {
  createMessage?: (request: ClaudeMessagesRequest) => Promise<ClaudeMessagesResponse>
  streamMessage?: (request: ClaudeMessagesRequest) => Promise<AsyncIterable<ClaudeStreamEvent>>
}): ClaudeUpstreamClient {
  return {
    createMessage: options.createMessage ?? (async () => ({
      id: 'msg_default',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    })),
    streamMessage: options.streamMessage ?? (async () => emptyAsyncIterable<ClaudeStreamEvent>()),
  }
}

export function createOpenAIClient(options: {
  createResponse?: (request: OpenAIResponsesRequest) => Promise<OpenAIResponsesResponse>
  streamResponse?: (request: OpenAIResponsesRequest) => Promise<AsyncIterable<OpenAIResponsesStreamEvent>>
}): OpenAIUpstreamClient {
  return {
    createResponse: options.createResponse ?? (async () => ({
      id: 'resp_default',
      object: 'response',
      status: 'completed',
      model: 'gpt-4.1',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    })),
    streamResponse: options.streamResponse ?? (async () => emptyAsyncIterable<OpenAIResponsesStreamEvent>()),
  }
}

export async function* fromArray<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item
  }
}

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  return
}
