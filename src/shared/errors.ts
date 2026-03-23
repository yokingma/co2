import { ZodError } from 'zod'

export type ErrorCategory =
  | 'config_error'
  | 'validation_error'
  | 'auth_error'
  | 'mapping_error'
  | 'tool_mapping_error'
  | 'unsupported_tool_error'
  | 'upstream_request_error'
  | 'upstream_rate_limit'
  | 'upstream_overloaded'
  | 'upstream_internal_error'
  | 'stream_error'
  | 'not_implemented'
  | 'not_found'

export class GatewayError extends Error {
  public readonly category: ErrorCategory
  public readonly httpStatus: number
  public readonly code: string
  public readonly param?: string
  public readonly details?: Record<string, unknown>

  public constructor(
    message: string,
    category: ErrorCategory,
    httpStatus: number,
    code: string,
    param?: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'GatewayError'
    this.category = category
    this.httpStatus = httpStatus
    this.code = code
    this.param = param
    this.details = details
  }
}

export function isGatewayError(error: unknown): error is GatewayError {
  return error instanceof GatewayError
}

export function fromZodError(error: ZodError): GatewayError {
  const issue = error.issues[0]
  const param = issue?.path.join('.') || undefined
  return new GatewayError(issue?.message ?? 'Validation failed', 'validation_error', 400, 'validation_error', param)
}

export function toGatewayError(error: unknown): GatewayError {
  if (isGatewayError(error)) {
    return error
  }

  if (error instanceof ZodError) {
    return fromZodError(error)
  }

  if (error instanceof Error) {
    return new GatewayError(error.message, 'upstream_internal_error', 502, 'upstream_internal_error')
  }

  return new GatewayError('Unknown error', 'upstream_internal_error', 502, 'unknown_error')
}

export function createOpenAIErrorBody(error: GatewayError): Record<string, unknown> {
  return {
    error: {
      message: error.message,
      type: error.category === 'auth_error' ? 'authentication_error' : 'invalid_request_error',
      param: error.param ?? null,
      code: error.code,
    },
  }
}

export function createClaudeErrorBody(error: GatewayError, requestId: string): Record<string, unknown> {
  return {
    type: 'error',
    error: {
      type: error.category === 'auth_error' ? 'authentication_error' : 'invalid_request_error',
      message: error.message,
    },
    request_id: requestId,
  }
}

export function createNotFoundError(message: string): GatewayError {
  return new GatewayError(message, 'not_found', 404, 'route_not_found')
}

export function createNotImplementedError(message: string): GatewayError {
  return new GatewayError(message, 'not_implemented', 501, 'not_implemented')
}

export function createValidationError(message: string, param?: string): GatewayError {
  return new GatewayError(message, 'validation_error', 400, 'validation_error', param)
}

export function createUnsupportedParameterError(message: string, param: string): GatewayError {
  return new GatewayError(message, 'validation_error', 400, 'unsupported_parameter', param)
}

export function createConfigError(message: string, param?: string): GatewayError {
  return new GatewayError(message, 'config_error', 500, 'config_error', param)
}

export function createMappingError(message: string, param?: string): GatewayError {
  return new GatewayError(message, 'mapping_error', 400, 'mapping_error', param)
}

export function createUnsupportedToolError(message: string): GatewayError {
  return new GatewayError(message, 'unsupported_tool_error', 400, 'unsupported_tool_type', 'tools')
}

export function mapAnthropicStopReasonToOpenAI(reason: string | null | undefined, hasToolCalls: boolean): string {
  if (reason === 'max_tokens') {
    return 'length'
  }

  if (reason === 'tool_use' || hasToolCalls) {
    return 'tool_calls'
  }

  return 'stop'
}

export function mapOpenAIFinishReasonToClaude(reason: string | null | undefined, hasToolCalls: boolean): string {
  if (hasToolCalls) {
    return 'tool_use'
  }

  if (reason === 'length') {
    return 'max_tokens'
  }

  return 'end_turn'
}
