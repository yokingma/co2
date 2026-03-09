import { describe, expect, it } from 'vitest'
import { createServer } from '../../src/server/create-server.js'
import { createClaudeClient, createOpenAIClient, createRuntimeConfig } from '../helpers.js'
import type { Logger } from '../../src/shared/types.js'

describe('error logging', () => {
  it('logs detailed validation context for messages failures', async () => {
    const entries: Array<{ message: string; data?: Record<string, unknown> }> = []
    const logger: Logger = {
      debug() {},
      info() {},
      warn() {},
      error(message, data) {
        entries.push({ message, data })
      },
    }

    const server = createServer(createRuntimeConfig('claude-to-openai'), {
      logger,
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({}),
    })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/messages',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'user-agent': 'test-client/1.0',
        'x-api-key': 'local-client-key',
      },
      payload: {
        model: 'claude-opus-4.6',
        max_tokens: 128,
        messages: [{ role: 'user', content: 'hello' }],
        unsupported_field: true,
      },
    })

    expect(response.statusCode).toBe(400)
    const logEntry = entries.find((entry) => entry.message === 'Messages route failed')
    expect(logEntry).toBeDefined()
    expect(logEntry?.data?.bodyKeys).toEqual(['max_tokens', 'messages', 'model', 'unsupported_field'])
    expect(logEntry?.data?.headerSummary).toEqual({
      contentType: 'application/json',
      anthropicVersion: '2023-06-01',
      userAgent: 'test-client/1.0',
      hasAuthorization: false,
      hasXApiKey: true,
    })
    expect(logEntry?.data?.errorMessage).toContain('Unrecognized key')
    expect(logEntry?.data?.zodIssues).toEqual([
      {
        path: '<root>',
        message: 'Unrecognized key: "unsupported_field"',
      },
    ])

    await server.close()
  })
})
