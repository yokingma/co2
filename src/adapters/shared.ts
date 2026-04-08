import type {
  ClaudeContentBlock,
  ClaudeInboundOutputEffort,
  ClaudeImageBlock,
  ClaudeMessage,
  ClaudeMessagesRequest,
  ClaudeToolChoice,
  ClaudeToolDefinition,
  NormalizedImageSource,
  NormalizedContentPart,
  NormalizedMessage,
  NormalizationWarning,
  ClaudeThinkingConfig,
  ClaudeOutputEffort,
  NormalizedRequest,
  NormalizedToolDefinition,
  OpenAIChatImageUrlContentPart,
  OpenAIChatMessage,
  OpenAIChatTextContentPart,
  OpenAIChatToolChoiceObject,
  OpenAIFunctionTool,
  OpenAIResponsesInputImage,
  OpenAIReasoningConfig,
  OpenAIResponsesInputItem,
  OpenAIResponsesTool,
  OpenAIResponsesToolChoice,
  RuntimeConfig,
  ToolNameAliases,
  Usage,
} from '../shared/types.js'
import type { ToolChoice } from '../shared/contracts.js'
import { createMappingError } from '../shared/errors.js'
import { toAnthropicToolName } from './openai-to-claude/tool-name-aliasing.js'

export function resolveTargetModel(config: RuntimeConfig, sourceModel: string, mode: RuntimeConfig['server']['mode']): string {
  const mappedModel = config.modelMap[sourceModel]

  if (mappedModel) {
    return mappedModel
  }

  if (mode === 'openai-to-claude' && config.routing.defaultClaudeModel) {
    return config.routing.defaultClaudeModel
  }

  if (mode === 'claude-to-openai' && config.routing.defaultOpenAIModel) {
    return config.routing.defaultOpenAIModel
  }

  throw createMappingError(`Model mapping not found for ${sourceModel}`, 'model')
}

export function normalizeStopSequences(stop: string | string[] | undefined): string[] | undefined {
  if (!stop) {
    return undefined
  }

  return Array.isArray(stop) ? stop : [stop]
}

export function stringifyToolInput(input: unknown): string {
  return JSON.stringify(input)
}

export function parseToolArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson)
  } catch {
    throw createMappingError('Invalid tool arguments JSON', 'arguments')
  }
}

export function collectText(parts: NormalizedContentPart[]): string {
  return parts
    .filter((part): part is Extract<NormalizedContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export function createTextPart(text: string): NormalizedContentPart {
  return {
    type: 'text',
    text,
  }
}

export function createImagePart(source: NormalizedImageSource): Extract<NormalizedContentPart, { type: 'image' }> {
  return {
    type: 'image',
    source,
  }
}

export function createNormalizationWarning(path: string, reason: string): NormalizationWarning {
  return {
    path,
    reason,
    action: 'ignored',
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function parseImageDataUrl(value: string): { mediaType: string; data: string } | undefined {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([^\s]+)$/.exec(value)
  if (!match) {
    return undefined
  }

  const [, mediaType, data] = match
  if (!mediaType || !data) {
    return undefined
  }

  return {
    mediaType,
    data,
  }
}

export function parseOpenAIImageUrl(
  imageUrl: string,
): { part?: Extract<NormalizedContentPart, { type: 'image' }>; reason?: string } {
  if (isHttpUrl(imageUrl)) {
    return {
      part: createImagePart({
        type: 'url',
        url: imageUrl,
      }),
    }
  }

  const parsedDataUrl = parseImageDataUrl(imageUrl)
  if (parsedDataUrl) {
    return {
      part: createImagePart({
        type: 'base64',
        mediaType: parsedDataUrl.mediaType,
        data: parsedDataUrl.data,
      }),
    }
  }

  return {
    reason: 'Unsupported image URL format; expected http(s) URL or data:image/...;base64,...',
  }
}

export function normalizedImagePartToAnthropicBlock(part: Extract<NormalizedContentPart, { type: 'image' }>): ClaudeImageBlock {
  if (part.source.type === 'url') {
    return {
      type: 'image',
      source: {
        type: 'url',
        url: part.source.url,
      },
    }
  }

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: part.source.mediaType,
      data: part.source.data,
    },
  }
}

export function normalizedImagePartToOpenAIInputImage(part: Extract<NormalizedContentPart, { type: 'image' }>): OpenAIResponsesInputImage {
  if (part.source.type === 'url') {
    return {
      type: 'input_image',
      image_url: part.source.url,
    }
  }

  return {
    type: 'input_image',
    image_url: `data:${part.source.mediaType};base64,${part.source.data}`,
  }
}

export function extractUsageFromRecord(raw: unknown, fallback?: Usage): Usage | undefined {
  if (!raw || typeof raw !== 'object') {
    return fallback
  }

  const record = raw as Record<string, unknown>
  const inputTokens = typeof record.input_tokens === 'number' ? record.input_tokens : fallback?.inputTokens
  const outputTokens = typeof record.output_tokens === 'number' ? record.output_tokens : fallback?.outputTokens
  const totalTokens = typeof record.total_tokens === 'number'
    ? record.total_tokens
    : inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : fallback?.totalTokens

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  }
}

export function toAnthropicToolChoice(toolChoice: ToolChoice | undefined, aliases?: ToolNameAliases): ClaudeToolChoice | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (toolChoice === 'auto') {
    return { type: 'auto', disable_parallel_tool_use: true }
  }

  if (toolChoice === 'none') {
    return { type: 'none' }
  }

  if (toolChoice === 'required') {
    return { type: 'any', disable_parallel_tool_use: true }
  }

  return {
    type: 'tool',
    name: toAnthropicToolName(toolChoice.name, aliases),
    disable_parallel_tool_use: true,
  }
}

