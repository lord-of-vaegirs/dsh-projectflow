export function nowIso(): string {
  return new Date().toISOString()
}

export function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/gu, '-')
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}
