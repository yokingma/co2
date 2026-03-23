import { createHash } from 'node:crypto'
import type { ToolChoice } from '../../shared/contracts.js'
import type { NormalizedMessage, NormalizedToolDefinition, ToolNameAliases } from '../../shared/types.js'

const ANTHROPIC_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/
const MAX_ANTHROPIC_TOOL_NAME_LENGTH = 128
const TOOL_NAME_ALIAS_PREFIX = 'co2'
const TOOL_NAME_ALIAS_HASH_LENGTH = 16

function isAnthropicToolNameCompatible(name: string): boolean {
  return ANTHROPIC_TOOL_NAME_PATTERN.test(name)
}

function normalizeAliasStem(name: string): string {
  const normalized = name
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized.length > 0 ? normalized : 'tool'
}

function buildAliasCandidate(originalName: string, salt: number): string {
  const hashInput = salt === 0 ? originalName : `${originalName}:${salt}`
  const hash = createHash('sha256').update(hashInput).digest('hex').slice(0, TOOL_NAME_ALIAS_HASH_LENGTH)
  const separatorLength = 2
  const maxStemLength = MAX_ANTHROPIC_TOOL_NAME_LENGTH - TOOL_NAME_ALIAS_PREFIX.length - separatorLength - hash.length
  const stem = normalizeAliasStem(originalName).slice(0, Math.max(1, maxStemLength))

  return `${TOOL_NAME_ALIAS_PREFIX}_${stem}_${hash}`
}

function createToolNameAliasMap(toolNames: string[]): ToolNameAliases | undefined {
  const uniqueToolNames = [...new Set(toolNames.filter((name) => name.length > 0))]
  const originalToAnthropic: Record<string, string> = {}
  const anthropicToOriginal: Record<string, string> = {}
  const reservedAnthropicNames = new Set(uniqueToolNames.filter(isAnthropicToolNameCompatible))
  let hasAliases = false

  for (const toolName of uniqueToolNames) {
    if (isAnthropicToolNameCompatible(toolName)) {
      continue
    }

    let salt = 0
    let alias = buildAliasCandidate(toolName, salt)
    while (reservedAnthropicNames.has(alias)) {
      salt += 1
      alias = buildAliasCandidate(toolName, salt)
    }

    originalToAnthropic[toolName] = alias
    anthropicToOriginal[alias] = toolName
    reservedAnthropicNames.add(alias)
    hasAliases = true
  }

  return hasAliases
    ? {
        originalToAnthropic,
        anthropicToOriginal,
      }
    : undefined
}

function collectToolNamesFromMessages(messages: NormalizedMessage[]): string[] {
  return messages.flatMap((message) => message.parts.flatMap((part) => part.type === 'tool-call' ? [part.name] : []))
}

export function createAnthropicToolNameAliases(
  tools: NormalizedToolDefinition[],
  messages: NormalizedMessage[],
  toolChoice: ToolChoice | undefined,
): ToolNameAliases | undefined {
  const toolChoiceNames = typeof toolChoice === 'object' ? [toolChoice.name] : []

  return createToolNameAliasMap([
    ...tools.map((tool) => tool.name),
    ...toolChoiceNames,
    ...collectToolNamesFromMessages(messages),
  ])
}

export function toAnthropicToolName(name: string, aliases: ToolNameAliases | undefined): string {
  return aliases?.originalToAnthropic[name] ?? name
}

export function fromAnthropicToolName(name: string, aliases: ToolNameAliases | undefined): string {
  return aliases?.anthropicToOriginal[name] ?? name
}
