import fastify from 'fastify'
import { createLogger } from '../shared/logger.js'
import type { Logger, RuntimeConfig } from '../shared/types.js'
import { createClaudeUpstreamClient, type ClaudeUpstreamClient } from '../upstream/claude-client.js'
import { createOpenAIUpstreamClient, type OpenAIUpstreamClient } from '../upstream/openai-client.js'
import { registerRoutes } from './register-routes.js'

export type ServerDependencies = {
  claudeClient?: ClaudeUpstreamClient
  openAIClient?: OpenAIUpstreamClient
  logger?: Logger
}

export function createServer(config: RuntimeConfig, dependencies: ServerDependencies = {}) {
  const logger = dependencies.logger ?? createLogger(config.server.logLevel)
  const server = fastify({
    logger: false,
  })

  const claudeClient = dependencies.claudeClient ?? createClaudeUpstreamClient(config, logger)
  const openAIClient = dependencies.openAIClient ?? createOpenAIUpstreamClient(config, logger)

  registerRoutes(server, config, logger, claudeClient, openAIClient)
  return server
}
