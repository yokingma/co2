import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createRuntimeConfig, createSilentLogger } from '../helpers.js'

const createMessageMock = vi.fn(async () => ({ id: 'msg_1' }))
const anthropicConstructorMock = vi.fn(function AnthropicMock() {
  return {
    messages: {
      create: createMessageMock,
    },
  }
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: anthropicConstructorMock,
}))

describe('createClaudeUpstreamClient', () => {
  beforeEach(() => {
    anthropicConstructorMock.mockClear()
    createMessageMock.mockClear()
  })

  it('forwards configured anthropic-version as default header', async () => {
    const { createClaudeUpstreamClient } = await import('../../src/upstream/claude-client.js')
    const config = createRuntimeConfig('openai-to-claude')
    config.providers.anthropic.version = '2024-01-01'

    const client = createClaudeUpstreamClient(config, createSilentLogger())
    await client.createMessage({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 128,
      messages: [{ role: 'user', content: 'hello' }],
    })

    expect(anthropicConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHeaders: {
          'anthropic-version': '2024-01-01',
        },
      }),
    )
  })
})
