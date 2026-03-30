import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { normalizeOpenAIChatRequest, mapOpenAIChatToClaudeRequest } from '../adapters/openai-to-claude/map-chat-request.js'
import { mapClaudeResponseToOpenAIChatResponse, encodeClaudeStreamToOpenAIChat } from '../adapters/openai-to-claude/map-claude-response-to-chat.js'
import { normalizeOpenAIResponsesRequest, mapOpenAIResponsesToClaudeRequest } from '../adapters/openai-to-claude/map-responses-request.js'
import { mapClaudeResponseToOpenAIResponsesResponse, encodeClaudeStreamToOpenAIResponses } from '../adapters/openai-to-claude/map-claude-response-to-responses.js'
import { normalizeClaudeMessagesRequest, mapClaudeMessagesToOpenAIResponsesRequest } from '../adapters/claude-to-openai/map-messages-request.js'
import { mapOpenAIResponsesToClaudeResponse, encodeOpenAIResponsesStreamToClaude } from '../adapters/claude-to-openai/map-openai-response-to-messages.js'
import { createClaudeErrorBody, createOpenAIErrorBody, createNotFoundError, toGatewayError } from '../shared/errors.js'
import { formatSseEvent } from '../shared/sse.js'
import type { ClaudeMessagesRequest, Logger, OpenAIResponsesRequest, RuntimeConfig } from '../shared/types.js'
import type { ClaudeUpstreamClient } from '../upstream/claude-client.js'
import type { OpenAIUpstreamClient } from '../upstream/openai-client.js'

function getRequestId(request: FastifyRequest): string {
  const headerValue = request.headers['x-co2-request-id']
  return typeof headerValue === 'string' && headerValue.length > 0 ? headerValue : request.id
}

function setCommonHeaders(reply: FastifyReply, requestId: string): void {
  reply.header('x-co2-request-id', requestId)
}

function getBodyKeys(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return []
  }

  return Object.keys(body as Record<string, unknown>).sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function skipConfiguredInboundFields(
  logger: Logger,
  requestId: string,
  inboundContract: 'claudeMessages' | 'openAIResponses' | 'openAIChatCompletions',
  body: unknown,
  configuredFields: string[],
): unknown {
  if (!isRecord(body) || configuredFields.length === 0) {
    return body
  }

  const configuredFieldSet = new Set(configuredFields)
  const skippedFields = Object.keys(body)
    .filter((key) => configuredFieldSet.has(key))
    .sort()

  if (skippedFields.length === 0) {
    return body
  }

  logger.warn('Skipped configured inbound fields', {
    requestId,
    inboundContract,
    skippedFields,
  })

  const sanitizedBody: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (!configuredFieldSet.has(key)) {
      sanitizedBody[key] = value
    }
  }

  return sanitizedBody
}

function getHeaderSummary(request: FastifyRequest): Record<string, unknown> {
  return {
    contentType: request.headers['content-type'],
    anthropicVersion: request.headers['anthropic-version'],
    userAgent: request.headers['user-agent'],
    hasAuthorization: typeof request.headers.authorization === 'string' && request.headers.authorization.length > 0,
    hasXApiKey: typeof request.headers['x-api-key'] === 'string' && request.headers['x-api-key'].length > 0,
  }
}

function getZodIssueSummary(error: unknown): Array<Record<string, string>> | undefined {
  if (!(error instanceof ZodError)) {
    return undefined
  }

  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '<root>',
    message: issue.message,
  }))
}

function logRouteError(
  logger: Logger,
  message: string,
  request: FastifyRequest,
  requestId: string,
  error: unknown,
): void {
  const gatewayError = toGatewayError(error)
  logger.error(message, {
    requestId,
    method: request.method,
    url: request.url,
    errorCategory: gatewayError.category,
    errorCode: gatewayError.code,
    errorMessage: gatewayError.message,
    errorParam: gatewayError.param,
    httpStatus: gatewayError.httpStatus,
    bodyKeys: getBodyKeys(request.body),
    headerSummary: getHeaderSummary(request),
    zodIssues: getZodIssueSummary(error),
  })
}

