import { join } from 'node:path'
import { readJsonIfExists, writeJsonAtomic } from '../fs/json.js'
import { writeFileAtomic } from '../fs/atomic.js'
import { nowIso, timestampSlug } from '../util/time.js'
import type { ProjectLimits } from '../shared/contracts.js'

export interface ArchiveRecord {
  kind: string
  file: string
  count: number
  from: string
  to: string
  createdAt: string
}

export interface ArchiveIndex {
  schemaVersion: 1
  archives: ArchiveRecord[]
}

export function archiveIndexPath(projectDir: string): string {
  return join(projectDir, 'archive', 'index.json')
}

export async function readArchiveIndex(projectDir: string): Promise<ArchiveIndex> {
  const value = await readJsonIfExists<ArchiveIndex>(archiveIndexPath(projectDir))
  if (value === undefined || value.schemaVersion !== 1 || !Array.isArray(value.archives)) {
    return { schemaVersion: 1, archives: [] }
  }
  return value
}

export async function recordArchive(
  projectDir: string,
  record: Omit<ArchiveRecord, 'createdAt'>,
): Promise<void> {
  const index = await readArchiveIndex(projectDir)
  index.archives.push({ ...record, createdAt: nowIso() })
  await writeJsonAtomic(archiveIndexPath(projectDir), index)
}

export async function writeArchiveText(
  projectDir: string,
  kind: string,
  content: string,
  extension: 'md' | 'json' | 'jsonl',
): Promise<{ file: string; relative: string }> {
  const name = `${kind}-${timestampSlug()}.${extension}`
  const relative = `archive/${name}`
  await writeFileAtomic(join(projectDir, relative), content)
  return { file: join(projectDir, relative), relative }
}

export function archiveRetainBytes(limit: number, ratio: number): number {
  return Math.max(1, Math.floor(limit * ratio))
}

export function archiveRetainCount(limit: ProjectLimits['refsEntries'], ratio: number): number {
  return Math.max(1, Math.floor(limit * ratio))
}
