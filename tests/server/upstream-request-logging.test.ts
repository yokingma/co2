import { describe, expect, it } from 'vitest'
import { createServer } from '../../src/server/create-server.js'
import { createCapturingLogger, createClaudeClient, createOpenAIClient, createRuntimeConfig } from '../helpers.js'
import type { ClaudeMessagesRequest } from '../../src/shared/types.js'

describe('upstream request summary logging', () => {
  it('logs safe OpenAI upstream request summary for c2o messages', async () => {
    const { entries, logger } = createCapturingLogger()

    const server = createServer(createRuntimeConfig('claude-to-openai'), {
      logger,
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({
        createResponse: async () => ({
          id: 'resp_summary',
          object: 'response',
          status: 'completed',
          model: 'gpt-4.1',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
      }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-opus-4.6',
        max_tokens: 2048,
        system: 'You are concise.',
        thinking: {
          type: 'enabled',
          budget_tokens: 2048,
        },
        tools: [
          {
            name: 'get_weather',
            input_schema: {
              type: 'object',
              properties: { city: { type: 'string' } },
            },
          },
        ],
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(response.statusCode).toBe(200)
    const logEntry = entries.find((entry) => entry.message === 'OpenAI upstream request summary')
    expect(logEntry).toBeDefined()
    expect(logEntry?.data).toMatchObject({
      upstreamProvider: 'openai',
      upstreamPath: '/v1/responses',
      upstreamModel: 'gpt-4.1',
      transport: 'json',
      maxOutputTokens: 2048,
      hasInstructions: true,
      toolCount: 1,
      toolNames: ['get_weather'],
      toolChoice: 'auto',
      hasReasoning: true,
      reasoningEffort: 'medium',
      inputItemTypes: ['message'],
      inputRoles: ['user'],
    })

    const bodyLogEntry = entries.find((entry) => entry.message === 'OpenAI upstream request body')
    expect(bodyLogEntry).toBeDefined()
    expect(bodyLogEntry?.data).toMatchObject({
      upstreamProvider: 'openai',
      upstreamPath: '/v1/responses',
      body: {
        model: 'gpt-4.1',
        instructions: 'You are concise.',
        max_output_tokens: 2048,
        stream: false,
        tool_choice: 'auto',
        reasoning: {
          effort: 'medium',
        },
        tools: [
          {
            type: 'function',
            name: 'get_weather',
          },
        ],
      },
    })

    await server.close()
  })

  it('logs configured default OpenAI reasoning effort when request has no thinking', async () => {
    const { entries, logger } = createCapturingLogger()

    const runtimeConfig = createRuntimeConfig('claude-to-openai')
    runtimeConfig.routing.openAIReasoningEffort = 'high'

    const server = createServer(runtimeConfig, {
      logger,
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({
        createResponse: async () => ({
          id: 'resp_summary_default_reasoning',
          object: 'response',
          status: 'completed',
          model: 'gpt-4.1',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
      }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-opus-4.6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(response.statusCode).toBe(200)
    const logEntry = entries.find((entry) => entry.message === 'OpenAI upstream request summary')
    expect(logEntry).toBeDefined()
    expect(logEntry?.data).toMatchObject({
      hasReasoning: true,
      reasoningEffort: 'high',
    })

    const bodyLogEntry = entries.find((entry) => entry.message === 'OpenAI upstream request body')
    expect(bodyLogEntry).toBeDefined()
    expect(bodyLogEntry?.data).toMatchObject({
      body: {
        reasoning: {
          effort: 'high',
        },
      },
    })

    await server.close()
  })

  it('logs safe OpenAI chat completions upstream request summary for c2o messages when configured', async () => {
    const { entries, logger } = createCapturingLogger()

    const runtimeConfig = createRuntimeConfig('claude-to-openai')
    runtimeConfig.routing.openAIUpstreamApi = 'chat-completions'

    const server = createServer(runtimeConfig, {
      logger,
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({
        createChatCompletion: async () => ({
          id: 'chatcmpl_summary',
          object: 'chat.completion',
          model: 'gpt-4.1',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'ok',
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      payload: {
        model: 'claude-opus-4.6',
        max_tokens: 2048,
        system: 'You are concise.',
        tools: [
          {
            name: 'get_weather',
            input_schema: {
              type: 'object',
              properties: { city: { type: 'string' } },
            },
          },
        ],
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(response.statusCode).toBe(200)
    const logEntry = entries.find((entry) => entry.message === 'OpenAI upstream request summary')
    expect(logEntry).toBeDefined()
    expect(logEntry?.data).toMatchObject({
      upstreamProvider: 'openai',
      upstreamPath: '/v1/chat/completions',
      upstreamModel: 'gpt-4.1',
      transport: 'json',
      maxCompletionTokens: 2048,
      messageRoles: ['system', 'user'],
      toolCount: 1,
      toolNames: ['get_weather'],
      toolChoice: 'auto',
      reasoningEffort: null,
    })

    const bodyLogEntry = entries.find((entry) => entry.message === 'OpenAI upstream request body')
    expect(bodyLogEntry).toBeDefined()
    expect(bodyLogEntry?.data).toMatchObject({
      upstreamProvider: 'openai',
      upstreamPath: '/v1/chat/completions',
      body: {
        model: 'gpt-4.1',
        max_tokens: 2048,
        stream: false,
        tool_choice: 'auto',
        messages: [
          {
            role: 'system',
            content: 'You are concise.',
          },
          {
            role: 'user',
            content: 'hello',
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
            },
          },
        ],
      },
    })
    expect((bodyLogEntry?.data?.body as Record<string, unknown>).max_completion_tokens).toBeUndefined()

    await server.close()
  })

  it('warns when configured inbound fields are skipped before c2o normalization', async () => {
    const { entries, logger } = createCapturingLogger()

    const runtimeConfig = createRuntimeConfig('claude-to-openai')
    runtimeConfig.routing.skipInboundFields.claudeMessages = ['context_management']

    const server = createServer(runtimeConfig, {
      logger,
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({
        createResponse: async () => ({
          id: 'resp_summary_skipped_fields',
          object: 'response',
          status: 'completed',
          model: 'gpt-4.1',
          output: [{
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
      }),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages?beta=true',
      payload: {
        model: 'claude-opus-4.6',
        max_tokens: 2048,
        context_management: {
          edits: [{ type: 'clear_tool_uses_20250919' }],
        },
        messages: [{ role: 'user', content: 'hello' }],
      },
    })

    expect(response.statusCode).toBe(200)
    const warnEntry = entries.find((entry) => entry.level === 'warn' && entry.message === 'Skipped configured inbound fields')
    expect(warnEntry).toBeDefined()
    expect(warnEntry?.data).toMatchObject({
      requestId: 'req-1',
      inboundContract: 'claudeMessages',
      skippedFields: ['context_management'],
    })

    const bodyLogEntry = entries.find((entry) => entry.message === 'OpenAI upstream request body')
    expect(bodyLogEntry).toBeDefined()
    expect((bodyLogEntry?.data?.body as Record<string, unknown>).context_management).toBeUndefined()

    await server.close()
  })

  it('logs configured default Claude output effort when request has no reasoning', async () => {
    const { entries, logger } = createCapturingLogger()

    const runtimeConfig = createRuntimeConfig('openai-to-claude')
    runtimeConfig.routing.claudeOutputEffort = 'high'

    const createMessage = async (request: ClaudeMessagesRequest) => ({
      id: 'msg_summary_default_effort',
      type: 'message' as const,
      role: 'assistant' as const,
      model: request.model,
      content: [{ type: 'text' as const, text: 'ok' }],
      stop_reason: 'end_turn' as const,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const server = createServer(runtimeConfig, {
      logger,
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
    const logEntry = entries.find((entry) => entry.message === 'Claude upstream request summary')
    expect(logEntry).toBeDefined()
    expect(logEntry?.data).toMatchObject({
      hasThinking: true,
      thinkingType: 'adaptive',
      outputEffort: 'high',
    })

    const bodyLogEntry = entries.find((entry) => entry.message === 'Claude upstream request body')
    expect(bodyLogEntry).toBeDefined()
    expect(bodyLogEntry?.data).toMatchObject({
      body: {
        thinking: {
          type: 'adaptive',
        },
        output_config: {
          effort: 'high',
        },
      },
    })

    await server.close()
  })

  it('does not log configured Claude output effort when request already carries reasoning metadata', async () => {
    const { entries, logger } = createCapturingLogger()

    const runtimeConfig = createRuntimeConfig('openai-to-claude')
    runtimeConfig.routing.claudeOutputEffort = 'high'

    const createMessage = async (request: ClaudeMessagesRequest) => ({
      id: 'msg_summary_reasoning_summary_only',
      type: 'message' as const,
      role: 'assistant' as const,
      model: request.model,
      content: [{ type: 'text' as const, text: 'ok' }],
      stop_reason: 'end_turn' as const,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    })

    const server = createServer(runtimeConfig, {
      logger,
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
    const logEntry = entries.find((entry) => entry.message === 'Claude upstream request summary')
    expect(logEntry).toBeDefined()
    expect(logEntry?.data).toMatchObject({
      hasThinking: true,
      thinkingType: 'adaptive',
      outputEffort: null,
    })

    const bodyLogEntry = entries.find((entry) => entry.message === 'Claude upstream request body')
    expect(bodyLogEntry).toBeDefined()
    expect(bodyLogEntry?.data).toMatchObject({
      body: {
        thinking: {
          type: 'adaptive',
        },
      },
    })
    expect((bodyLogEntry?.data?.body as Record<string, unknown>).output_config).toBeUndefined()

    await server.close()
  })
})
