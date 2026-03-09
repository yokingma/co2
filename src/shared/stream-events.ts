export type NormalizedStreamEvent =
  | { type: 'message_start' }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_args_delta'; id: string; delta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'message_end'; finishReason?: string }
  | { type: 'error'; message: string }
