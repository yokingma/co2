import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeConfig } from '../../src/shared/types.js'

const loadRuntimeConfig = vi.fn()
const createServer = vi.fn()

vi.mock('../../src/config/load-runtime-config.js', () => ({
  loadRuntimeConfig,
}))

vi.mock('../../src/server/create-server.js', () => ({
  createServer,
}))

function createRuntimeConfig(
  logLevel: RuntimeConfig['server']['logLevel'],
  mode: RuntimeConfig['server']['mode'] = 'claude-to-openai',
): RuntimeConfig {
  return {
    server: {
      host: '127.0.0.1',
      port: 8123,
      mode,
      logLevel,
    },
    providers: {
      openai: {
        apiKey: 'test-openai-key',
        baseUrl: 'https://api.openai.com/v1',
        defaultHeaders: {},
      },
      anthropic: {
        apiKey: 'test-anthropic-key',
        baseUrl: 'https://api.anthropic.com',
        version: '2023-06-01',
        defaultHeaders: {},
      },
    },
    routing: {
      defaultOpenAIModel: 'gpt-5.4',
      defaultClaudeModel: 'claude-opus-4.6',
      claudeOutputEffort: 'high',
      openAIReasoningEffort: 'high',
      skipInboundFields: {
        claudeMessages: [],
        openAIResponses: [],
        openAIChatCompletions: [],
      },
    },
    modelMap: {},
  }
}

describe('start command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process, 'once').mockImplementation(((..._args: unknown[]) => process) as typeof process.once)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prints startup and Claude client proxy base URL hints to stdout even when log level is error', async () => {
    loadRuntimeConfig.mockResolvedValue(createRuntimeConfig('error', 'claude-to-openai'))
    createServer.mockReturnValue({
      listen: vi.fn(async () => 'http://127.0.0.1:8123'),
      close: vi.fn(async () => undefined),
    })

    const { registerStartCommand } = await import('../../src/cli/start-command.js')
    const program = new Command()
    registerStartCommand(program)

    await program.parseAsync(['node', 'co2', 'start', '--log-level', 'error'])

    expect(console.log).toHaveBeenCalledTimes(2)
    expect(console.log).toHaveBeenNthCalledWith(1, 'CO2 server started on http://127.0.0.1:8123 [claude-to-openai]')
    expect(console.log).toHaveBeenNthCalledWith(2, 'Client base URL: ANTHROPIC_BASE_URL=http://127.0.0.1:8123')
  })

  it('keeps the JSON startup log and adds an OpenAI client proxy base URL hint when log level allows info logs', async () => {
    loadRuntimeConfig.mockResolvedValue(createRuntimeConfig('info', 'openai-to-claude'))
    createServer.mockReturnValue({
      listen: vi.fn(async () => 'http://127.0.0.1:8123'),
      close: vi.fn(async () => undefined),
    })

    const { registerStartCommand } = await import('../../src/cli/start-command.js')
    const program = new Command()
    registerStartCommand(program)

    await program.parseAsync(['node', 'co2', 'start', '--log-level', 'info'])

    const stdoutLines = vi.mocked(console.log).mock.calls.map(([line]) => String(line))
    expect(stdoutLines).toContain('CO2 server started on http://127.0.0.1:8123 [openai-to-claude]')
    expect(stdoutLines).toContain('Client base URL: OPENAI_BASE_URL=http://127.0.0.1:8123/v1')
    expect(stdoutLines.some((line) => line.includes('"level":"info"') && line.includes('"message":"CO2 server started"'))).toBe(true)
  })
})
