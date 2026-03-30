import { z } from 'zod'

const inputTextSchema = z.object({
  type: z.literal('input_text'),
  text: z.string(),
}).passthrough()

const inputImageSchema = z.object({
  type: z.literal('input_image'),
  image_url: z.string().optional(),
  file_id: z.string().min(1).optional(),
  detail: z.enum(['low', 'high', 'auto', 'original']).optional(),
}).passthrough().refine((value) => value.image_url !== undefined || value.file_id !== undefined, {
  message: 'input_image must include image_url or file_id',
})

const outputTextSchema = z.object({
  type: z.literal('output_text'),
  text: z.string(),
}).passthrough()

const responseMessageSchema = z.object({
  type: z.literal('message').optional(),
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: z.union([z.string(), z.array(z.union([inputTextSchema, inputImageSchema, outputTextSchema])).min(1)]),
  phase: z.enum(['commentary', 'final_answer']).nullable().optional(),
}).passthrough()

const functionCallInputSchema = z.object({
  type: z.literal('function_call'),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
}).passthrough()

const functionCallOutputSchema = z.object({
  type: z.literal('function_call_output'),
  call_id: z.string().min(1),
  output: z.string(),
}).passthrough()

const toolSchema = z.object({
  type: z.literal('function'),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  parameters: z.unknown().optional(),
  strict: z.boolean().optional(),
}).passthrough()

const reasoningSchema = z
  .object({
    effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    summary: z.enum(['auto', 'concise', 'detailed']).optional(),
    generate_summary: z.enum(['auto', 'concise', 'detailed']).optional(),
  })
  .passthrough()
  .refine((value) => value.effort !== undefined || value.summary !== undefined || value.generate_summary !== undefined, {
    message: 'reasoning must include at least one supported field',
  })

const toolChoiceSchema = z.union([
  z.literal('auto'),
  z.literal('none'),
  z.literal('required'),
  z.object({
    type: z.literal('function'),
    name: z.string().min(1),
  }).passthrough(),
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
  top_p: z.number().gt(0).lte(1).optional(),
  // Allow only the known SDK/control-plane keys we intentionally absorb.
  // Keeping this allowlist explicit prevents typos from being silently ignored.
  metadata: z.unknown().optional(),
  store: z.boolean().optional(),
  previous_response_id: z.string().min(1).nullable().optional(),
  conversation: z.unknown().nullable().optional(),
  parallel_tool_calls: z.boolean().optional(),
  text: z.unknown().nullable().optional(),
})
