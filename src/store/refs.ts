import { readJson, writeJsonAtomic } from '../fs/json.js'
import { ProjectError } from '../errors.js'
import type { DirectoryRef, ToolRef } from '../shared/contracts.js'
import { nowIso } from '../util/time.js'
import { cleanInline } from '../util/text.js'

function arrayOf(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new ProjectError('CORRUPT_DATA', `${label} must be a JSON array.`)
  return value
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export async function readDirs(path: string): Promise<DirectoryRef[]> {
  let value: unknown
  try {
    value = await readJson<unknown>(path)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Missing project data file')) return []
    throw error
  }
  return arrayOf(value, path).flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const record = item as Record<string, unknown>
    const refPath = asString(record.path)
    if (refPath === '') return []
    const kind = record.kind === 'file' ? 'file' : 'dir'
    return [{
      kind,
      path: refPath,
      purpose: asString(record.purpose),
      note: asString(record.note),
      addedAt: asString(record.addedAt, nowIso()),
      addedBy: asString(record.addedBy, 'unknown'),
    } as DirectoryRef]
  })
}

export async function readTools(path: string): Promise<ToolRef[]> {
  let value: unknown
  try {
    value = await readJson<unknown>(path)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Missing project data file')) return []
    throw error
  }
  return arrayOf(value, path).flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const record = item as Record<string, unknown>
    const tool = asString(record.tool)
    if (tool === '') return []
    const kind = record.kind === 'plugin' || record.kind === 'mcp' ? record.kind : 'tool'
    return [{
      kind,
      tool,
      args: Array.isArray(record.args) ? record.args.filter((arg): arg is string => typeof arg === 'string') : [],
      purpose: asString(record.purpose),
      note: asString(record.note),
      addedAt: asString(record.addedAt, nowIso()),
      addedBy: asString(record.addedBy, 'unknown'),
    } as ToolRef]
  })
}

export function normalizeDirRef(input: {
  kind: 'dir' | 'file'
  path: string
  purpose: string
  note?: string
  addedBy: string
}): DirectoryRef {
  return {
    kind: input.kind,
    path: input.path.trim(),
    purpose: cleanInline(input.purpose, 500),
    note: cleanInline(input.note ?? '', 1_000),
    addedAt: nowIso(),
    addedBy: input.addedBy,
  }
}

export function normalizeToolRef(input: {
  kind: 'tool' | 'plugin' | 'mcp'
  tool: string
  args?: string[]
  purpose: string
  note?: string
  addedBy: string
}): ToolRef {
  return {
    kind: input.kind,
    tool: input.tool.trim(),
    args: (input.args ?? []).map((arg) => cleanInline(arg, 500)).filter((arg) => arg !== ''),
    purpose: cleanInline(input.purpose, 500),
    note: cleanInline(input.note ?? '', 1_000),
    addedAt: nowIso(),
    addedBy: input.addedBy,
  }
}

export function dirKey(ref: DirectoryRef): string {
  return `${ref.kind}:${ref.path}`
}

export function toolKey(ref: ToolRef): string {
  return `${ref.kind}:${ref.tool}:${JSON.stringify(ref.args)}`
}

export async function upsertDir(
  path: string,
  ref: DirectoryRef,
  limit: number,
  archive: (refs: DirectoryRef[]) => Promise<void>,
): Promise<{ deduped: boolean; archived: number }> {
  const refs = await readDirs(path)
  const index = refs.findIndex((item) => dirKey(item) === dirKey(ref))
  if (index >= 0) {
    const current = refs[index]
    if (current !== undefined) refs[index] = { ...ref, addedAt: current.addedAt }
    await writeJsonAtomic(path, refs)
    return { deduped: true, archived: 0 }
  }
  refs.push(ref)
  if (refs.length > limit) {
    const remove = refs.length - Math.max(1, Math.floor(limit * 0.8))
    const archivedRefs = refs.splice(0, remove)
    await archive(archivedRefs)
    await writeJsonAtomic(path, refs)
    return { deduped: false, archived: archivedRefs.length }
  }
  await writeJsonAtomic(path, refs)
  return { deduped: false, archived: 0 }
}

export async function upsertTool(
  path: string,
  ref: ToolRef,
  limit: number,
  archive: (refs: ToolRef[]) => Promise<void>,
): Promise<{ deduped: boolean; archived: number }> {
  const refs = await readTools(path)
  const index = refs.findIndex((item) => toolKey(item) === toolKey(ref))
  if (index >= 0) {
    const current = refs[index]
    if (current !== undefined) refs[index] = { ...ref, addedAt: current.addedAt }
    await writeJsonAtomic(path, refs)
    return { deduped: true, archived: 0 }
  }
  refs.push(ref)
  if (refs.length > limit) {
    const remove = refs.length - Math.max(1, Math.floor(limit * 0.8))
    const archivedRefs = refs.splice(0, remove)
    await archive(archivedRefs)
    await writeJsonAtomic(path, refs)
    return { deduped: false, archived: archivedRefs.length }
  }
  await writeJsonAtomic(path, refs)
  return { deduped: false, archived: 0 }
}
