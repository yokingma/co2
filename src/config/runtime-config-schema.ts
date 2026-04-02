import { z } from 'zod'
import {
  DEFAULT_ANTHROPIC_BASE_URL,
  DEFAULT_ANTHROPIC_VERSION,
  DEFAULT_HOST,
  DEFAULT_LOG_LEVEL,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_PORT,
} from '../shared/contracts.js'

const modeSchema = z.enum(['openai-to-claude', 'claude-to-openai'])
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])
const portSchema = z.number().int().min(1).max(65535)
const defaultHeadersSchema = z.record(z.string().min(1), z.string())
const claudeOutputEffortSchema = z.enum(['low', 'medium', 'high', 'max'])
const inboundFieldSkipListSchema = z.array(z.string().min(1))
const skipInboundFieldsSchema = z.strictObject({
  claudeMessages: inboundFieldSkipListSchema.default([]),
  openAIResponses: inboundFieldSkipListSchema.default([]),
  openAIChatCompletions: inboundFieldSkipListSchema.default([]),
})
const emptyEnvStringToUndefined = (value: unknown): unknown => value === '' ? undefined : value
const optionalEnvStringSchema = z.preprocess(emptyEnvStringToUndefined, z.string().min(1).optional())
const optionalEnvUrlSchema = z.preprocess(emptyEnvStringToUndefined, z.string().url().optional())

export const envSchema = z.object({
  OPENAI_API_KEY: optionalEnvStringSchema,
  OPENAI_BASE_URL: optionalEnvUrlSchema,
  ANTHROPIC_API_KEY: optionalEnvStringSchema,
  ANTHROPIC_AUTH_TOKEN: optionalEnvStringSchema,
  ANTHROPIC_BASE_URL: optionalEnvUrlSchema,
  ANTHROPIC_VERSION: optionalEnvStringSchema,
  CO2_CONFIG: optionalEnvStringSchema,
})

export const configFileSchema = z.strictObject({
  server: z
    .strictObject({
      host: z.string().min(1).optional(),
      port: portSchema.optional(),
      mode: modeSchema.optional(),
      logLevel: logLevelSchema.optional(),
    })
    .optional(),
  providers: z
    .strictObject({
      openai: z
        .strictObject({
          apiKey: z.string().min(1).optional(),
          baseUrl: z.string().url().optional(),
          defaultHeaders: defaultHeadersSchema.optional(),
        })
        .optional(),
      anthropic: z
        .strictObject({
          apiKey: z.string().min(1).optional(),
          baseUrl: z.string().url().optional(),
          version: z.string().min(1).optional(),
          defaultHeaders: defaultHeadersSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  routing: z
    .strictObject({
      defaultOpenAIModel: z.string().min(1).optional(),
      defaultClaudeModel: z.string().min(1).optional(),
      claudeOutputEffort: claudeOutputEffortSchema.optional(),
      openAIReasoningEffort: z.string().min(1).optional(),
      openAIParallelToolCalls: z.boolean().optional(),
      skipInboundFields: skipInboundFieldsSchema.optional(),
    })
    .optional(),
  modelMap: z.record(z.string().min(1), z.string().min(1)).optional(),
})

export const runtimeConfigSchema = z.strictObject({
  server: z.strictObject({
    host: z.string().min(1).default(DEFAULT_HOST),
    port: portSchema.default(DEFAULT_PORT),
    mode: modeSchema,
    logLevel: logLevelSchema.default(DEFAULT_LOG_LEVEL),
  }),
  providers: z.strictObject({
    openai: z.strictObject({
      apiKey: z.string().min(1).optional(),
      baseUrl: z.string().url().default(DEFAULT_OPENAI_BASE_URL),
      defaultHeaders: defaultHeadersSchema.default({}),
    }),
    anthropic: z.strictObject({
      apiKey: z.string().min(1).optional(),
      baseUrl: z.string().url().default(DEFAULT_ANTHROPIC_BASE_URL),
      version: z.string().min(1).default(DEFAULT_ANTHROPIC_VERSION),
      defaultHeaders: defaultHeadersSchema.default({}),
    }),
  }),
  routing: z.strictObject({
    defaultOpenAIModel: z.string().min(1).optional(),
    defaultClaudeModel: z.string().min(1).optional(),
    claudeOutputEffort: claudeOutputEffortSchema.optional(),
    openAIReasoningEffort: z.string().min(1).optional(),
    openAIParallelToolCalls: z.boolean().optional(),
    skipInboundFields: skipInboundFieldsSchema.default({
      claudeMessages: [],
      openAIResponses: [],
      openAIChatCompletions: [],
    }),
  }),
  modelMap: z.record(z.string().min(1), z.string().min(1)),
})

export type ConfigFileInput = z.infer<typeof configFileSchema>
export type RuntimeConfigInput = z.infer<typeof runtimeConfigSchema>
