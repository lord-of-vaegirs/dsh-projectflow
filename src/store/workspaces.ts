import { readJsonIfExists, writeJsonAtomic } from '../fs/json.js'
import type { MemberKind, WorkspaceMember, WorkspacesDocument } from '../shared/contracts.js'
import { nowIso } from '../util/time.js'
import { cleanInline } from '../util/text.js'

export function emptyWorkspaces(primaryPath: string): WorkspacesDocument {
  return {
    schemaVersion: 1,
    primary: { path: primaryPath, label: 'primary' },
    members: [],
  }
}

export async function readWorkspaces(
  path: string,
  fallbackPrimaryPath: string,
): Promise<WorkspacesDocument> {
  const value = await readJsonIfExists<WorkspacesDocument>(path)
  if (value === undefined) return emptyWorkspaces(fallbackPrimaryPath)
  if (value.schemaVersion !== 1 || typeof value.primary !== 'object' || value.primary === null) {
    return emptyWorkspaces(fallbackPrimaryPath)
  }
  return {
    schemaVersion: 1,
    primary: {
      path: typeof value.primary.path === 'string' ? value.primary.path : fallbackPrimaryPath,
      label: typeof value.primary.label === 'string' ? value.primary.label : 'primary',
    },
    members: Array.isArray(value.members) ? value.members.filter(isMember) : [],
  }
}

function isMember(value: unknown): value is WorkspaceMember {
  if (typeof value !== 'object' || value === null) return false
  const member = value as Partial<WorkspaceMember>
  return (
    typeof member.id === 'string' &&
    (member.kind === 'directory' || member.kind === 'session' || member.kind === 'project') &&
    typeof member.label === 'string'
  )
}

export function memberKey(member: Pick<WorkspaceMember, 'kind' | 'path' | 'sessionId' | 'projectId'>): string {
  return member.kind === 'directory'
    ? `directory:${member.path ?? ''}`
    : member.kind === 'session'
      ? `session:${member.sessionId ?? ''}`
      : `project:${member.projectId ?? ''}`
}

export function makeMember(input: {
  kind: MemberKind
  path?: string
  sessionId?: string
  projectId?: string
  label?: string
  note?: string
  addedBy: string
  id: string
}): WorkspaceMember {
  const base = {
    id: input.id,
    kind: input.kind,
    label: cleanInline(input.label ?? input.path ?? input.sessionId ?? input.projectId ?? 'member', 120),
    note: cleanInline(input.note ?? '', 1_000),
    addedAt: nowIso(),
    addedBy: input.addedBy,
  }
  if (input.kind === 'directory') return { ...base, path: input.path ?? '' }
  if (input.kind === 'session') return { ...base, sessionId: input.sessionId ?? '' }
  return { ...base, projectId: input.projectId ?? '' }
}

export async function insertMember(
  path: string,
  workspaces: WorkspacesDocument,
  member: WorkspaceMember,
): Promise<{ deduped: boolean; member: WorkspaceMember }> {
  const key = memberKey(member)
  const existing = workspaces.members.find((item) => memberKey(item) === key)
  if (existing !== undefined) {
    const merged: WorkspaceMember = {
      ...existing,
      label: member.label || existing.label,
      note: member.note || existing.note,
    }
    const next = {
      ...workspaces,
      members: workspaces.members.map((item) => (item.id === existing.id ? merged : item)),
    }
    await writeJsonAtomic(path, next)
    return { deduped: true, member: merged }
  }
  workspaces.members.push(member)
  await writeJsonAtomic(path, workspaces)
  return { deduped: false, member }
}

export async function removeMember(
  path: string,
  workspaces: WorkspacesDocument,
  memberId: string,
): Promise<boolean> {
  const next = workspaces.members.filter((member) => member.id !== memberId)
  if (next.length === workspaces.members.length) return false
  await writeJsonAtomic(path, { ...workspaces, members: next })
  return true
}
