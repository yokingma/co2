import { z } from 'zod'

const functionToolSchema = z.strictObject({
  type: z.literal('function'),
  function: z.strictObject({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    parameters: z.unknown().optional(),
  }),
})

const toolChoiceSchema = z.union([
  z.literal('auto'),
  z.literal('none'),
  z.literal('required'),
  z.strictObject({
    type: z.literal('function'),
    function: z.strictObject({
      name: z.string().min(1),
    }),
  }),
])

const toolCallSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.strictObject({
    name: z.string().min(1),
    arguments: z.string(),
  }),
})

const systemMessageSchema = z.strictObject({
  role: z.literal('system'),
  content: z.string().min(1),
})

const userMessageSchema = z.strictObject({
  role: z.literal('user'),
  content: z.string(),
})

const assistantMessageSchema = z.strictObject({
  role: z.literal('assistant'),
  content: z.string().nullable().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
})

const toolMessageSchema = z.strictObject({
  role: z.literal('tool'),
  content: z.string(),
  tool_call_id: z.string().min(1),
})

export const openAIChatCompletionsSchema = z.strictObject({
  model: z.string().min(1),
  messages: z
    .array(z.discriminatedUnion('role', [systemMessageSchema, userMessageSchema, assistantMessageSchema, toolMessageSchema]))
    .min(1),
  tools: z.array(functionToolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stop: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  max_completion_tokens: z.number().int().positive().optional(),
})
