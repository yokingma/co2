import Anthropic from '@anthropic-ai/sdk'
import type { ClaudeMessagesRequest, ClaudeMessagesResponse, ClaudeStreamEvent, Logger, RuntimeConfig } from '../shared/types.js'

export type ClaudeUpstreamClient = {
  createMessage: (request: ClaudeMessagesRequest) => Promise<ClaudeMessagesResponse>
  streamMessage: (request: ClaudeMessagesRequest) => Promise<AsyncIterable<ClaudeStreamEvent>>
}

export function createClaudeUpstreamClient(config: RuntimeConfig, logger: Logger): ClaudeUpstreamClient {
  const client = new Anthropic({
    apiKey: config.providers.anthropic.apiKey,
    baseURL: config.providers.anthropic.baseUrl,
    defaultHeaders: {
      'anthropic-version': config.providers.anthropic.version,
      ...config.providers.anthropic.defaultHeaders,
    },
  })

  return {
    async createMessage(request) {
      logger.debug('Calling Claude upstream', { model: request.model })
      const response = await client.messages.create(request as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming)
      return response as unknown as ClaudeMessagesResponse
    },
    async streamMessage(request) {
      logger.debug('Calling Claude upstream stream', { model: request.model })
      const stream = await client.messages.create({
        ...(request as unknown as Anthropic.Messages.MessageCreateParams),
        stream: true,
      } as Anthropic.Messages.MessageCreateParams)
      return stream as unknown as AsyncIterable<ClaudeStreamEvent>
    },
  }
}
