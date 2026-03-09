import OpenAI from 'openai'
import type { Logger, OpenAIResponsesRequest, OpenAIResponsesResponse, OpenAIResponsesStreamEvent, RuntimeConfig } from '../shared/types.js'

export type OpenAIUpstreamClient = {
  createResponse: (request: OpenAIResponsesRequest) => Promise<OpenAIResponsesResponse>
  streamResponse: (request: OpenAIResponsesRequest) => Promise<AsyncIterable<OpenAIResponsesStreamEvent>>
}

export function createOpenAIUpstreamClient(config: RuntimeConfig, logger: Logger): OpenAIUpstreamClient {
  const client = new OpenAI({
    apiKey: config.providers.openai.apiKey,
    baseURL: config.providers.openai.baseUrl,
    defaultHeaders: config.providers.openai.defaultHeaders,
  })

  return {
    async createResponse(request) {
      logger.debug('Calling OpenAI Responses upstream', { model: request.model })
      const response = await client.responses.create(request as unknown as OpenAI.Responses.ResponseCreateParams)
      return response as unknown as OpenAIResponsesResponse
    },
    async streamResponse(request) {
      logger.debug('Calling OpenAI Responses upstream stream', { model: request.model })
      const stream = await client.responses.create({
        ...(request as unknown as OpenAI.Responses.ResponseCreateParams),
        stream: true,
      } as OpenAI.Responses.ResponseCreateParams)
      return stream as unknown as AsyncIterable<OpenAIResponsesStreamEvent>
    },
  }
}
