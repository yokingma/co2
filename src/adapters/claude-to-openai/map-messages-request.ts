import { claudeMessagesSchema, claudeMessagesTopLevelKeys } from '../../schemas/claude/messages-schema.js'
import {
  buildOpenAIChatRequest,
  buildOpenAIResponsesRequest,
  createImagePart,
  createNormalizationWarning,
  createTextPart,
  isHttpUrl,
  mapClaudeThinkingAndOutputConfigToOpenAIReasoning,
  stringifyToolInput,
} from '../shared.js'
import type { NormalizationWarning, NormalizedContentPart, NormalizedMessage, NormalizedRequest, RuntimeConfig } from '../../shared/types.js'
import type { ToolChoice } from '../../shared/contracts.js'
import { createUnsupportedParameterError, createUnsupportedToolError, createValidationError } from '../../shared/errors.js'

const CLAUDE_MESSAGES_TOP_LEVEL_KEY_SET = new Set<string>(claudeMessagesTopLevelKeys)

const UNSUPPORTED_CLAUDE_MESSAGES_FIELDS = new Map<string, string>([
  ['top_k', 'top_k is not supported because there is no accurate OpenAI Responses equivalent in V1'],
  [
    'context_management',
    'context_management is not supported in V1 because OpenAI Responses has no equivalent and silently ignoring it would drop Anthropic context-editing semantics',
  ],
])

const CLAUDE_MESSAGES_KNOWN_FIELD_NAMES = [
  ...claudeMessagesTopLevelKeys,
  ...UNSUPPORTED_CLAUDE_MESSAGES_FIELDS.keys(),
]

function normalizeToolChoice(toolChoice: ReturnType<typeof claudeMessagesSchema.parse>['tool_choice']): ToolChoice | undefined {
  if (!toolChoice || toolChoice.type === 'none') {
    return toolChoice?.type
  }

  if (toolChoice.type === 'auto') {
    return 'auto'
  }

  if (toolChoice.type === 'any') {
    return 'required'
  }

  return { name: toolChoice.name }
}

function ensureMessageHasParts(parts: NormalizedMessage['parts'], path: string): void {
  if (parts.length === 0) {
    throw createValidationError('Message must contain at least one supported content part', path)
  }
}

function normalizeBlocks(
  role: 'user' | 'assistant',
  content: string | ReturnType<typeof claudeMessagesSchema.parse>['messages'][number]['content'],
  messageIndex: number,
): { parts: NormalizedContentPart[]; warnings: NormalizationWarning[] } {
  if (typeof content === 'string') {
    return {
      parts: [createTextPart(content)],
      warnings: [],
    }
  }

  const parts: NormalizedContentPart[] = []
  const warnings: NormalizationWarning[] = []

  for (const [blockIndex, block] of content.entries()) {
    const path = `messages[${messageIndex}].content[${blockIndex}]`

    if (block.type === 'text') {
      parts.push(createTextPart(block.text))
      continue
    }

    if (block.type === 'image') {
      if (role !== 'user') {
        warnings.push(createNormalizationWarning(path, 'Image content is only supported on user messages'))
        continue
      }

      if (block.source.type === 'url') {
        if (!isHttpUrl(block.source.url)) {
          warnings.push(createNormalizationWarning(path, 'Unsupported image URL format; expected http(s) URL'))
          continue
        }

        parts.push(createImagePart({
          type: 'url',
          url: block.source.url,
        }))
        continue
      }

      if (!block.source.media_type.startsWith('image/')) {
        warnings.push(createNormalizationWarning(path, 'Unsupported image media_type; expected image/*'))
        continue
      }

      parts.push(createImagePart({
        type: 'base64',
        mediaType: block.source.media_type,
        data: block.source.data,
      }))
      continue
    }

    if (block.type === 'tool_use') {
      parts.push({
        type: 'tool-call',
        id: block.id,
        name: block.name,
        argumentsJson: stringifyToolInput(block.input),
      })
      continue
    }

    parts.push({
      type: 'tool-result',
      toolCallId: block.tool_use_id,
      output: typeof block.content === 'string' ? block.content : block.content.map((part) => part.text).join(''),
      isError: block.is_error,
    })
  }

  return {
    parts,
    warnings,
  }
}

