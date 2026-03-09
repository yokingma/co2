import { z } from 'zod'

const textBlockSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string(),
})

const toolUseBlockSchema = z.strictObject({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
})

const toolResultBlockSchema = z.strictObject({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  content: z.union([z.string(), z.array(textBlockSchema).min(1)]),
  is_error: z.boolean().optional(),
})

const contentBlockSchema = z.union([textBlockSchema, toolUseBlockSchema, toolResultBlockSchema])

const toolSchema = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  input_schema: z.unknown(),
})

const thinkingConfigSchema = z.union([
  z.strictObject({
    type: z.literal('disabled'),
  }),
  z.strictObject({
    type: z.literal('adaptive'),
  }),
  z.strictObject({
    type: z.literal('enabled'),
    budget_tokens: z.number().int().min(1024),
  }),
])

const toolChoiceSchema = z.union([
  z.strictObject({
    type: z.literal('auto'),
    disable_parallel_tool_use: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('none'),
  }),
  z.strictObject({
    type: z.literal('any'),
    disable_parallel_tool_use: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('tool'),
    name: z.string().min(1),
    disable_parallel_tool_use: z.boolean().optional(),
  }),
])

const messageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(contentBlockSchema).min(1)]),
})

export const claudeMessagesSchema = z.strictObject({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z.array(messageSchema).min(1),
  system: z.union([z.string(), z.array(textBlockSchema).min(1)]).optional(),
  tools: z.array(toolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  thinking: thinkingConfigSchema.optional(),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stop_sequences: z.array(z.string().min(1)).min(1).optional(),
})
