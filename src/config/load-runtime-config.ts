import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startCommandSchema, type StartCommandInput } from '../schemas/start-command-schema.js'
import { normalizeMode } from '../shared/contracts.js'
import { createConfigError } from '../shared/errors.js'
import { validateProviderDefaultHeaders } from '../shared/headers.js'
import type { RuntimeConfig } from '../shared/types.js'
import { configFileSchema, envSchema, runtimeConfigSchema, type ConfigFileInput } from './runtime-config-schema.js'

async function readConfigFile(pathValue: string | undefined): Promise<ConfigFileInput> {
  if (!pathValue) {
    return {}
  }

  const absolutePath = resolve(pathValue)
  const fileContents = await readFile(absolutePath, 'utf8')
  const parsedJson = JSON.parse(fileContents) as unknown
  return configFileSchema.parse(parsedJson)
}

function resolveMode(cliInput: StartCommandInput, configInput: ConfigFileInput): RuntimeConfig['server']['mode'] {
  const cliMode = cliInput.mode ? normalizeMode(cliInput.mode) : undefined
  const configMode = configInput.server?.mode

  if (cliMode) {
    return cliMode
  }

  if (configMode) {
    return configMode
  }

  throw createConfigError('Mode is required when not provided in config file', 'mode')
}

function assertRequiredKeys(config: RuntimeConfig): void {
  if (config.server.mode === 'openai-to-claude' && !config.providers.anthropic.apiKey) {
    throw createConfigError('ANTHROPIC_API_KEY is required for o2c mode', 'ANTHROPIC_API_KEY')
  }

  if (config.server.mode === 'claude-to-openai' && !config.providers.openai.apiKey) {
    throw createConfigError('OPENAI_API_KEY is required for c2o mode', 'OPENAI_API_KEY')
  }
}

export async function loadRuntimeConfig(input: unknown): Promise<RuntimeConfig> {
  const cliInput = startCommandSchema.parse(input)
  const envInput = envSchema.parse(process.env)
  const configPath = cliInput.config ?? envInput.CO2_CONFIG
  const configInput = await readConfigFile(configPath)
  const mode = resolveMode(cliInput, configInput)

  const runtimeConfig = runtimeConfigSchema.parse({
    server: {
      host: cliInput.host ?? configInput.server?.host,
      port: cliInput.port ?? configInput.server?.port,
      mode,
      logLevel: cliInput.logLevel ?? configInput.server?.logLevel,
    },
    providers: {
      openai: {
        apiKey: envInput.OPENAI_API_KEY ?? configInput.providers?.openai?.apiKey,
        baseUrl: envInput.OPENAI_BASE_URL ?? configInput.providers?.openai?.baseUrl,
        defaultHeaders: validateProviderDefaultHeaders('openai', configInput.providers?.openai?.defaultHeaders ?? {}),
      },
      anthropic: {
        apiKey: envInput.ANTHROPIC_API_KEY ?? configInput.providers?.anthropic?.apiKey,
        baseUrl: envInput.ANTHROPIC_BASE_URL ?? configInput.providers?.anthropic?.baseUrl,
        version: envInput.ANTHROPIC_VERSION ?? configInput.providers?.anthropic?.version,
        defaultHeaders: validateProviderDefaultHeaders('anthropic', configInput.providers?.anthropic?.defaultHeaders ?? {}),
      },
    },
    routing: {
      defaultOpenAIModel: configInput.routing?.defaultOpenAIModel,
      defaultClaudeModel: configInput.routing?.defaultClaudeModel,
    },
    modelMap: configInput.modelMap ?? {},
  })

  assertRequiredKeys(runtimeConfig)
  return runtimeConfig
}
