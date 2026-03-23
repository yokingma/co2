import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadRuntimeConfig } from '../../src/config/load-runtime-config.js'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.OPENAI_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
})

describe('loadRuntimeConfig', () => {
  it('normalizes o2c mode and uses env credentials', async () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-key'
    const config = await loadRuntimeConfig({ mode: 'o2c', port: '8123', logLevel: 'debug' })

    expect(config.server.mode).toBe('openai-to-claude')
    expect(config.server.port).toBe(8123)
    expect(config.server.logLevel).toBe('debug')
    expect(config.providers.anthropic.apiKey).toBe('anthropic-key')
  })

  it('applies CLI over config for non-sensitive fields and env over config for keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'co2-config-'))
    const configPath = join(directory, 'co2.config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        server: {
          mode: 'claude-to-openai',
          port: 9000,
          host: '0.0.0.0',
        },
        providers: {
          openai: {
            apiKey: 'file-openai-key',
          },
        },
      }),
    )

    process.env.OPENAI_API_KEY = 'env-openai-key'
    const runtimeConfig = await loadRuntimeConfig({ config: configPath, port: '9001' })

    expect(runtimeConfig.server.mode).toBe('claude-to-openai')
    expect(runtimeConfig.server.port).toBe(9001)
    expect(runtimeConfig.providers.openai.apiKey).toBe('env-openai-key')
  })

  it('loads configurable default headers and keeps them normalized', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'co2-headers-'))
    const configPath = join(directory, 'co2.config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        server: {
          mode: 'claude-to-openai',
        },
        providers: {
          openai: {
            defaultHeaders: {
              'User-Agent': 'co2-local-test/0.1',
              'X-Test-Header': 'ok',
            },
          },
        },
      }),
    )

    process.env.OPENAI_API_KEY = 'env-openai-key'
    const runtimeConfig = await loadRuntimeConfig({ config: configPath })

    expect(runtimeConfig.providers.openai.defaultHeaders['user-agent']).toBe('co2-local-test/0.1')
    expect(runtimeConfig.providers.openai.defaultHeaders['x-test-header']).toBe('ok')
  })

  it('loads configurable OpenAI reasoning effort', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'co2-reasoning-'))
    const configPath = join(directory, 'co2.config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        server: {
          mode: 'claude-to-openai',
        },
        routing: {
          openAIReasoningEffort: 'high',
        },
      }),
    )

    process.env.OPENAI_API_KEY = 'env-openai-key'
    const runtimeConfig = await loadRuntimeConfig({ config: configPath })

    expect(runtimeConfig.routing.openAIReasoningEffort).toBe('high')
  })

  it('loads configurable Claude output effort', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'co2-claude-effort-'))
    const configPath = join(directory, 'co2.config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        server: {
          mode: 'openai-to-claude',
        },
        routing: {
          claudeOutputEffort: 'max',
        },
      }),
    )

    process.env.ANTHROPIC_API_KEY = 'env-anthropic-key'
    const runtimeConfig = await loadRuntimeConfig({ config: configPath })

    expect(runtimeConfig.routing.claudeOutputEffort).toBe('max')
  })

  it('uses ANTHROPIC_AUTH_TOKEN when ANTHROPIC_API_KEY is unset', async () => {
    process.env.ANTHROPIC_API_KEY = ''
    process.env.ANTHROPIC_AUTH_TOKEN = 'auth-token-only'

    const runtimeConfig = await loadRuntimeConfig({ mode: 'o2c' })

    expect(runtimeConfig.providers.anthropic.apiKey).toBe('auth-token-only')
  })

  it('accepts matching ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN values', async () => {
    process.env.ANTHROPIC_API_KEY = 'same-anthropic-key'
    process.env.ANTHROPIC_AUTH_TOKEN = 'same-anthropic-key'

    const runtimeConfig = await loadRuntimeConfig({ mode: 'o2c' })

    expect(runtimeConfig.providers.anthropic.apiKey).toBe('same-anthropic-key')
  })

  it('fails when ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN conflict', async () => {
    process.env.ANTHROPIC_API_KEY = 'primary-key'
    process.env.ANTHROPIC_AUTH_TOKEN = 'different-token'

    await expect(loadRuntimeConfig({ mode: 'o2c' })).rejects.toThrow(
      'ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN must match when both are set',
    )
  })

  it('treats unrelated empty provider env vars as unset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'co2-empty-env-unrelated-'))
    const configPath = join(directory, 'co2.config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        server: {
          mode: 'claude-to-openai',
        },
      }),
    )

    process.env.OPENAI_API_KEY = 'env-openai-key'
    process.env.ANTHROPIC_API_KEY = ''

    const runtimeConfig = await loadRuntimeConfig({ config: configPath })

    expect(runtimeConfig.server.mode).toBe('claude-to-openai')
    expect(runtimeConfig.providers.openai.apiKey).toBe('env-openai-key')
    expect(runtimeConfig.providers.anthropic.apiKey).toBeUndefined()
  })

  it('treats empty required provider env vars as missing', async () => {
    process.env.OPENAI_API_KEY = ''
    await expect(loadRuntimeConfig({ mode: 'c2o' })).rejects.toThrow('OPENAI_API_KEY is required for c2o mode')
  })

  it('mentions both Anthropic env vars when o2c credentials are missing', async () => {
    await expect(loadRuntimeConfig({ mode: 'o2c' })).rejects.toThrow(
      'ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required for o2c mode',
    )
  })

  it('rejects forbidden authentication header overrides', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'co2-headers-invalid-'))
    const configPath = join(directory, 'co2.config.json')
    await writeFile(
      configPath,
      JSON.stringify({
        server: {
          mode: 'claude-to-openai',
        },
        providers: {
          openai: {
            defaultHeaders: {
              Authorization: 'Bearer nope',
            },
          },
        },
      }),
    )

    process.env.OPENAI_API_KEY = 'env-openai-key'
    await expect(loadRuntimeConfig({ config: configPath })).rejects.toThrow('cannot override SDK authentication headers')
  })

  it('fails when required upstream key is missing', async () => {
    delete process.env.OPENAI_API_KEY
    await expect(loadRuntimeConfig({ mode: 'c2o' })).rejects.toThrow('OPENAI_API_KEY is required for c2o mode')
  })
})
