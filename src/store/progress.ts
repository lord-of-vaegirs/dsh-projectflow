import { readTextIfExists, writeFileAtomic } from '../fs/atomic.js'
import type { ProgressEntry } from '../shared/contracts.js'
import { cleanBody, cleanInline } from '../util/text.js'
import { nowIso } from '../util/time.js'

export interface ProgressRead {
  entries: ProgressEntry[]
  invalid: number
}

export function parseProgress(text: string): ProgressRead {
  const entries: ProgressEntry[] = []
  let invalid = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const value = JSON.parse(line) as Partial<ProgressEntry>
      if (
        typeof value.ts !== 'string' ||
        typeof value.sessionId !== 'string' ||
        typeof value.stage !== 'string' ||
        typeof value.did !== 'string' ||
        typeof value.next !== 'string'
      ) {
        invalid += 1
        continue
      }
      entries.push({
        ts: value.ts,
        sessionId: value.sessionId,
        stage: value.stage,
        did: value.did,
        next: value.next,
        ...(typeof value.blocked === 'string' && value.blocked !== ''
          ? { blocked: value.blocked }
          : {}),
        tags: Array.isArray(value.tags)
          ? value.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
      })
    } catch {
      invalid += 1
    }
  }
  return { entries, invalid }
}

export async function readProgress(path: string): Promise<ProgressEntry[]> {
  const text = (await readTextIfExists(path)) ?? ''
  return parseProgress(text).entries
}

export function normalizeProgress(input: {
  sessionId: string
  stage: string
  did: string
  next: string
  blocked?: string
  tags?: string[]
  lineBytes: number
}): ProgressEntry {
  const did = cleanBody(input.did, input.lineBytes, 'Progress did')
  const next = cleanBody(input.next, input.lineBytes, 'Progress next')
  const stage = cleanInline(input.stage, 80)
  if (stage === '') throw new Error('Progress stage must not be empty')
  return {
    ts: nowIso(),
    sessionId: input.sessionId,
    stage,
    did,
    next,
    ...(input.blocked === undefined || input.blocked.trim() === ''
      ? {}
      : { blocked: cleanInline(input.blocked, 1_000) }),
    tags: (input.tags ?? []).map((tag) => cleanInline(tag, 40)).filter((tag) => tag !== ''),
  }
}

export function isDuplicateProgress(entry: ProgressEntry, entries: ProgressEntry[]): boolean {
  const cutoff = Date.parse(entry.ts) - 10 * 60_000
  return entries.some((candidate) =>
    Date.parse(candidate.ts) >= cutoff &&
    candidate.sessionId === entry.sessionId &&
    candidate.stage === entry.stage &&
    candidate.did === entry.did &&
    candidate.next === entry.next &&
    (candidate.blocked ?? '') === (entry.blocked ?? '') &&
    candidate.tags.join('\u0000') === entry.tags.join('\u0000'),
  )
}

export async function writeProgress(path: string, entries: ProgressEntry[]): Promise<void> {
  const text = entries.map((entry) => JSON.stringify(entry)).join('\n')
  await writeFileAtomic(path, text === '' ? '' : `${text}\n`)
}

export async function appendProgress(path: string, entry: ProgressEntry): Promise<void> {
  const existing = (await readTextIfExists(path)) ?? ''
  const prefix = existing.trimEnd() === '' ? '' : `${existing.trimEnd()}\n`
  await writeFileAtomic(path, `${prefix}${JSON.stringify(entry)}\n`)
}

export function renderProgressArchivePointer(input: {
  count: number
  through: string
  file: string
}): ProgressEntry {
  return {
    ts: input.through,
    sessionId: 'system',
    stage: 'archive',
    did: `Archived ${input.count} progress entries through ${input.through}`,
    next: `See ${input.file}`,
    tags: ['archive'],
  }
}
