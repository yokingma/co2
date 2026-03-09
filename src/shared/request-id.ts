import { randomUUID } from 'node:crypto'

export function createLocalRequestId(): string {
  return `req_${randomUUID()}`
}
