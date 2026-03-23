import { z } from 'zod'

const functionToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    parameters: z.unknown().optional(),
  }).passthrough(),
}).passthrough()

const legacyFunctionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  parameters: z.unknown().optional(),
}).passthrough()

const toolChoiceSchema = z.union([
  z.literal('auto'),
  z.literal('none'),
  z.literal('required'),
  z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string().min(1),
    }).passthrough(),
  }).passthrough(),
])

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }).passthrough(),
}).passthrough()

const systemMessageSchema = z.object({
  role: z.literal('system'),
  content: z.string().min(1),
}).passthrough()

const userMessageSchema = z.object({
  role: z.literal('user'),
  content: z.string(),
}).passthrough()

const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
}).passthrough()

const toolMessageSchema = z.object({
  role: z.literal('tool'),
  content: z.string(),
  tool_call_id: z.string().min(1),
}).passthrough()

export const openAIChatCompletionsSchema = z.strictObject({
  model: z.string().min(1),
  messages: z
    .array(z.discriminatedUnion('role', [systemMessageSchema, userMessageSchema, assistantMessageSchema, toolMessageSchema]))
    .min(1),
  tools: z.array(functionToolSchema).optional(),
  functions: z.array(legacyFunctionSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  function_call: z.union([
    z.literal('auto'),
    z.literal('none'),
    z.object({
      name: z.string().min(1),
    }).passthrough(),
  ]).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().gt(0).lte(1).optional(),
  stop: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  reasoning_effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  // Allow only the known SDK/control-plane keys we intentionally absorb.
  // Keeping this allowlist explicit prevents typos from being silently ignored.
  metadata: z.unknown().optional(),
  modalities: z.array(z.string().min(1)).optional(),
  audio: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
})
