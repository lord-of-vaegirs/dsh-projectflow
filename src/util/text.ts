import { ProjectError } from '../errors.js'

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
const STANDALONE_SECTION = /^\s*§\s*$/mu

export function normalizeLookup(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

export function cleanDisplay(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .replace(CONTROL, '')
    .trim()
}

export function cleanInline(value: string, max = 500): string {
  return cleanDisplay(value).replace(/\s+/gu, ' ').slice(0, max)
}

export function cleanBody(value: string, maxBytes: number, label: string): string {
  const text = cleanDisplay(value)
  if (text === '') throw new ProjectError('INVALID_ARGUMENT', `${label} must not be empty.`)
  if (STANDALONE_SECTION.test(text)) {
    throw new ProjectError(
      'INVALID_ARGUMENT',
      `${label} contains a standalone § line.`,
      'Keep § inside a line or split the text into separate entries.',
    )
  }
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > maxBytes) {
    throw new ProjectError(
      'ENTRY_TOO_LARGE',
      `${label} is ${bytes} bytes; the limit is ${maxBytes} bytes.`,
      'Split the entry or store the detail in a referenced file.',
    )
  }
  return text
}

export function truncateCodePoints(value: string, max: number): string {
  if (value.length <= max) return value
  let result = ''
  for (const character of value) {
    if (result.length + character.length > max) break
    result += character
  }
  return result
}

export function oneLine(value: string, max = 500): string {
  const text = cleanDisplay(value).replace(/\s+/gu, ' ')
  return truncateCodePoints(text, max)
}

export function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const value of values) {
    const id = key(value)
    if (seen.has(id)) continue
    seen.add(id)
    result.push(value)
  }
  return result
}