function summarizeClaudeUpstreamRequest(request: ClaudeMessagesRequest): Record<string, unknown> {
  return {
    upstreamProvider: 'anthropic',
    upstreamPath: '/v1/messages',
    upstreamModel: request.model,
    transport: request.stream ? 'sse' : 'json',
    maxTokens: request.max_tokens,
    messageCount: request.messages.length,
    messageRoles: request.messages.map((message) => message.role),
    hasSystem: request.system !== undefined,
    toolCount: request.tools?.length ?? 0,
    toolNames: request.tools?.map((tool) => tool.name) ?? [],
    toolChoice: request.tool_choice?.type ?? null,
    hasThinking: request.thinking !== undefined,
    thinkingType: request.thinking?.type ?? null,
    thinkingBudgetTokens:
      request.thinking && request.thinking.type === 'enabled'
        ? request.thinking.budgetTokens
        : null,
    outputEffort: request.output_config?.effort ?? null,
    stopSequenceCount: request.stop_sequences?.length ?? 0,
  }
}

function summarizeOpenAIResponsesRequest(request: OpenAIResponsesRequest): Record<string, unknown> {
  const inputArray = typeof request.input === 'string' ? [] : request.input
  const messageItems = inputArray.filter((item) => 'role' in item)
  return {
    upstreamProvider: 'openai',
    upstreamPath: '/v1/responses',
    upstreamModel: request.model,
    transport: request.stream ? 'sse' : 'json',
    maxOutputTokens: request.max_output_tokens ?? null,
    inputType: typeof request.input === 'string' ? 'string' : 'array',
    inputItemCount: inputArray.length,
    inputItemTypes: inputArray.map((item) => ('type' in item ? item.type : 'message')),
    inputRoles: messageItems.map((item) => item.role),
    hasInstructions: request.instructions !== undefined,
    toolCount: request.tools?.length ?? 0,
    toolNames: request.tools?.map((tool) => tool.name) ?? [],
    toolChoice:
      typeof request.tool_choice === 'string'
        ? request.tool_choice
        : request.tool_choice?.type ?? null,
    hasReasoning: request.reasoning !== undefined,
    reasoningEffort: request.reasoning?.effort ?? null,
    reasoningSummary: request.reasoning?.summary ?? null,
  }
}

function logUpstreamRequestSummary(
  logger: Logger,
  message: string,
  requestId: string,
  summary: Record<string, unknown>,
): void {
  logger.info(message, {
    requestId,
    ...summary,
  })
}

function logUpstreamRequestBody(
  logger: Logger,
  message: string,
  requestId: string,
  upstreamProvider: 'openai' | 'anthropic',
  upstreamPath: string,
  body: Record<string, unknown>,
): void {
  logger.info(message, {
    requestId,
    upstreamProvider,
    upstreamPath,
    body,
  })
}

function logNormalizationWarnings(
  logger: Logger,
  requestId: string,
  inboundContract: 'claudeMessages' | 'openAIResponses' | 'openAIChatCompletions',
  warnings: Array<{ path: string; reason: string; action: 'ignored' }>,
): void {
  for (const warning of warnings) {
    logger.warn('Ignored inbound data during normalization', {
      requestId,
      inboundContract,
      ...warning,
    })
  }
}

function sendOpenAIError(reply: FastifyReply, requestId: string, error: unknown): FastifyReply {
  const gatewayError = toGatewayError(error)
  setCommonHeaders(reply, requestId)
  return reply.code(gatewayError.httpStatus).send(createOpenAIErrorBody(gatewayError))
}

