import { describe, expect, it, vi } from 'vitest'
import { createServer } from '../../src/server/create-server.js'
import { createClaudeClient, createOpenAIClient, createRuntimeConfig, createSilentLogger, fromArray } from '../helpers.js'

describe('stream bridge', () => {
  it('streams Claude text as chat completion chunks', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => fromArray([
          { type: 'message_start' },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
          { type: 'message_stop' },
        ]),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('chat.completion.chunk')
    expect(response.body).toContain('[DONE]')
    await server.close()
  })

  it('streams Claude text as OpenAI responses events', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => fromArray([
          { type: 'message_start' },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_stop' },
        ]),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('response.created')
    expect(response.body).toContain('"output":[]')
    expect(response.body).toContain('"content":[{"type":"output_text","text":"","annotations":[]}]')
    expect(response.body).toContain('response.output_text.delta')
    expect(response.body).toContain('"logprobs":[]')
    expect(response.body).toContain('"sequence_number":')
    expect(response.body).toContain('"status":"completed"')
    expect(response.body).toContain('"output":[{"type":"message"')
    expect(response.body).toContain('response.completed')
    await server.close()
  })

  it('preserves tool name and arguments in OpenAI responses stream items', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => fromArray([
          { type: 'message_start' },
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'get_weather', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":"Shang' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'hai"}' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_stop' },
        ]),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'call tool' }] }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('"name":"get_weather"')
    expect(response.body).toContain('"arguments":"{\\"city\\":\\"Shanghai\\"}"')
    expect(response.body).toContain('response.function_call_arguments.done')
    expect(response.body).toContain('"name":"get_weather"')
    expect(response.body).toContain('"sequence_number":')
    await server.close()
  })

  it('restores original dotted tool names in OpenAI responses stream items', async () => {
    const originalToolName = 'functions.exec_command'
    let upstreamToolName = ''

    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async (request) => {
          upstreamToolName = request.tools?.[0]?.name ?? ''
          return fromArray([
            { type: 'message_start' },
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: upstreamToolName, input: {} } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"cmd":"pwd"}' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_stop' },
          ])
        },
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'call tool' }] }],
        tools: [{ type: 'function', name: originalToolName, parameters: { type: 'object' } }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(upstreamToolName).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
    expect(upstreamToolName).not.toBe(originalToolName)
    expect(response.body).toContain(`"name":"${originalToolName}"`)
    expect(response.body).not.toContain(`"name":"${upstreamToolName}"`)
    await server.close()
  })

  it('restores original dotted tool names in chat completion stream chunks', async () => {
    const originalToolName = 'multi_tool_use.parallel'
    let upstreamToolName = ''

    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async (request) => {
          upstreamToolName = request.tools?.[0]?.name ?? ''
          return fromArray([
            { type: 'message_start' },
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: upstreamToolName, input: {} } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"tool_uses":[]}' } },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
            { type: 'message_stop' },
          ])
        },
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'call tool' }],
        tools: [{
          type: 'function',
          function: {
            name: originalToolName,
            parameters: { type: 'object' },
          },
        }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(upstreamToolName).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
    expect(upstreamToolName).not.toBe(originalToolName)
    expect(response.body).toContain(`"name":"${originalToolName}"`)
    expect(response.body).not.toContain(`"name":"${upstreamToolName}"`)
    await server.close()
  })

  it('keeps distinct output indexes when Claude streams tool use before text', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => fromArray([
          { type: 'message_start' },
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_1', name: 'get_weather', input: {} } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":"Shanghai"}' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Done.' } },
          { type: 'content_block_stop', index: 1 },
          { type: 'message_stop' },
        ]),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('"item_id":"call_1"')
    expect(response.body).toContain('"output_index":0,"item":{"type":"function_call"')
    expect(response.body).toContain('"output_index":1,"item":{"type":"message"')
    expect(response.body).toContain('"item_id":"req-1_message_1"')
    expect(response.body).toContain('"output_index":1,"content_index":0,"delta":"Done."')
    expect(response.body).toContain('"output":[{"type":"function_call"')
    expect(response.body).toContain('{"type":"message","id":"req-1_message_1"')
    await server.close()
  })

  it('keeps one created_at across response.created and response.completed events', async () => {
    const originalDateNow = Date.now
    const timestamps = [1_700_000_000_000, 1_700_000_001_000]
    let index = 0
    vi.spyOn(Date, 'now').mockImplementation(() => timestamps[Math.min(index++, timestamps.length - 1)] ?? originalDateNow())

    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => fromArray([
          { type: 'message_start' },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_stop' },
        ]),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        stream: true,
      },
    })

    vi.restoreAllMocks()

    expect(response.statusCode).toBe(200)
    const createdMatch = response.body.match(/response\.created[\s\S]*?"created_at":(\d+)/)
    const completedMatch = response.body.match(/response\.completed[\s\S]*?"created_at":(\d+)/)
    expect(createdMatch?.[1]).toBeDefined()
    expect(completedMatch?.[1]).toBe(createdMatch?.[1])
    await server.close()
  })

  it('includes usage in the final OpenAI responses completed event for streamed Claude output', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => fromArray([
          {
            type: 'message_start',
            message: {
              id: 'msg_usage',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-20250514',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 11, output_tokens: 1 },
            },
          },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: {
              input_tokens: 11,
              output_tokens: 7,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
              server_tool_use: null,
            },
          },
          { type: 'message_stop' },
        ]),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('"usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18}')
    await server.close()
  })

  it('includes usage in the final Claude message_delta for streamed OpenAI responses output', async () => {
    const server = createServer(createRuntimeConfig('claude-to-openai'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({
        streamResponse: async () => fromArray([
          {
            type: 'response.created',
            response: {
              id: 'resp_1',
              object: 'response',
              created_at: 1_700_000_000,
              status: 'in_progress',
              model: 'gpt-4.1',
              output: [],
              output_text: '',
            },
          },
          { type: 'response.output_item.added', item: { type: 'message', id: 'msg_1' } },
          { type: 'response.output_text.delta', delta: 'hello' },
          { type: 'response.output_text.done' },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              object: 'response',
              created_at: 1_700_000_000,
              status: 'completed',
              model: 'gpt-4.1',
              output: [{
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'hello', annotations: [] }],
              }],
              output_text: 'hello',
              usage: {
                input_tokens: 11,
                output_tokens: 7,
                total_tokens: 18,
              },
            },
          },
        ]),
      }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('"type":"message_delta"')
    expect(response.body).toContain('"usage":{"input_tokens":11,"output_tokens":7}')
    await server.close()
  })

  it('emits a final chat usage chunk when stream_options.include_usage is enabled', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => fromArray([
          {
            type: 'message_start',
            message: {
              id: 'msg_chat_usage',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-20250514',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 11, output_tokens: 1 },
            },
          },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: {
              input_tokens: 11,
              output_tokens: 7,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
              server_tool_use: null,
            },
          },
          { type: 'message_stop' },
        ]),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
        stream_options: {
          include_usage: true,
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('"finish_reason":"stop"')
    expect(response.body).toContain('"choices":[]')
    expect(response.body).toContain('"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}')
    await server.close()
  })

  it('does not emit a chat usage chunk when stream_options.include_usage is omitted', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => fromArray([
          {
            type: 'message_start',
            message: {
              id: 'msg_chat_no_usage',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-20250514',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 11, output_tokens: 1 },
            },
          },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: {
              input_tokens: 11,
              output_tokens: 7,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
              server_tool_use: null,
            },
          },
          { type: 'message_stop' },
        ]),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('"choices":[]')
    expect(response.body).not.toContain('"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}')
    await server.close()
  })

  it('does not emit a chat usage chunk when stream_options.include_usage is false', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => fromArray([
          {
            type: 'message_start',
            message: {
              id: 'msg_chat_no_usage_false',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-20250514',
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 11, output_tokens: 1 },
            },
          },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: {
              input_tokens: 11,
              output_tokens: 7,
              cache_creation_input_tokens: null,
              cache_read_input_tokens: null,
              server_tool_use: null,
            },
          },
          { type: 'message_stop' },
        ]),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
        stream_options: {
          include_usage: false,
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('"choices":[]')
    expect(response.body).not.toContain('"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}')
    await server.close()
  })

  it('emits in-band SSE error after stream has started', async () => {
    async function* brokenStream(): AsyncIterable<Record<string, unknown>> {
      yield { type: 'message_start' }
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } }
      throw new Error('boom')
    }

    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        streamMessage: async () => brokenStream(),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('event: error')
    expect(response.body).toContain('boom')
    await server.close()
  })

  it('streams OpenAI responses events as Claude events', async () => {
    const server = createServer(createRuntimeConfig('claude-to-openai'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({
        streamResponse: async () => fromArray([
          { type: 'response.created' },
          { type: 'response.output_item.added', item: { type: 'message', id: 'msg_1' } },
          { type: 'response.output_text.delta', delta: 'hello' },
          { type: 'response.output_text.done' },
          { type: 'response.completed' },
        ]),
      }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('message_start')
    expect(response.body).toContain('content_block_delta')
    expect(response.body).toContain('message_stop')
    await server.close()
  })
})
