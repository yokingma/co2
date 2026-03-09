import { describe, expect, it, vi } from 'vitest'
import { createServer } from '../../src/server/create-server.js'
import { createClaudeClient, createOpenAIClient, createRuntimeConfig, createSilentLogger } from '../helpers.js'

describe('o2c responses', () => {
  it('maps responses request and returns responses envelope', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_text',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'response text' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 6 },
    }))

    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({ createMessage }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        instructions: 'be concise',
        tools: [{
          type: 'function',
          name: 'get_weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage.mock.calls[0][0].system).toContain('be concise')
    expect(response.json().object).toBe('response')
    expect(response.json().output[0].content[0].text).toBe('response text')
    await server.close()
  })

  it('maps Claude tool_use to responses function_call output item', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        createMessage: async () => ({
          id: 'msg_resp_tool',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'tool_use', id: 'call_1', name: 'get_weather', input: { city: 'Shanghai' } }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'call tool' }] }],
        tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().output[0].type).toBe('function_call')
    expect(response.json().output[0].name).toBe('get_weather')
    await server.close()
  })

  it('maps OpenAI reasoning to Claude thinking', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_reasoning',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'reasoned response text' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 6 },
    }))

    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({ createMessage }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        reasoning: {
          effort: 'high'
        }
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    expect(createMessage.mock.calls[0][0].thinking).toEqual({ type: 'adaptive' })
    await server.close()
  })

})
