import { readJsonIfExists, writeJsonAtomic } from '../fs/json.js'
import type { SessionBinding, SessionBindings } from '../shared/contracts.js'
import { nowIso } from '../util/time.js'

export async function readSessions(path: string): Promise<SessionBindings> {
  const value = await readJsonIfExists<SessionBindings>(path)
  if (value === undefined || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const result: SessionBindings = {}
  for (const [sessionId, binding] of Object.entries(value)) {
    if (typeof binding !== 'object' || binding === null) continue
    const record = binding as Partial<SessionBinding>
    if (typeof record.boundAt !== 'string') continue
    result[sessionId] = {
      boundAt: record.boundAt,
      ...(typeof record.parentSessionId === 'string' ? { parentSessionId: record.parentSessionId } : {}),
      ...(typeof record.workspacePath === 'string' ? { workspacePath: record.workspacePath } : {}),
      ...(typeof record.note === 'string' ? { note: record.note } : {}),
    }
  }
  return result
}

export async function writeSessions(path: string, sessions: SessionBindings): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(sessions).sort(([left], [right]) => left.localeCompare(right)),
  )
  await writeJsonAtomic(path, sorted)
}

export function bindingFor(sessions: SessionBindings, sessionId: string): SessionBinding | undefined {
  return sessions[sessionId]
}

export function setBinding(
  sessions: SessionBindings,
  sessionId: string,
  binding: SessionBinding,
): SessionBindings {
  return { ...sessions, [sessionId]: binding }
}

export function removeBinding(sessions: SessionBindings, sessionId: string): SessionBindings {
  if (sessions[sessionId] === undefined) return sessions
  const next = { ...sessions }
  delete next[sessionId]
  return next
}

export function makeBinding(input: {
  parentSessionId?: string
  workspacePath?: string
  note?: string
}): SessionBinding {
  return {
    boundAt: nowIso(),
    ...(input.parentSessionId === undefined ? {} : { parentSessionId: input.parentSessionId }),
    ...(input.workspacePath === undefined ? {} : { workspacePath: input.workspacePath }),
    ...(input.note === undefined || input.note === '' ? {} : { note: input.note }),
  }
}