function sendClaudeError(reply: FastifyReply, requestId: string, error: unknown): FastifyReply {
  const gatewayError = toGatewayError(error)
  setCommonHeaders(reply, requestId)
  return reply.code(gatewayError.httpStatus).send(createClaudeErrorBody(gatewayError, requestId))
}

function sendInBandStreamError(reply: FastifyReply, error: unknown): FastifyReply {
  if (reply.raw.writableEnded) {
    return reply
  }

  reply.raw.write(formatSseEvent('error', { type: 'error', message: toGatewayError(error).message }))
  reply.raw.end()
  return reply
}

async function streamReply(reply: FastifyReply, requestId: string, chunks: AsyncIterable<string>): Promise<void> {
  setCommonHeaders(reply, requestId)
  reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
  reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.flushHeaders()

  for await (const chunk of chunks) {
    reply.raw.write(chunk)
  }

  reply.raw.end()
}

export function registerRoutes(
  server: FastifyInstance,
  config: RuntimeConfig,
  logger: Logger,
  claudeClient: ClaudeUpstreamClient,
  openAIClient: OpenAIUpstreamClient,
): void {
  server.get('/healthz', async (request, reply) => {
    const requestId = getRequestId(request)
    setCommonHeaders(reply, requestId)
    return {
      status: 'ok',
      mode: config.server.mode,
      configured: config.server.mode === 'openai-to-claude' ? Boolean(config.providers.anthropic.apiKey) : Boolean(config.providers.openai.apiKey),
    }
  })

  if (config.server.mode === 'openai-to-claude') {
    server.post('/v1/chat/completions', async (request, reply) => {
      const requestId = getRequestId(request)
      try {
        const sanitizedBody = skipConfiguredInboundFields(
          logger,
          requestId,
          'openAIChatCompletions',
          request.body,
          config.routing.skipInboundFields.openAIChatCompletions,
        )
        const normalized = normalizeOpenAIChatRequest(sanitizedBody, config.server.mode, requestId)
        logNormalizationWarnings(logger, requestId, 'openAIChatCompletions', normalized.warnings)
        const upstreamRequest = mapOpenAIChatToClaudeRequest(config, normalized)
        logUpstreamRequestSummary(logger, 'Claude upstream request summary', requestId, summarizeClaudeUpstreamRequest(upstreamRequest))
        logUpstreamRequestBody(logger, 'Claude upstream request body', requestId, 'anthropic', '/v1/messages', upstreamRequest as Record<string, unknown>)
        if (normalized.transport === 'sse') {
          const upstreamStream = await claudeClient.streamMessage(upstreamRequest)
          await streamReply(
            reply,
            requestId,
            encodeClaudeStreamToOpenAIChat(
              upstreamStream,
              requestId,
              normalized.model,
              normalized.toolNameAliases,
              normalized.streamIncludeUsage ?? false,
            ),
          )
          return reply
        }
        const upstreamResponse = await claudeClient.createMessage(upstreamRequest)
        setCommonHeaders(reply, requestId)
        return reply.send(mapClaudeResponseToOpenAIChatResponse(upstreamResponse, normalized.model, normalized.toolNameAliases))
      } catch (error) {
        if (reply.raw.headersSent) {
          logRouteError(logger, 'Chat stream failed', request, requestId, error)
          return sendInBandStreamError(reply, error)
        }
        logRouteError(logger, 'Chat route failed', request, requestId, error)
        return sendOpenAIError(reply, requestId, error)
      }
    })

    server.post('/v1/responses', async (request, reply) => {
      const requestId = getRequestId(request)
      try {
        const sanitizedBody = skipConfiguredInboundFields(
          logger,
          requestId,
          'openAIResponses',
          request.body,
          config.routing.skipInboundFields.openAIResponses,
        )
        const normalized = normalizeOpenAIResponsesRequest(sanitizedBody, config.server.mode, requestId)
        logNormalizationWarnings(logger, requestId, 'openAIResponses', normalized.warnings)
        const upstreamRequest = mapOpenAIResponsesToClaudeRequest(config, normalized)
        logUpstreamRequestSummary(logger, 'Claude upstream request summary', requestId, summarizeClaudeUpstreamRequest(upstreamRequest))
        logUpstreamRequestBody(logger, 'Claude upstream request body', requestId, 'anthropic', '/v1/messages', upstreamRequest as Record<string, unknown>)
        if (normalized.transport === 'sse') {
          const upstreamStream = await claudeClient.streamMessage(upstreamRequest)
          await streamReply(reply, requestId, encodeClaudeStreamToOpenAIResponses(upstreamStream, requestId, normalized.model, normalized.toolNameAliases))
          return reply
        }
        const upstreamResponse = await claudeClient.createMessage(upstreamRequest)
        setCommonHeaders(reply, requestId)
        return reply.send(mapClaudeResponseToOpenAIResponsesResponse(upstreamResponse, normalized.model, normalized.toolNameAliases))
      } catch (error) {
        if (reply.raw.headersSent) {
          logRouteError(logger, 'Responses stream failed', request, requestId, error)
          return sendInBandStreamError(reply, error)
        }
        logRouteError(logger, 'Responses route failed', request, requestId, error)
        return sendOpenAIError(reply, requestId, error)
      }
    })
  }

  if (config.server.mode === 'claude-to-openai') {
    server.post('/v1/messages', async (request, reply) => {
      const requestId = getRequestId(request)
      try {
        const sanitizedBody = skipConfiguredInboundFields(
          logger,
          requestId,
          'claudeMessages',
          request.body,
          config.routing.skipInboundFields.claudeMessages,
        )
        const normalized = normalizeClaudeMessagesRequest(sanitizedBody, config.server.mode, requestId)
        logNormalizationWarnings(logger, requestId, 'claudeMessages', normalized.warnings)
        const upstreamRequest = mapClaudeMessagesToOpenAIResponsesRequest(config, normalized)
        logUpstreamRequestSummary(logger, 'OpenAI upstream request summary', requestId, summarizeOpenAIResponsesRequest(upstreamRequest))
        logUpstreamRequestBody(logger, 'OpenAI upstream request body', requestId, 'openai', '/v1/responses', upstreamRequest as Record<string, unknown>)
        if (normalized.transport === 'sse') {
          const upstreamStream = await openAIClient.streamResponse(upstreamRequest)
          await streamReply(reply, requestId, encodeOpenAIResponsesStreamToClaude(upstreamStream, requestId, normalized.model))
          return reply
        }
        const upstreamResponse = await openAIClient.createResponse(upstreamRequest)
        setCommonHeaders(reply, requestId)
        return reply.send(mapOpenAIResponsesToClaudeResponse(upstreamResponse, normalized.model))
      } catch (error) {
        if (reply.raw.headersSent) {
          logRouteError(logger, 'Messages stream failed', request, requestId, error)
          return sendInBandStreamError(reply, error)
        }
        logRouteError(logger, 'Messages route failed', request, requestId, error)
        return sendClaudeError(reply, requestId, error)
      }
    })
  }

  server.setNotFoundHandler(async (request, reply) => {
    const requestId = getRequestId(request)
    const error = createNotFoundError(`Route ${request.method} ${request.url} is not available in ${config.server.mode}`)
    if (config.server.mode === 'openai-to-claude') {
      return sendOpenAIError(reply, requestId, error)
    }

    return sendClaudeError(reply, requestId, error)
  })

  server.setErrorHandler(async (error, request, reply) => {
    const requestId = getRequestId(request)
    if (!reply.raw.headersSent && !reply.sent) {
      if (config.server.mode === 'openai-to-claude') {
        return sendOpenAIError(reply, requestId, error)
      }

      return sendClaudeError(reply, requestId, error)
    }

    return sendInBandStreamError(reply, error)
  })
}
