import type {
  ClaudeContentBlock,
  ClaudeMessage,
  ClaudeMessagesRequest,
  ClaudeToolChoice,
  ClaudeToolDefinition,
  NormalizedContentPart,
  NormalizedMessage,
  ClaudeThinkingConfig,
  NormalizedRequest,
  NormalizedToolDefinition,
  OpenAIReasoningConfig,
  OpenAIResponsesInputItem,
  OpenAIResponsesTool,
  OpenAIResponsesToolChoice,
  RuntimeConfig,
} from '../shared/types.js'
import type { ToolChoice } from '../shared/contracts.js'
import { createMappingError } from '../shared/errors.js'

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

export function toAnthropicToolChoice(toolChoice: ToolChoice | undefined): ClaudeToolChoice | undefined {
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
    name: toolChoice.name,
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

export function mapOpenAIReasoningToClaudeThinking(reasoning: OpenAIReasoningConfig | undefined): ClaudeThinkingConfig | undefined {
  if (!reasoning) {
    return undefined
  }

  if (reasoning.effort === 'none') {
    return { type: 'disabled' }
  }

  return { type: 'adaptive' }
}

export function normalizedToolsToAnthropicTools(tools: NormalizedToolDefinition[]): ClaudeToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
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

function toAnthropicContentBlocks(parts: NormalizedContentPart[], role: 'user' | 'assistant'): string | ClaudeContentBlock[] {
  const blocks = parts.flatMap((part): ClaudeContentBlock[] => {
    if (part.type === 'text') {
      return [{ type: 'text', text: part.text }]
    }

    if (part.type === 'tool-call' && role === 'assistant') {
      return [{
        type: 'tool_use',
        id: part.id,
        name: part.name,
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

export function normalizedMessagesToAnthropicMessages(messages: NormalizedMessage[]): ClaudeMessage[] {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      const role = message.role === 'assistant' ? 'assistant' : 'user'
      return {
        role,
        content: toAnthropicContentBlocks(message.parts, role),
      }
    })
}

function pushResponsesMessageItem(items: OpenAIResponsesInputItem[], role: 'user' | 'assistant' | 'tool', parts: NormalizedContentPart[]): void {
  const text = collectText(parts)
  if (text.length === 0) {
    return
  }

  items.push({
    role,
    content: [{ type: 'input_text', text }],
  })
}

export function normalizedMessagesToResponsesInput(messages: NormalizedMessage[]): OpenAIResponsesInputItem[] {
  const items: OpenAIResponsesInputItem[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      continue
    }

    if (message.role === 'user' || message.role === 'assistant') {
      const textParts = message.parts.filter((part): part is Extract<NormalizedContentPart, { type: 'text' }> => part.type === 'text')
      pushResponsesMessageItem(items, message.role, textParts)
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

export function buildAnthropicMessagesRequest(config: RuntimeConfig, request: NormalizedRequest): ClaudeMessagesRequest {
  return {
    model: resolveTargetModel(config, request.model, request.mode),
    max_tokens: request.maxOutputTokens ?? 1024,
    messages: normalizedMessagesToAnthropicMessages(request.messages),
    system: collectInstructions(request.messages, request.instructions),
    tools: request.tools.length > 0 ? normalizedToolsToAnthropicTools(request.tools) : undefined,
    tool_choice: toAnthropicToolChoice(request.toolChoice),
    thinking: mapOpenAIReasoningToClaudeThinking(request.reasoning),
    stream: request.transport === 'sse',
    temperature: request.temperature,
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
    reasoning: request.reasoning,
    stream: request.transport === 'sse',
    max_output_tokens: request.maxOutputTokens,
    temperature: request.temperature,
  }
}
