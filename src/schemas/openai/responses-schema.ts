import { z } from 'zod'

const inputTextSchema = z.strictObject({
  type: z.literal('input_text'),
  text: z.string(),
})

const responseMessageSchema = z.strictObject({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(inputTextSchema).min(1)]),
})

const functionCallInputSchema = z.strictObject({
  type: z.literal('function_call'),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
})

const functionCallOutputSchema = z.strictObject({
  type: z.literal('function_call_output'),
  call_id: z.string().min(1),
  output: z.string(),
})

const toolSchema = z.strictObject({
  type: z.literal('function'),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  parameters: z.unknown().optional(),
  strict: z.boolean().optional(),
})

const reasoningSchema = z
  .strictObject({
    effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    summary: z.enum(['auto', 'concise', 'detailed']).optional(),
    generate_summary: z.enum(['auto', 'concise', 'detailed']).optional(),
  })
  .refine((value) => value.effort !== undefined || value.summary !== undefined || value.generate_summary !== undefined, {
    message: 'reasoning must include at least one supported field',
  })

const toolChoiceSchema = z.union([
  z.literal('auto'),
  z.literal('none'),
  z.literal('required'),
  z.strictObject({
    type: z.literal('function'),
    name: z.string().min(1),
  }),
])

export const openAIResponsesSchema = z.strictObject({
  model: z.string().min(1),
  input: z.union([
    z.string().min(1),
    z.array(z.union([responseMessageSchema, functionCallInputSchema, functionCallOutputSchema])).min(1),
  ]),
  instructions: z.string().min(1).optional(),
  tools: z.array(toolSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  reasoning: reasoningSchema.optional(),
  stream: z.boolean().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
})
