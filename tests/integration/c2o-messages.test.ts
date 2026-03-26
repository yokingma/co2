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

  it('accepts extra Claude control-plane fields without failing validation', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_compatible_fields',
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
        metadata: { user_id: 'opaque-user-id' },
        container: 'container_123',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createResponse).toHaveBeenCalled()
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
    expect(createResponse.mock.calls[0][0].tool_choice).toBeUndefined()
    await server.close()
  })

  it('accepts Claude output_config effort and maps it to OpenAI reasoning', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_output_config',
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
          type: 'adaptive',
        },
        output_config: {
          effort: 'high',
        },
        messages: [{ role: 'user', content: 'think first' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createResponse).toHaveBeenCalled()
    expect(createResponse.mock.calls[0][0].reasoning).toEqual({ effort: 'high' })
    await server.close()
  })

  it('encodes assistant history messages as output_text for OpenAI responses input', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_assistant_history',
      object: 'response',
      status: 'completed',
      model: request.model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }],
      }],
      usage: { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
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
        messages: [
          { role: 'user', content: '你好' },
          { role: 'assistant', content: '老大，您好！' },
          { role: 'user', content: '你是谁' },
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createResponse).toHaveBeenCalled()
    expect(createResponse.mock.calls[0][0].input).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: '你好' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: '老大，您好！' }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: '你是谁' }],
      },
    ])
    await server.close()
  })

  it('defaults tool_choice to auto when Claude tools are present', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_auto_tool_choice',
      object: 'response',
      status: 'completed',
      model: request.model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
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
        tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
        messages: [{ role: 'user', content: 'call tool' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createResponse).toHaveBeenCalled()
    expect(createResponse.mock.calls[0][0].tool_choice).toBe('auto')
    expect((createResponse.mock.calls[0][0] as Record<string, unknown>).parallel_tool_calls).toBe(false)
    await server.close()
  })

  it('maps top_p to OpenAI responses sampling', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_top_p',
      object: 'response',
      status: 'completed',
      model: request.model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
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
        top_p: 0.4,
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect((createResponse.mock.calls[0][0] as Record<string, unknown>).top_p).toBe(0.4)
    await server.close()
  })

  it('can send configured default OpenAI reasoning effort', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_default_reasoning',
      object: 'response',
      status: 'completed',
      model: request.model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }))

    const runtimeConfig = createRuntimeConfig('claude-to-openai')
    runtimeConfig.routing.openAIReasoningEffort = 'high'

    const server = createServer(runtimeConfig, {
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
    expect((createResponse.mock.calls[0][0] as Record<string, unknown>).reasoning).toEqual({ effort: 'high' })
    await server.close()
  })

  it('prefers request thinking over configured default OpenAI reasoning effort', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_request_reasoning',
      object: 'response',
      status: 'completed',
      model: request.model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }))

    const runtimeConfig = createRuntimeConfig('claude-to-openai')
    runtimeConfig.routing.openAIReasoningEffort = 'high'

    const server = createServer(runtimeConfig, {
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
        thinking: {
          type: 'enabled',
          budget_tokens: 2048,
        },
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createResponse).toHaveBeenCalled()
    expect((createResponse.mock.calls[0][0] as Record<string, unknown>).reasoning).toEqual({ effort: 'medium' })
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

  it('rejects top_k because there is no accurate OpenAI Responses equivalent in V1', async () => {
    const createResponse = vi.fn(async () => ({
      id: 'resp_message_top_k',
      object: 'response',
      status: 'completed',
      model: 'gpt-4.1',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'unexpected' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
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
        top_k: 5,
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().type).toBe('error')
    expect(response.json().error.message).toContain('top_k')
    expect(createResponse).not.toHaveBeenCalled()
    await server.close()
  })

  it('rejects context_management with an explicit unsupported parameter error', async () => {
    const createResponse = vi.fn(async () => ({
      id: 'resp_message_context_management',
      object: 'response',
      status: 'completed',
      model: 'gpt-4.1',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'unexpected' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
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
        context_management: {
          edits: [{ type: 'clear_tool_uses_20250919' }],
        },
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().type).toBe('error')
    expect(response.json().error.message).toContain('context_management')
    expect(createResponse).not.toHaveBeenCalled()
    await server.close()
  })

  it('skips configured Claude inbound fields so Claude Code style context_management requests can pass through', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_skipped_context_management',
      object: 'response',
      status: 'completed',
      model: request.model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    }))

    const runtimeConfig = createRuntimeConfig('claude-to-openai')
    runtimeConfig.routing.skipInboundFields.claudeMessages = ['context_management']

    const server = createServer(runtimeConfig, {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({ createResponse }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages?beta=true',
      payload: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'hello' }],
        context_management: {
          edits: [{ type: 'clear_tool_uses_20250919' }],
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createResponse).toHaveBeenCalled()
    expect((createResponse.mock.calls[0][0] as Record<string, unknown>).context_management).toBeUndefined()
    await server.close()
  })

  it('ignores unknown non-typo top-level fields for forward compatibility', async () => {
    const createResponse = vi.fn(async (request) => ({
      id: 'resp_message_unknown_extension',
      object: 'response',
      status: 'completed',
      model: request.model,
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
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
        future_extension: {
          enabled: true,
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createResponse).toHaveBeenCalled()
    expect((createResponse.mock.calls[0][0] as Record<string, unknown>).future_extension).toBeUndefined()
    await server.close()
  })

  it('rejects likely typo top-level fields instead of silently ignoring them', async () => {
    const createResponse = vi.fn(async () => ({
      id: 'resp_message_unknown_field',
      object: 'response',
      status: 'completed',
      model: 'gpt-4.1',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'unexpected' }],
      }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
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
        thinkingg: { type: 'adaptive' },
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain('Unrecognized key')
    expect(createResponse).not.toHaveBeenCalled()
    await server.close()
  })

})
