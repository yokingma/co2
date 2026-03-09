export function formatSseEvent(type: string, data: unknown): string {
  return `event: ${type}
data: ${JSON.stringify(data)}

`
}

export function formatDataOnlySse(data: unknown): string {
  return `data: ${JSON.stringify(data)}

`
}
