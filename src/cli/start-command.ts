import type { Command } from 'commander'
import { loadRuntimeConfig } from '../config/load-runtime-config.js'
import { createLogger } from '../shared/logger.js'
import { createServer } from '../server/create-server.js'
import { toGatewayError } from '../shared/errors.js'

async function handleShutdown(server: ReturnType<typeof createServer>, logger: ReturnType<typeof createLogger>, signal: string): Promise<void> {
  logger.info('Shutting down server', { signal })
  await server.close()
}

export function registerStartCommand(program: Command): void {
  program
    .command('start')
    .option('--mode <mode>')
    .option('--port <port>')
    .option('--host <host>')
    .option('--config <path>')
    .option('--log-level <logLevel>')
    .action(async (options: Record<string, unknown>) => {
      try {
        const runtimeConfig = await loadRuntimeConfig({
          mode: options.mode,
          port: options.port,
          host: options.host,
          config: options.config,
          logLevel: options.logLevel,
        })
        const logger = createLogger(runtimeConfig.server.logLevel)
        const server = createServer(runtimeConfig, { logger })
        const address = await server.listen({
          host: runtimeConfig.server.host,
          port: runtimeConfig.server.port,
        })
        logger.info('CO2 server started', {
          address,
          mode: runtimeConfig.server.mode,
        })

        const shutdown = async (signal: string) => {
          await handleShutdown(server, logger, signal)
          process.exit(0)
        }

        process.once('SIGINT', () => {
          void shutdown('SIGINT')
        })
        process.once('SIGTERM', () => {
          void shutdown('SIGTERM')
        })
      } catch (error) {
        const gatewayError = toGatewayError(error)
        console.error(gatewayError.message)
        process.exit(1)
      }
    })
}
