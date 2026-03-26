import type { GatewayMode, InboundContract, LogLevel, ToolChoice, TransportKind } from './contracts.js'

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type NormalizedToolDefinition = {
  name: string
  description?: string
  inputSchema: unknown
}

export type ToolNameAliases = {
  originalToAnthropic: Record<string, string>
  anthropicToOriginal: Record<string, string>
}

export type NormalizedContentPart =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'tool-call'
      id: string
      name: string
      argumentsJson: string
    }
  | {
      type: 'tool-result'
      toolCallId: string
      output: string
      isError?: boolean
    }

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type ReasoningSummary = 'auto' | 'concise' | 'detailed'

export type OpenAIReasoningConfig = {
  effort?: ReasoningEffort
  summary?: ReasoningSummary
}

export type OpenAIUpstreamReasoningConfig = {
  effort?: ReasoningEffort | (string & {})
  summary?: ReasoningSummary
}

export type ClaudeThinkingConfig =
  | {
      type: 'enabled'
      budgetTokens: number
    }
  | {
      type: 'disabled'
    }
  | {
      type: 'adaptive'
    }

export type ClaudeOutputEffort = 'low' | 'medium' | 'high' | 'max'

export type ClaudeOutputConfig = {
  effort: ClaudeOutputEffort
}

export type NormalizedMessage = {
  role: MessageRole
  parts: NormalizedContentPart[]
}

export type NormalizedRequest = {
  mode: GatewayMode
  contract: InboundContract
  transport: TransportKind
  model: string
  messages: NormalizedMessage[]
  tools: NormalizedToolDefinition[]
  toolChoice?: ToolChoice
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
  instructions?: string
  reasoning?: OpenAIReasoningConfig
  streamIncludeUsage?: boolean
  toolNameAliases?: ToolNameAliases
  requestId: string
}

export type Usage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type NormalizedResponse = {
  responseId: string
  model: string
  message: {
    role: 'assistant'
    parts: NormalizedContentPart[]
  }
  finishReason?: string
  usage?: Usage
  status: 'completed' | 'in_progress' | 'failed'
}

export type RuntimeConfig = {
  server: {
    host: string
    port: number
    mode: GatewayMode
    logLevel: LogLevel
  }
  providers: {
    openai: {
      apiKey?: string
      baseUrl: string
      defaultHeaders: Record<string, string>
    }
    anthropic: {
      apiKey?: string
      baseUrl: string
      version: string
      defaultHeaders: Record<string, string>
    }
  }
  routing: {
    defaultOpenAIModel?: string
    defaultClaudeModel?: string
    claudeOutputEffort?: ClaudeOutputEffort
    openAIReasoningEffort?: string
    skipInboundFields: {
      claudeMessages: string[]
      openAIResponses: string[]
      openAIChatCompletions: string[]
    }
  }
  modelMap: Record<string, string>
}

export type Logger = {
  debug: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
}

export type OpenAIChatToolChoiceObject = {
  type: 'function'
  function: {
    name: string
  }
}

export type OpenAIFunctionTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: unknown
  }
}

export type OpenAIChatToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type OpenAIChatMessage =
  | {
      role: 'system'
      content: string
    }
  | {
      role: 'user'
      content: string
    }
  | {
      role: 'assistant'
      content?: string | null
      tool_calls?: OpenAIChatToolCall[]
    }
  | {
      role: 'tool'
      content: string
      tool_call_id: string
    }

export type OpenAIChatRequest = {
  model: string
  messages: OpenAIChatMessage[]
  tools?: OpenAIFunctionTool[]
  tool_choice?: 'auto' | 'none' | 'required' | OpenAIChatToolChoiceObject
  stream?: boolean
  stream_options?: {
    include_usage?: boolean
  }
  temperature?: number
  top_p?: number
  stop?: string | string[]
  reasoning_effort?: ReasoningEffort
  max_completion_tokens?: number
  max_tokens?: number
  parallel_tool_calls?: boolean
}