export function toResponsesToolChoice(toolChoice: ToolChoice | undefined): OpenAIResponsesToolChoice | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice as OpenAIResponsesToolChoice
  }

  return {
    type: 'function',
    name: toolChoice.name,
  }
}

export function toChatToolChoice(toolChoice: ToolChoice | undefined): 'auto' | 'none' | 'required' | OpenAIChatToolChoiceObject | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (typeof toolChoice === 'string') {
    return toolChoice
  }

  return {
    type: 'function',
    function: {
      name: toolChoice.name,
    },
  }
}

function thinkingBudgetToReasoningEffort(budgetTokens: number): OpenAIReasoningConfig['effort'] {
  if (budgetTokens >= 8192) {
    return 'xhigh'
  }

  if (budgetTokens >= 4096) {
    return 'high'
  }

  if (budgetTokens >= 2048) {
    return 'medium'
  }

  return 'low'
}

export function mapClaudeThinkingToOpenAIReasoning(thinking: ClaudeThinkingConfig | undefined): OpenAIReasoningConfig | undefined {
  if (!thinking) {
    return undefined
  }

  if (thinking.type === 'disabled') {
    return { effort: 'none' }
  }

  if (thinking.type === 'adaptive') {
    return { effort: 'medium' }
  }

  return {
    effort: thinkingBudgetToReasoningEffort(thinking.budgetTokens),
  }
}

function mapClaudeOutputEffortToOpenAIReasoningEffort(
  effort: ClaudeInboundOutputEffort | undefined,
): OpenAIReasoningConfig['effort'] | undefined {
  switch (effort) {
    case 'none':
      return 'none'
    case 'minimal':
      return 'minimal'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'xhigh':
    case 'max':
      return 'xhigh'
    default:
      return undefined
  }
}

export function mapClaudeThinkingAndOutputConfigToOpenAIReasoning(
  thinking: ClaudeThinkingConfig | undefined,
  outputConfig: { effort: ClaudeInboundOutputEffort } | undefined,
): OpenAIReasoningConfig | undefined {
  if (thinking?.type === 'disabled') {
    return { effort: 'none' }
  }

  const reasoningFromThinking = mapClaudeThinkingToOpenAIReasoning(thinking)
  const effortFromOutputConfig = mapClaudeOutputEffortToOpenAIReasoningEffort(outputConfig?.effort)

  if (!reasoningFromThinking && !effortFromOutputConfig) {
    return undefined
  }

  return {
    ...reasoningFromThinking,
    effort: effortFromOutputConfig ?? reasoningFromThinking?.effort,
  }
}

export function mapOpenAIReasoningToClaudeThinking(reasoning: OpenAIReasoningConfig | undefined): ClaudeThinkingConfig | undefined {
  if (!reasoning) {
    return undefined
  }

  if (reasoning.effort === 'none') {
    return { type: 'disabled' }
  }

  return { type: 'adaptive' }
}

function mapOpenAIReasoningEffortToClaudeOutputEffort(
  effort: OpenAIReasoningConfig['effort'] | undefined,
): ClaudeOutputEffort | undefined {
  switch (effort) {
    case 'minimal':
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
      return 'high'
    case 'xhigh':
      return 'max'
    default:
      return undefined
  }
}

function resolveClaudeOutputEffort(
  config: RuntimeConfig,
  request: NormalizedRequest,
): ClaudeOutputEffort | undefined {
  if (!request.reasoning) {
    return config.routing.claudeOutputEffort
  }

  return mapOpenAIReasoningEffortToClaudeOutputEffort(request.reasoning.effort)
}

function resolveOpenAIReasoning(
  config: RuntimeConfig,
  request: NormalizedRequest,
): OpenAIReasoningConfig | undefined {
  if (request.reasoning) {
    return request.reasoning
  }

  if (!config.routing.openAIReasoningEffort) {
    return undefined
  }

  return { effort: config.routing.openAIReasoningEffort }
}

