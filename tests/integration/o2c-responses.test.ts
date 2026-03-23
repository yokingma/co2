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

  it('accepts typed message items with developer instructions and assistant output history', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_typed_message',
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
        input: [
          { type: 'message', role: 'developer', content: 'be concise' },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'previous answer' }] },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'next question' }] },
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    expect(createMessage.mock.calls[0][0].system).toContain('be concise')
    expect(createMessage.mock.calls[0][0].messages).toEqual([
      { role: 'assistant', content: 'previous answer' },
      { role: 'user', content: 'next question' },
    ])
    await server.close()
  })

  it('coalesces consecutive assistant tool calls and user tool results into Anthropic turns', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_coalesced_turns',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'done' }],
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
        input: [
          { type: 'message', role: 'user', content: '这个项目是什么内容？' },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '我先看一下。' }],
          },
          { type: 'function_call', call_id: 'call_glob', name: 'glob', arguments: '{"pattern":"**/*","maxResults":50}' },
          { type: 'function_call', call_id: 'call_read', name: 'read', arguments: '{"path":"/Users/zac/AI/dashboard"}' },
          { type: 'function_call_output', call_id: 'call_glob', output: '{"files":["src/App.vue"],"totalMatches":1,"truncated":false}' },
          { type: 'function_call_output', call_id: 'call_read', output: 'EISDIR: illegal operation on a directory, read' },
        ],
        tools: [
          { type: 'function', name: 'glob', parameters: { type: 'object' } },
          { type: 'function', name: 'read', parameters: { type: 'object' } },
        ],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    expect(createMessage.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: '这个项目是什么内容？' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我先看一下。' },
          { type: 'tool_use', id: 'call_glob', name: 'glob', input: { pattern: '**/*', maxResults: 50 } },
          { type: 'tool_use', id: 'call_read', name: 'read', input: { path: '/Users/zac/AI/dashboard' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_glob', content: '{"files":["src/App.vue"],"totalMatches":1,"truncated":false}', is_error: undefined },
          { type: 'tool_result', tool_use_id: 'call_read', content: 'EISDIR: illegal operation on a directory, read', is_error: undefined },
        ],
      },
    ])
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

  it('aliases dotted tool names for Anthropic requests and restores original names in responses output', async () => {
    const originalToolName = 'functions.exec_command'
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_tool_alias',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{
        type: 'tool_use',
        id: 'call_1',
        name: request.tools?.[0]?.name ?? 'unexpected_tool_name',
        input: { cmd: 'pwd' },
      }],
      stop_reason: 'tool_use',
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
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [
          { role: 'user', content: [{ type: 'input_text', text: 'call tool' }] },
          { type: 'function_call', call_id: 'call_prev', name: originalToolName, arguments: '{"cmd":"pwd"}' },
          { type: 'function_call_output', call_id: 'call_prev', output: 'ok' },
        ],
        tools: [{
          type: 'function',
          name: originalToolName,
          parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
        }],
        tool_choice: {
          type: 'function',
          name: originalToolName,
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()

    const upstreamRequest = createMessage.mock.calls[0][0]
    const aliasedToolName = upstreamRequest.tools?.[0]?.name

    expect(aliasedToolName).toMatch(/^[a-zA-Z0-9_-]{1,128}$/)
    expect(aliasedToolName).not.toBe(originalToolName)
    expect(upstreamRequest.tool_choice).toEqual({
      type: 'tool',
      name: aliasedToolName,
      disable_parallel_tool_use: true,
    })
    expect(upstreamRequest.messages[1].content[0].name).toBe(aliasedToolName)
    expect(response.json().output[0].type).toBe('function_call')
    expect(response.json().output[0].name).toBe(originalToolName)
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

  it('accepts extra control-plane fields without failing validation', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_compatible_fields',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'ok' }],
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
        metadata: { trace_id: 'req_123' },
        store: false,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    await server.close()
  })

  it('rejects previous_response_id at the boundary with an explicit error', async () => {
    const createMessage = vi.fn(async () => ({
      id: 'msg_resp_previous_response_id',
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
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        previous_response_id: 'resp_123',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('unsupported_parameter')
    expect(response.json().error.param).toBe('previous_response_id')
    expect(createMessage).not.toHaveBeenCalled()
    await server.close()
  })

  it('maps top_p to Claude sampling when provided', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_top_p',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'ok' }],
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
        top_p: 0.2,
      },
    })

    expect(response.statusCode).toBe(200)
    expect((createMessage.mock.calls[0][0] as Record<string, unknown>).top_p).toBe(0.2)
    await server.close()
  })

  it('applies configured default Claude output effort when request has no reasoning', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_default_effort',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 6 },
    }))

    const runtimeConfig = createRuntimeConfig('openai-to-claude')
    runtimeConfig.routing.claudeOutputEffort = 'high'

    const server = createServer(runtimeConfig, {
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
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    expect((createMessage.mock.calls[0][0] as Record<string, unknown>).output_config).toEqual({ effort: 'high' })
    expect(createMessage.mock.calls[0][0].thinking).toEqual({ type: 'adaptive' })
    await server.close()
  })

  it('prefers request reasoning effort over configured Claude output effort', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_request_effort',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 6 },
    }))

    const runtimeConfig = createRuntimeConfig('openai-to-claude')
    runtimeConfig.routing.claudeOutputEffort = 'low'

    const server = createServer(runtimeConfig, {
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
          effort: 'xhigh',
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    expect((createMessage.mock.calls[0][0] as Record<string, unknown>).output_config).toEqual({ effort: 'max' })
    expect(createMessage.mock.calls[0][0].thinking).toEqual({ type: 'adaptive' })
    await server.close()
  })

  it('does not apply configured Claude output effort when request only sets reasoning summary', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_reasoning_summary_only',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 6 },
    }))

    const runtimeConfig = createRuntimeConfig('openai-to-claude')
    runtimeConfig.routing.claudeOutputEffort = 'high'

    const server = createServer(runtimeConfig, {
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
          summary: 'concise',
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    expect((createMessage.mock.calls[0][0] as Record<string, unknown>).output_config).toBeUndefined()
    expect(createMessage.mock.calls[0][0].thinking).toEqual({ type: 'adaptive' })
    await server.close()
  })

  it('does not apply configured Claude output effort when request explicitly opts out of reasoning', async () => {
    const createMessage = vi.fn(async (request) => ({
      id: 'msg_resp_reasoning_none',
      type: 'message',
      role: 'assistant',
      model: request.model,
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 6 },
    }))

    const runtimeConfig = createRuntimeConfig('openai-to-claude')
    runtimeConfig.routing.claudeOutputEffort = 'high'

    const server = createServer(runtimeConfig, {
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
          effort: 'none',
        },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    expect((createMessage.mock.calls[0][0] as Record<string, unknown>).output_config).toBeUndefined()
    expect(createMessage.mock.calls[0][0].thinking).toEqual({ type: 'disabled' })
    await server.close()
  })

  it('defaults tool_choice to auto for responses requests with tools', async () => {
    const createMessage = vi.fn(async () => ({
      id: 'msg_resp_auto_tool_choice',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      content: [{ type: 'text', text: 'ok' }],
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
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }],
      },
    })

    expect(response.statusCode).toBe(200)
    expect(createMessage).toHaveBeenCalled()
    expect(createMessage.mock.calls[0][0].tool_choice).toEqual({
      type: 'auto',
      disable_parallel_tool_use: true,
    })
    await server.close()
  })

  it('rejects parallel tool calls because V1 only supports sequential tool use', async () => {
    const createMessage = vi.fn(async () => ({
      id: 'msg_resp_parallel_tool_calls',
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
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        tools: [{ type: 'function', name: 'get_weather', parameters: { type: 'object' } }],
        parallel_tool_calls: true,
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('unsupported_parameter')
    expect(response.json().error.param).toBe('parallel_tool_calls')
    expect(createMessage).not.toHaveBeenCalled()
    await server.close()
  })

  it('rejects unknown top-level fields instead of silently ignoring typos', async () => {
    const createMessage = vi.fn(async () => ({
      id: 'msg_resp_unknown_field',
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
      url: '/v1/responses',
      payload: {
        model: 'gpt-4.1',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
        totally_unknown: true,
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toContain('Unrecognized key')
    expect(createMessage).not.toHaveBeenCalled()
    await server.close()
  })

})