export type OpenAIResponsesTool = {
  type: 'function'
  name: string
  description?: string
  parameters?: unknown
  strict?: boolean
}

export type OpenAIResponsesToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | {
      type: 'function'
      name: string
    }

export type OpenAIResponsesInputText = {
  type: 'input_text'
  text: string
}

export type OpenAIResponsesOutputTextInput = {
  type: 'output_text'
  text: string
}

export type OpenAIResponsesMessageInput = {
  type?: 'message'
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content: string | Array<OpenAIResponsesInputText | OpenAIResponsesOutputTextInput>
  phase?: 'commentary' | 'final_answer' | null
}

export type OpenAIResponsesFunctionCallInput = {
  type: 'function_call'
  call_id: string
  name: string
  arguments: string
}

export type OpenAIResponsesFunctionCallOutputInput = {
  type: 'function_call_output'
  call_id: string
  output: string
}

export type OpenAIResponsesInputItem =
  | OpenAIResponsesMessageInput
  | OpenAIResponsesFunctionCallInput
  | OpenAIResponsesFunctionCallOutputInput

export type OpenAIResponsesRequest = {
  model: string
  input: string | OpenAIResponsesInputItem[]
  instructions?: string
  tools?: OpenAIResponsesTool[]
  tool_choice?: OpenAIResponsesToolChoice
  reasoning?: OpenAIUpstreamReasoningConfig
  parallel_tool_calls?: boolean
  stream?: boolean
  max_output_tokens?: number
  temperature?: number
  top_p?: number
}

export type OpenAIResponsesOutputText = {
  type: 'output_text'
  text: string
  annotations?: unknown[]
}

export type OpenAIResponsesOutputMessage = {
  type: 'message'
  id?: string
  role: 'assistant'
  status?: 'completed' | 'in_progress' | 'failed' | 'incomplete'
  content: OpenAIResponsesOutputText[]
}

export type OpenAIResponsesFunctionCallOutput = {
  type: 'function_call'
  id?: string
  call_id: string
  name: string
  arguments: string
  status?: 'completed' | 'in_progress' | 'failed' | 'incomplete'
}

export type OpenAIResponsesOutputItem = OpenAIResponsesOutputMessage | OpenAIResponsesFunctionCallOutput

export type OpenAIResponsesResponse = {
  id: string
  object: 'response'
  created_at?: number
  status: 'completed' | 'in_progress' | 'failed' | 'incomplete'
  model: string
  output: OpenAIResponsesOutputItem[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

export type ClaudeToolDefinition = {
  name: string
  description?: string
  input_schema: unknown
}

export type ClaudeTextBlock = {
  type: 'text'
  text: string
}

export type ClaudeToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export type ClaudeToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string | ClaudeTextBlock[]
  is_error?: boolean
}

export type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUseBlock | ClaudeToolResultBlock

export type ClaudeMessage = {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

export type ClaudeToolChoice =
  | {
      type: 'auto'
      disable_parallel_tool_use?: boolean
    }
  | {
      type: 'none'
    }
  | {
      type: 'any'
      disable_parallel_tool_use?: boolean
    }
  | {
      type: 'tool'
      name: string
      disable_parallel_tool_use?: boolean
    }

export type ClaudeMessagesRequest = {
  model: string
  max_tokens: number
  messages: ClaudeMessage[]
  system?: string
  tools?: ClaudeToolDefinition[]
  tool_choice?: ClaudeToolChoice
  thinking?: ClaudeThinkingConfig
  output_config?: ClaudeOutputConfig
  stream?: boolean
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
}

export type ClaudeMessagesResponse = {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: ClaudeContentBlock[]
  stop_reason?: string | null
  stop_sequence?: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

export type OpenAIResponsesStreamEvent = Record<string, unknown> & { type: string }
export type ClaudeStreamEvent = Record<string, unknown> & { type: string }
