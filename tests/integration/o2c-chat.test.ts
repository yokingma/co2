import { describe, expect, it, vi } from 'vitest'
import { createServer } from '../../src/server/create-server.js'
import { createClaudeClient, createOpenAIClient, createRuntimeConfig, createSilentLogger } from '../helpers.js'

describe('o2c chat completions', () => {
  it('maps text requests to Claude and back to chat completion', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_chat_text',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'co2 works' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }))

    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({ createMessage }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'hello' }],
        max_completion_tokens: 128,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    expect(createMessage.mock.calls[0][0].model).toBe('claude-sonnet-4-20250514')
    expect(response.json().choices[0].message.content).toBe('co2 works')
    await server.close()
  })

  it('maps Claude tool_use back to chat tool_calls', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({
        createMessage: async () => ({
          id: 'msg_chat_tool',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-20250514',
          content: [{
            type: 'tool_use',
            id: 'toolu_1',
            name: 'get_weather',
            input: { city: 'Shanghai' },
          }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
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
            name: 'get_weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        }],
        tool_choice: 'required',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().choices[0].finish_reason).toBe('tool_calls')
    expect(response.json().choices[0].message.tool_calls[0].function.name).toBe('get_weather')
    await server.close()
  })

  it('rejects invalid tool arguments JSON instead of silently coercing to empty input', async () => {
    const createMessage = vi.fn(async () => ({
      id: 'msg_should_not_run',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'unexpected' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }))

    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({ createMessage }),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'gpt-4.1',
        messages: [
          { role: 'user', content: 'call tool' },
          {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{',
                },
              },
            ],
          },
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'get_weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        }],
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('mapping_error')
    expect(createMessage).not.toHaveBeenCalled()
    await server.close()
  })
})