function normalizeMessages(parsed: ReturnType<typeof claudeMessagesSchema.parse>): { messages: NormalizedMessage[]; warnings: NormalizationWarning[] } {
  const messages: NormalizedMessage[] = []
  const warnings: NormalizationWarning[] = []

  if (parsed.system) {
    messages.push({
      role: 'system',
      parts: typeof parsed.system === 'string' ? [createTextPart(parsed.system)] : parsed.system.map((block) => createTextPart(block.text)),
    })
  }

  for (const [messageIndex, message] of parsed.messages.entries()) {
    const normalizedBlocks = normalizeBlocks(message.role, message.content, messageIndex)
    ensureMessageHasParts(normalizedBlocks.parts, `messages[${messageIndex}].content`)
    messages.push({
      role: message.role,
      parts: normalizedBlocks.parts,
    })
    warnings.push(...normalizedBlocks.warnings)
  }

  return {
    messages,
    warnings,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0
    previous[0] = leftIndex + 1

    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const up = previous[rightIndex + 1] ?? 0
      const nextDiagonal = up
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1
      previous[rightIndex + 1] = Math.min(
        up + 1,
        (previous[rightIndex] ?? 0) + 1,
        diagonal + substitutionCost,
      )
      diagonal = nextDiagonal
    }
  }

  return previous[right.length] ?? 0
}

function getUnknownTopLevelKeys(body: Record<string, unknown>): string[] {
  return Object.keys(body).filter((key) => !CLAUDE_MESSAGES_TOP_LEVEL_KEY_SET.has(key))
}

function findLikelyTypoKey(key: string): string | undefined {
  const normalizedKey = key.toLowerCase()

  return CLAUDE_MESSAGES_KNOWN_FIELD_NAMES.find((knownKey) => {
    if (normalizedKey[0] !== knownKey[0]) {
      return false
    }

    return levenshteinDistance(normalizedKey, knownKey) <= 2
  })
}

function validateCompatibleClaudeMessagesRequest(body: unknown): void {
  if (!isRecord(body)) {
    return
  }

  for (const [field, message] of UNSUPPORTED_CLAUDE_MESSAGES_FIELDS) {
    if (body[field] !== undefined) {
      throw createUnsupportedParameterError(message, field)
    }
  }

  const tools = Array.isArray(body.tools) ? body.tools : []
  for (const tool of tools) {
    if (isRecord(tool) && typeof tool.type === 'string') {
      throw createUnsupportedToolError('Only client-defined tools are supported in V1')
    }
  }

  for (const unknownKey of getUnknownTopLevelKeys(body)) {
    if (findLikelyTypoKey(unknownKey)) {
      throw createValidationError(`Unrecognized key: "${unknownKey}"`, unknownKey)
    }
  }
}

export function normalizeClaudeMessagesRequest(body: unknown, mode: RuntimeConfig['server']['mode'], requestId: string): NormalizedRequest {
  validateCompatibleClaudeMessagesRequest(body)
  const parsed = claudeMessagesSchema.parse(body)
  const normalizedMessages = normalizeMessages(parsed)
  const normalizedTools = (parsed.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
  }))

  return {
    mode,
    contract: 'messages',
    transport: parsed.stream ? 'sse' : 'json',
    model: parsed.model,
    messages: normalizedMessages.messages,
    tools: normalizedTools,
    toolChoice: normalizeToolChoice(parsed.tool_choice) ?? (normalizedTools.length > 0 ? 'auto' : undefined),
    maxOutputTokens: parsed.max_tokens,
    temperature: parsed.temperature,
    topP: parsed.top_p,
    stopSequences: parsed.stop_sequences,
    reasoning: mapClaudeThinkingAndOutputConfigToOpenAIReasoning(
      parsed.thinking
        ? parsed.thinking.type === 'enabled'
          ? { type: 'enabled', budgetTokens: parsed.thinking.budget_tokens }
          : { type: parsed.thinking.type }
        : undefined,
      parsed.output_config,
    ),
    warnings: normalizedMessages.warnings,
    requestId,
  }
}

export function mapClaudeMessagesToOpenAIResponsesRequest(config: RuntimeConfig, request: NormalizedRequest) {
  return buildOpenAIResponsesRequest(config, request)
}

export function mapClaudeMessagesToOpenAIChatRequest(config: RuntimeConfig, request: NormalizedRequest) {
  return buildOpenAIChatRequest(config, request)
}