function resolveOpenAIChatReasoningEffort(
  config: RuntimeConfig,
  request: NormalizedRequest,
): OpenAIReasoningConfig['effort'] | undefined {
  const effort = resolveOpenAIReasoning(config, request)?.effort

  switch (effort) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return effort
    default:
      return undefined
  }
}

function resolveOpenAIParallelToolCalls(
  config: RuntimeConfig,
  request: NormalizedRequest,
): boolean | undefined {
  if (request.tools.length === 0) {
    return undefined
  }

  return config.routing.openAIParallelToolCalls
}

export function normalizedToolsToAnthropicTools(tools: NormalizedToolDefinition[], aliases?: ToolNameAliases): ClaudeToolDefinition[] {
  return tools.map((tool) => ({
    name: toAnthropicToolName(tool.name, aliases),
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

export function normalizedToolsToResponsesTools(tools: NormalizedToolDefinition[]): OpenAIResponsesTool[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }))
}

export function normalizedToolsToChatTools(tools: NormalizedToolDefinition[]): OpenAIFunctionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}

export function collectInstructions(messages: NormalizedMessage[], instructions?: string): string | undefined {
  const systemText = messages
    .filter((message) => message.role === 'system')
    .map((message) => collectText(message.parts))
    .filter((value) => value.length > 0)

  const allInstructions = instructions ? [...systemText, instructions] : systemText
  if (allInstructions.length === 0) {
    return undefined
  }

  return allInstructions.join('\n\n')
}

function toAnthropicContentBlocks(
  parts: NormalizedContentPart[],
  role: 'user' | 'assistant',
  aliases?: ToolNameAliases,
): string | ClaudeContentBlock[] {
  const blocks = parts.flatMap((part): ClaudeContentBlock[] => {
    if (part.type === 'text') {
      return [{ type: 'text', text: part.text }]
    }

    if (part.type === 'image' && role === 'user') {
      return [normalizedImagePartToAnthropicBlock(part)]
    }

    if (part.type === 'tool-call' && role === 'assistant') {
      return [{
        type: 'tool_use',
        id: part.id,
        name: toAnthropicToolName(part.name, aliases),
        input: parseToolArguments(part.argumentsJson),
      }]
    }

    if (part.type === 'tool-result' && role === 'user') {
      return [{
        type: 'tool_result',
        tool_use_id: part.toolCallId,
        content: part.output,
        is_error: part.isError,
      }]
    }

    return []
  })

  if (blocks.length === 1 && blocks[0]?.type === 'text') {
    return blocks[0].text
  }

  return blocks
}

export function normalizedMessagesToAnthropicMessages(messages: NormalizedMessage[], aliases?: ToolNameAliases): ClaudeMessage[] {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      const role = message.role === 'assistant' ? 'assistant' : 'user'
      return {
        role,
        content: toAnthropicContentBlocks(message.parts, role, aliases),
      }
    })
}

function toResponsesContentParts(
  role: 'user' | 'assistant' | 'tool',
  parts: NormalizedContentPart[],
): Array<import('../shared/types.js').OpenAIResponsesInputText | import('../shared/types.js').OpenAIResponsesOutputTextInput | OpenAIResponsesInputImage> {
  const content: Array<import('../shared/types.js').OpenAIResponsesInputText | import('../shared/types.js').OpenAIResponsesOutputTextInput | OpenAIResponsesInputImage> = []

  for (const part of parts) {
    if (part.type === 'text') {
      content.push({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: part.text,
      })
      continue
    }

    if (part.type === 'image' && role === 'user') {
      content.push(normalizedImagePartToOpenAIInputImage(part))
    }
  }

  return content
}

function pushResponsesMessageItem(items: OpenAIResponsesInputItem[], role: 'user' | 'assistant' | 'tool', parts: NormalizedContentPart[]): void {
  const content = toResponsesContentParts(role, parts)
  if (content.length === 0) {
    return
  }

  items.push({
    role,
    content,
  })
}

export function normalizedMessagesToResponsesInput(messages: NormalizedMessage[]): OpenAIResponsesInputItem[] {
  const items: OpenAIResponsesInputItem[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      continue
    }

    if (message.role === 'user' || message.role === 'assistant') {
      pushResponsesMessageItem(items, message.role, message.parts)
    }

    for (const part of message.parts) {
      if (part.type === 'tool-call') {
        items.push({
          type: 'function_call',
          call_id: part.id,
          name: part.name,
          arguments: part.argumentsJson,
        })
      }

      if (part.type === 'tool-result') {
        items.push({
          type: 'function_call_output',
          call_id: part.toolCallId,
          output: part.output,
        })
      }
    }
  }

  return items
}

