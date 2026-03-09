import { describe, expect, it } from 'vitest'
import { createServer } from '../../src/server/create-server.js'
import { createClaudeClient, createOpenAIClient, createRuntimeConfig } from '../helpers.js'
import type { Logger } from '../../src/shared/types.js'

describe('upstream request summary logging', () => {
  it('logs safe OpenAI upstream request summary for c2o messages', async () => {
    const entries: Array<{ level: 'info' | 'error'; message: string; data?: Record<string, unknown> }> = []
    const logger: Logger = {
      debug() {},
      info(message, data) {
        entries.push({ level: 'info', message, data })
      },
      warn() {},
      error(message, data) {
        entries.push({ level: 'error', message, data })
      },
    }

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
      hasReasoning: true,
      reasoningEffort: 'medium',
      inputItemTypes: ['message'],
      inputRoles: ['user'],
    })

    await server.close()
  })
})
