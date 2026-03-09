import type { LogLevel } from './contracts.js'
import type { Logger } from './types.js'

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function shouldLog(currentLevel: LogLevel, targetLevel: LogLevel): boolean {
  return LOG_LEVEL_ORDER[targetLevel] >= LOG_LEVEL_ORDER[currentLevel]
}

function writeLog(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const payload = {
    level,
    message,
    ...(data ?? {}),
  }
  console.log(JSON.stringify(payload))
}

export function createLogger(level: LogLevel): Logger {
  return {
    debug(message, data) {
      if (shouldLog(level, 'debug')) {
        writeLog('debug', message, data)
      }
    },
    info(message, data) {
      if (shouldLog(level, 'info')) {
        writeLog('info', message, data)
      }
    },
    warn(message, data) {
      if (shouldLog(level, 'warn')) {
        writeLog('warn', message, data)
      }
    },
    error(message, data) {
      if (shouldLog(level, 'error')) {
        writeLog('error', message, data)
      }
    },
  }
}
