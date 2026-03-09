import { z } from 'zod'

const portSchema = z.coerce.number().int().min(1).max(65535)

export const startCommandSchema = z.strictObject({
  mode: z.enum(['o2c', 'c2o']).optional(),
  port: portSchema.optional(),
  host: z.string().min(1).optional(),
  config: z.string().min(1).optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
})

export type StartCommandInput = z.infer<typeof startCommandSchema>
