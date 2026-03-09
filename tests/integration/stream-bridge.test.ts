import { describe, expect, it } from 'vitest'
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
    expect(response.body).toContain('response.output_text.delta')
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
