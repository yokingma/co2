import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from '../../src/server/create-server.js'
import { createClaudeClient, createOpenAIClient, createRuntimeConfig, createSilentLogger } from '../helpers.js'

describe('route matrix', () => {
  it('registers o2c routes and returns OpenAI-style 404 for unsupported route', async () => {
    const server = createServer(createRuntimeConfig('openai-to-claude'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({}),
    })

    const healthz = await server.inject({ method: 'GET', url: '/healthz' })
    const unsupported = await server.inject({ method: 'POST', url: '/v1/messages' })

    expect(healthz.statusCode).toBe(200)
    expect(unsupported.statusCode).toBe(404)
    expect(unsupported.json().error.code).toBe('route_not_found')
    await server.close()
  })

  it('registers c2o routes and returns Claude-style 404 for unsupported route', async () => {
    const server = createServer(createRuntimeConfig('claude-to-openai'), {
      logger: createSilentLogger(),
      claudeClient: createClaudeClient({}),
      openAIClient: createOpenAIClient({}),
    })

    const unsupported = await server.inject({ method: 'POST', url: '/v1/chat/completions' })
    expect(unsupported.statusCode).toBe(404)
    expect(unsupported.json().type).toBe('error')
    expect(unsupported.headers['x-co2-request-id']).toBeDefined()
    await server.close()
  })
})
