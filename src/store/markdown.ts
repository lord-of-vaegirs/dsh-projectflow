import { ProjectError } from '../errors.js'
import { oneLine } from '../util/text.js'

export type MarkdownKind = 'memory' | 'convention' | 'decision'

export interface MarkdownMeta {
  id: string
  createdAt: string
  updatedAt: string
  source?: string
  archived?: string
}

export interface MarkdownEntry {
  meta: MarkdownMeta | null
  body: string
  raw: string
}

const META_LINE = /^<!--\s*pf-(entry|decision)\s+(.+?)\s*-->$/u
const ATTRIBUTE = /([a-zA-Z][a-zA-Z0-9_-]*)=([^\s]+)/gu

function parseAttributes(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of text.matchAll(ATTRIBUTE)) {
    const key = match[1]
    const value = match[2]
    if (key !== undefined && value !== undefined) result[key] = value
  }
  return result
}

function metaFrom(attributes: Record<string, string>): MarkdownMeta | null {
  const id = attributes.id
  const createdAt = attributes.created
  const updatedAt = attributes.updated
  if (id === undefined || createdAt === undefined) return null
  return {
    id,
    createdAt,
    updatedAt: updatedAt ?? createdAt,
    ...(attributes.source === undefined ? {} : { source: attributes.source }),
    ...(attributes.archived === undefined ? {} : { archived: attributes.archived }),
  }
}

/** Split a file into §-separated blocks while preserving unknown/manual blocks. */
export function splitEntries(text: string): string[] {
  const normalized = text.replace(/\r\n?/gu, '\n')
  const blocks: string[] = []
  let current: string[] = []
  for (const line of normalized.split('\n')) {
    if (line.trim() === '§') {
      const block = current.join('\n').trim()
      if (block !== '') blocks.push(block)
      current = []
      continue
    }
    current.push(line)
  }
  const tail = current.join('\n').trim()
  if (tail !== '') blocks.push(tail)
  return blocks
}

export function parseMarkdown(text: string): MarkdownEntry[] {
  return splitEntries(text).map((raw) => {
    const lines = raw.split('\n')
    const first = lines[0]?.trim() ?? ''
    const match = META_LINE.exec(first)
    if (match === null) return { meta: null, body: raw, raw }
    const meta = metaFrom(parseAttributes(match[2] ?? ''))
    const body = lines.slice(1).join('\n').trim()
    return { meta, body, raw }
  })
}

export function renderEntry(meta: MarkdownMeta, body: string): string {
  const attributes = [
    `id=${meta.id}`,
    `created=${meta.createdAt}`,
    `updated=${meta.updatedAt}`,
    ...(meta.source === undefined ? [] : [`source=${meta.source}`]),
    ...(meta.archived === undefined ? [] : [`archived=${meta.archived}`]),
  ]
  return `<!-- pf-entry ${attributes.join(' ')} -->\n${body.trim()}\n\n§\n`
}

export function renderDecision(meta: MarkdownMeta, body: string): string {
  const attributes = [
    `id=${meta.id}`,
    `created=${meta.createdAt}`,
    `updated=${meta.updatedAt}`,
    ...(meta.source === undefined ? [] : [`source=${meta.source}`]),
    ...(meta.archived === undefined ? [] : [`archived=${meta.archived}`]),
  ]
  return `<!-- pf-decision ${attributes.join(' ')} -->\n${body.trim()}\n\n§\n`
}

export function renderEntries(entries: MarkdownEntry[], kind: MarkdownKind): string {
  const parts = entries.map((entry) => {
    if (entry.meta === null) return `${entry.raw.trim()}\n\n§\n`
    return kind === 'decision'
      ? renderDecision(entry.meta, entry.body)
      : renderEntry(entry.meta, entry.body)
  })
  return parts.join('')
}

export interface DecisionBody {
  date: string
  status: 'proposed' | 'accepted' | 'superseded' | 'deprecated'
  title: string
  context: string
  decision: string
  consequences: string
}

export function parseDecisionBody(body: string, fallbackDate: string): DecisionBody {
  const lines = body.split('\n')
  const heading = lines.find((line) => /^##\s+/u.test(line))
  const title = heading?.replace(/^##\s+/u, '').trim() ?? ''
  const field = (name: string): string => {
    const expression = new RegExp(`^-\\s*${name}:\\s*(.*)$`, 'iu')
    for (const line of lines) {
      const match = expression.exec(line.trim())
      if (match !== null) return match[1]?.trim() ?? ''
    }
    return ''
  }
  const rawStatus = field('Status').toLocaleLowerCase('en-US')
  const status = (
    ['proposed', 'accepted', 'superseded', 'deprecated'].includes(rawStatus)
      ? rawStatus
      : 'accepted'
  ) as DecisionBody['status']
  const date = field('Date') || fallbackDate.slice(0, 10)
  return {
    date,
    status,
    title: title || oneLine(field('Decision'), 120),
    context: field('Context'),
    decision: field('Decision'),
    consequences: field('Consequences'),
  }
}

export function renderDecisionBody(input: {
  id: string
  date: string
  status: DecisionBody['status']
  title?: string
  context: string
  decision: string
  consequences: string
}): string {
  const title = input.title === undefined || input.title.trim() === ''
    ? oneLine(input.decision, 100)
    : oneLine(input.title, 100)
  return [
    `## ${input.id}: ${title}`,
    '',
    `- Date: ${input.date}`,
    `- Status: ${input.status}`,
    `- Context: ${input.context || '(not recorded)'}`,
    `- Decision: ${input.decision}`,
    `- Consequences: ${input.consequences || '(not recorded)'}`,
  ].join('\n')
}

export function assertDecisionBody(body: DecisionBody): void {
  if (body.decision.trim() === '') {
    throw new ProjectError('INVALID_ARGUMENT', 'A decision requires a decision statement.')
  }
}
