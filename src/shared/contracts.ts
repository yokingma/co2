export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 8000
export const DEFAULT_LOG_LEVEL = 'info' as const
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01'
export const DEFAULT_OPENAI_UPSTREAM_API = 'responses' as const

export const MODE_ALIASES = {
  o2c: 'openai-to-claude',
  c2o: 'claude-to-openai',
} as const

export type GatewayModeAlias = keyof typeof MODE_ALIASES
export type GatewayMode = (typeof MODE_ALIASES)[GatewayModeAlias]
export type InboundContract = 'chat-completions' | 'responses' | 'messages'
export type TransportKind = 'json' | 'sse'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type ToolChoice = 'auto' | 'none' | 'required' | { name: string }
export type OpenAIUpstreamApi = 'responses' | 'chat-completions'

export function isGatewayModeAlias(value: string): value is GatewayModeAlias {
  return value === 'o2c' || value === 'c2o'
}

export function isGatewayMode(value: string): value is GatewayMode {
  return value === 'openai-to-claude' || value === 'claude-to-openai'
}

export function normalizeMode(value: GatewayMode | GatewayModeAlias): GatewayMode {
  if (isGatewayMode(value)) {
    return value
  }

  return MODE_ALIASES[value]
}
