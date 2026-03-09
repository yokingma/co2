import { describe, expect, it, vi } from 'vitest'
import { createServer } from '../../src/server/create-server.js'
import { createClaudeClient, createOpenAIClient, createRuntimeConfig, createSilentLogger } from '../helpers.js'

describe('c2o messages', () => {
  it('maps Claude text request to OpenAI responses upstream and back', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_text',
      object: 'response',
      status: 'completed',
      model: request.model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'claude compatible' }],
      }],
      usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
    }))

    const server = createServer(createRuntimeConfig('claude-to-openai'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({ createResponse }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createResponse).toHaveBeenCalled()
    expect(createResponse.mock.calls[0][0].model).toBe('gpt-4.1')
    expect(response.json().content[0].text).toBe('claude compatible')
    await server.close()
  })

  it('maps OpenAI function_call output to Claude tool_use', async () => {
    const server = createServer(createRuntimeConfig('claude-to-openai'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({
        createResponse: async () => ({
          id: 'resp_message_tool',
          object: 'response',
          status: 'completed',
          model: 'gpt-4.1',
          output: [{
            type: 'function_call',
            call_id: 'call_123',
            name: 'get_weather',
            arguments: '{"city":"Shanghai"}',
          }],
          usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
        }),
      }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'call tool' }],
        tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().stop_reason).toBe('tool_use')
    expect(response.json().content[0].type).toBe('tool_use')
    await server.close()
  })

  it('maps Claude thinking to OpenAI reasoning', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_thinking',
      object: 'response',
      status: 'completed',
      model: request.model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'reasoned answer' }],
      }],
      usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
    }))

    const server = createServer(createRuntimeConfig('claude-to-openai'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({ createResponse }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        thinking: {
          type: 'enabled',
          budget_tokens: 2048,
        },
        messages: [{ role: 'user', content: 'think first' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createResponse).toHaveBeenCalled()
    expect(createResponse.mock.calls[0][0].reasoning).toEqual({ effort: 'medium' })
    await server.close()
  })


  it('ignores OpenAI reasoning output items and still returns Claude text', async () => {
    const server = createServer(createRuntimeConfig('claude-to-openai'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({
        createResponse: async () => ({
          id: 'resp_message_reasoning',
          object: 'response',
          status: 'completed',
          model: 'gpt-4.1',
          output: [
            {
              type: 'reasoning',
              id: 'rs_1',
              summary: [{ type: 'summary_text', text: 'internal summary' }],
              content: [{ type: 'reasoning_text', text: 'chain of thought' }],
              status: 'completed',
            },
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'final answer' }],
            },
          ],
          usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
        }),
      }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        thinking: {
          type: 'enabled',
          budget_tokens: 2048,
        },
        messages: [{ role: 'user', content: 'think and answer' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().content[0].text).toBe('final answer')
    await server.close()
  })

})
