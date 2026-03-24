import { z } from 'zod'

const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
}).passthrough()

const toolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
}).passthrough()

const toolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  content: z.union([z.string(), z.array(textBlockSchema).min(1)]),
  is_error: z.boolean().optional(),
}).passthrough()

const contentBlockSchema = z.union([textBlockSchema, toolUseBlockSchema, toolResultBlockSchema])

const toolSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  input_schema: z.unknown(),
}).passthrough()

const thinkingConfigSchema = z.union([
  z.object({
    type: z.literal('disabled'),
  }).passthrough(),
  z.object({
    type: z.literal('adaptive'),
  }).passthrough(),
  z.object({
    type: z.literal('enabled'),
    budget_tokens: z.number().int().min(1024),
  }).passthrough(),
])

const outputConfigSchema = z.object({
  effort: z.enum(['low', 'medium', 'high', 'max']),
}).passthrough()

const toolChoiceSchema = z.union([
  z.object({
    type: z.literal('auto'),
    disable_parallel_tool_use: z.boolean().optional(),
  }).passthrough(),
  z.object({
    type: z.literal('none'),
  }).passthrough(),
  z.object({
    type: z.literal('any'),
    disable_parallel_tool_use: z.boolean().optional(),
  }).passthrough(),
  z.object({
    type: z.literal('tool'),
    name: z.string().min(1),
    disable_parallel_tool_use: z.boolean().optional(),
  }).passthrough(),
])

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(contentBlockSchema).min(1)]),
}).passthrough()

export const claudeMessagesSchema = z.strictObject({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  messages: z.array(messageSchema).min(1),
  system: z.union([z.string(), z.array(textBlockSchema).min(1)]).optional(),
  tools: z.array(toolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  thinking: thinkingConfigSchema.optional(),
  output_config: outputConfigSchema.optional(),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().gt(0).lte(1).optional(),
  stop_sequences: z.array(z.string().min(1)).min(1).optional(),
  // Only the explicitly supported control-plane fields should bypass strict validation.
  metadata: z.unknown().optional(),
  container: z.string().min(1).optional(),
})