function toChatUserContent(
  parts: NormalizedContentPart[],
): string | Array<OpenAIChatTextContentPart | OpenAIChatImageUrlContentPart> | undefined {
  const content: Array<OpenAIChatTextContentPart | OpenAIChatImageUrlContentPart> = []

  for (const part of parts) {
    if (part.type === 'text') {
      content.push({
        type: 'text',
        text: part.text,
      })
      continue
    }

    if (part.type === 'image') {
      content.push({
        type: 'image_url',
        image_url: {
          url: part.source.type === 'url'
            ? part.source.url
            : `data:${part.source.mediaType};base64,${part.source.data}`,
        },
      })
    }
  }

  if (content.length === 0) {
    return undefined
  }

  if (content.every((part) => part.type === 'text')) {
    return content.map((part) => part.text).join('')
  }

  return content
}

export function normalizedMessagesToChatMessages(messages: NormalizedMessage[]): OpenAIChatMessage[] {
  const chatMessages: OpenAIChatMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      const content = collectText(message.parts)
      if (content.length > 0) {
        chatMessages.push({
          role: 'system',
          content,
        })
      }
      continue
    }

    if (message.role === 'assistant') {
      const content = collectText(message.parts)
      const toolCalls = message.parts.flatMap((part) => part.type === 'tool-call'
        ? [{
            id: part.id,
            type: 'function' as const,
            function: {
              name: part.name,
              arguments: part.argumentsJson,
            },
          }]
        : [])

      if (content.length > 0 || toolCalls.length > 0) {
        chatMessages.push({
          role: 'assistant',
          content: content.length > 0 ? content : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        })
      }
      continue
    }

    if (message.role === 'user') {
      const userContent = toChatUserContent(message.parts)
      for (const part of message.parts) {
        if (part.type === 'tool-result') {
          chatMessages.push({
            role: 'tool',
            content: part.output,
            tool_call_id: part.toolCallId,
          })
        }
      }

      if (userContent !== undefined) {
        chatMessages.push({
          role: 'user',
          content: userContent,
        })
      }
    }
  }

  return chatMessages
}

export function buildAnthropicMessagesRequest(config: RuntimeConfig, request: NormalizedRequest): ClaudeMessagesRequest {
  const outputEffort = resolveClaudeOutputEffort(config, request)
  const requestThinking = mapOpenAIReasoningToClaudeThinking(request.reasoning)
  return {
    model: resolveTargetModel(config, request.model, request.mode),
    max_tokens: request.maxOutputTokens ?? 1024,
    messages: normalizedMessagesToAnthropicMessages(request.messages, request.toolNameAliases),
    system: collectInstructions(request.messages, request.instructions),
    tools: request.tools.length > 0 ? normalizedToolsToAnthropicTools(request.tools, request.toolNameAliases) : undefined,
    tool_choice: toAnthropicToolChoice(request.toolChoice, request.toolNameAliases),
    thinking: requestThinking ?? (outputEffort ? { type: 'adaptive' } : undefined),
    output_config: outputEffort ? { effort: outputEffort } : undefined,
    stream: request.transport === 'sse',
    temperature: request.temperature,
    top_p: request.topP,
    stop_sequences: request.stopSequences,
  }
}

export function buildOpenAIResponsesRequest(config: RuntimeConfig, request: NormalizedRequest): import('../shared/types.js').OpenAIResponsesRequest {
  const input = normalizedMessagesToResponsesInput(request.messages)
  return {
    model: resolveTargetModel(config, request.model, request.mode),
    input,
    instructions: collectInstructions(request.messages, request.instructions),
    tools: request.tools.length > 0 ? normalizedToolsToResponsesTools(request.tools) : undefined,
    tool_choice: toResponsesToolChoice(request.toolChoice),
    reasoning: resolveOpenAIReasoning(config, request),
    parallel_tool_calls: resolveOpenAIParallelToolCalls(config, request),
    stream: request.transport === 'sse',
    max_output_tokens: request.maxOutputTokens,
    temperature: request.temperature,
    top_p: request.topP,
  }
}

export function buildOpenAIChatRequest(config: RuntimeConfig, request: NormalizedRequest): import('../shared/types.js').OpenAIChatRequest {
  return {
    model: resolveTargetModel(config, request.model, request.mode),
    messages: normalizedMessagesToChatMessages(request.messages),
    tools: request.tools.length > 0 ? normalizedToolsToChatTools(request.tools) : undefined,
    tool_choice: toChatToolChoice(request.toolChoice),
    stream: request.transport === 'sse',
    temperature: request.temperature,
    top_p: request.topP,
    stop: request.stopSequences,
    reasoning_effort: resolveOpenAIChatReasoningEffort(config, request),
    max_tokens: request.maxOutputTokens,
    parallel_tool_calls: resolveOpenAIParallelToolCalls(config, request),
  }
}
