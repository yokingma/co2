import { createConfigError } from './errors.js'

export type UpstreamProvider = 'openai' | 'anthropic'

function normalizeHeaderName(headerName: string): string {
  return headerName.trim().toLowerCase()
}

function isForbiddenHeader(provider: UpstreamProvider, headerName: string): boolean {
  const normalizedName = normalizeHeaderName(headerName)

  if (provider === 'openai') {
    return normalizedName === 'authorization'
  }

  return normalizedName === 'x-api-key'
}

export function validateProviderDefaultHeaders(
  provider: UpstreamProvider,
  defaultHeaders: Record<string, string>,
): Record<string, string> {
  const sanitizedHeaders: Record<string, string> = {}

  for (const [headerName, headerValue] of Object.entries(defaultHeaders)) {
    const normalizedName = normalizeHeaderName(headerName)

    if (!normalizedName) {
      continue
    }

    if (isForbiddenHeader(provider, normalizedName)) {
      throw createConfigError(
        `providers.${provider}.defaultHeaders.${normalizedName} cannot override SDK authentication headers`,
        `providers.${provider}.defaultHeaders.${normalizedName}`,
      )
    }

    sanitizedHeaders[normalizedName] = headerValue
  }

  return sanitizedHeaders
}
