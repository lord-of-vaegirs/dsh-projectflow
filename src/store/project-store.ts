import { readdir, rename, rm, mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { ProjectFlowConfig } from '../config.js'
import { ProjectError } from '../errors.js'
import { ensureDir, readTextIfExists, writeFileAtomic } from '../fs/atomic.js'
import { readJson, readJsonIfExists, writeJsonAtomic } from '../fs/json.js'
import { withFileLock } from '../fs/lock.js'
import type {
  DirectoryRef,
  ProgressEntry,
  ProjectDocument,
  ProjectLimits,
  ProjectSummary,
  SessionBinding,
  SessionBindings,
  TaskRecord,
  ToolRef,
  WorkspaceMember,
  WorkspacesDocument,
} from '../shared/contracts.js'
import { newEntryId, newMemberId, newProjectId, isProjectId } from '../util/ids.js'
import { nowIso, timestampSlug } from '../util/time.js'
import { cleanBody, cleanDisplay, cleanInline, normalizeLookup, uniqueBy } from '../util/text.js'
import {
  parseMarkdown,
  parseDecisionBody,
  renderDecisionBody,
  renderEntry,
  renderEntries,
  type MarkdownEntry,
} from './markdown.js'
import { readDirs, readTools, upsertDir, upsertTool } from './refs.js'
import {
  appendProgress,
  isDuplicateProgress,
  normalizeProgress,
  parseProgress,
  readProgress,
  renderProgressArchivePointer,
  writeProgress,
} from './progress.js'
import {
  emptyWorkspaces,
  insertMember,
  makeMember,
  readWorkspaces,
  removeMember,
} from './workspaces.js'
import {
  bindingFor,
  makeBinding,
  readSessions,
  removeBinding,
  setBinding,
  writeSessions,
} from './sessions.js'
import { readTasks, trimTasks, writeTasks } from './tasks.js'
import { recordArchive, writeArchiveText } from './archive.js'

export interface ProjectSnapshot {
  project: ProjectDocument
  memoryText: string
  conventionsText: string
  decisionsText: string
  dirs: DirectoryRef[]
  tools: ToolRef[]
  progress: ProgressEntry[]
  sessions: SessionBindings
  tasks: TaskRecord[]
  workspaces: WorkspacesDocument
}

export interface NoteWriteResult {
  entryId: string
  deduped: boolean
  archived: number
}

export interface RefWriteResult {
  deduped: boolean
  archived: number
  entry: DirectoryRef | ToolRef
}

export interface ProjectListResult {
  projects: ProjectSummary[]
  invalid: Array<{ id: string; error: string }>
}

const PROJECT_FILE = 'project.json'
const MEMORY_FILE = 'MEMORY.md'
const CONVENTIONS_FILE = 'CONVENTIONS.md'
const DECISIONS_FILE = 'DECISIONS.md'
const PROGRESS_FILE = 'progress.jsonl'
const SESSIONS_FILE = 'sessions.json'
const TASKS_FILE = 'tasks.json'
const WORKSPACES_FILE = 'workspaces.json'

function projectPath(projectsDir: string, id: string): string {
  if (!isProjectId(id)) {
    throw new ProjectError('INVALID_ARGUMENT', `Invalid project id: ${id}`)
  }
  const path = resolve(projectsDir, id)
  if (path !== join(resolve(projectsDir), id) || !path.startsWith(`${resolve(projectsDir)}${sep}`)) {
    throw new ProjectError('INVALID_ARGUMENT', 'Project path escaped the data root.')
  }
  return path
}

function validateName(value: string): string {
  const name = cleanInline(value, 120)
  if (name === '') throw new ProjectError('INVALID_ARGUMENT', 'Project name must not be empty.')
  return name
}

function validateAliases(values: string[] | undefined): string[] {
  return uniqueBy(
    (values ?? []).map((value) => cleanInline(value, 80)).filter((value) => value !== ''),
    normalizeLookup,
  )
}

function validatePrimaryPath(value: string): string {
  const path = value.trim()
  if (path === '') throw new ProjectError('INVALID_ARGUMENT', 'primaryPath must not be empty.')
  if (!isAbsolute(path)) {
    throw new ProjectError('INVALID_ARGUMENT', 'primaryPath must be an absolute directory path.')
  }
  return resolve(path)
}

function validateProjectDocument(value: unknown, path: string): ProjectDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectError('CORRUPT_DATA', `project.json is not an object: ${path}`)
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1) {
    throw new ProjectError(
      'CORRUPT_DATA',
      `Unsupported project schemaVersion in ${path}.`,
      'This build only reads schemaVersion 1.',
    )
  }
  if (typeof record.id !== 'string' || !isProjectId(record.id)) {
    throw new ProjectError('CORRUPT_DATA', `project.json has an invalid id: ${path}`)
  }
  if (typeof record.name !== 'string' || record.name.trim() === '') {
    throw new ProjectError('CORRUPT_DATA', `project.json has an invalid name: ${path}`)
  }
  if (typeof record.primaryPath !== 'string' || !isAbsolute(record.primaryPath)) {
    throw new ProjectError('CORRUPT_DATA', `project.json has an invalid primaryPath: ${path}`)
  }
  return {
    schemaVersion: 1,
    id: record.id,
    name: record.name,
    aliases: Array.isArray(record.aliases)
      ? record.aliases.filter((alias): alias is string => typeof alias === 'string')
      : [],
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : nowIso(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : nowIso(),
    archived: record.archived === true,
    primaryPath: record.primaryPath,
    ...(typeof record.forkedFrom === 'string' ? { forkedFrom: record.forkedFrom } : {}),
    ...(Array.isArray(record.mergedFrom)
      ? { mergedFrom: record.mergedFrom.filter((item): item is string => typeof item === 'string') }
      : {}),
    ...(Array.isArray(record.tags)
      ? { tags: record.tags.filter((item): item is string => typeof item === 'string') }
      : {}),
  }
}

function activeEntries(entries: MarkdownEntry[]): MarkdownEntry[] {
  return entries.filter((entry) => entry.meta?.archived === undefined)
}

export interface StatusEntry extends MarkdownEntry {
  meta: NonNullable<MarkdownEntry['meta']>
  content: string
}

/** Active, metadata-backed entries for status and context assembly. */
export function activeEntriesForStatus(text: string): StatusEntry[] {
  return activeEntries(parseMarkdown(text))
    .filter((entry): entry is MarkdownEntry & { meta: NonNullable<MarkdownEntry['meta']> } => entry.meta !== null)
    .map((entry) => ({ ...entry, content: entry.body }))
}

function contentKey(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US')
}

function nextDecisionId(entries: MarkdownEntry[]): string {
  let maximum = 0
  for (const entry of entries) {
    const match = /^ADR-(\d+)$/u.exec(entry.meta?.id ?? '')
    if (match !== null) maximum = Math.max(maximum, Number(match[1]))
  }
  return `ADR-${String(maximum + 1).padStart(4, '0')}`
}

export class ProjectStore {
  readonly config: ProjectFlowConfig
  readonly projectsDir: string
  private readonly limits: ProjectLimits

  constructor(config: ProjectFlowConfig) {
    this.config = config
    this.projectsDir = config.projectsDir
    this.limits = config.limits
  }

  projectDir(id: string): string {
    return projectPath(this.projectsDir, id)
  }

  private file(id: string, name: string): string {
    return join(this.projectDir(id), name)
  }

  private async registryLock<T>(operation: () => Promise<T>): Promise<T> {
    await ensureDir(this.projectsDir)
    return withFileLock(
      join(this.projectsDir, '.registry.lock'),
      operation,
      { waitMs: this.config.lockWaitMs },
    )
  }

  private async projectLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    return withFileLock(
      join(this.projectDir(id), '.lock'),
      operation,
      { waitMs: this.config.lockWaitMs },
    )
  }

  private async twoProjectLocks<T>(
    leftId: string,
    rightId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const [first, second] = [leftId, rightId].sort()
    if (first === undefined || second === undefined) throw new Error('twoProjectLocks requires two ids')
    if (first === second) return this.projectLock(first, operation)
    return this.projectLock(first, () => this.projectLock(second, operation))
  }

  async listProjects(includeArchived = false): Promise<ProjectListResult> {
    await ensureDir(this.projectsDir)
    const entries = await readdir(this.projectsDir, { withFileTypes: true })
    const projects: ProjectSummary[] = []
    const invalid: Array<{ id: string; error: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      if (!isProjectId(entry.name)) continue
      try {
        const project = await this.readProject(entry.name)
        if (!includeArchived && project.archived) continue
        projects.push(await this.summarize(project))
      } catch (error) {
        invalid.push({ id: entry.name, error: (error as Error).message })
      }
    }
    projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return { projects, invalid }
  }

  async readProject(id: string): Promise<ProjectDocument> {
    const path = join(this.projectDir(id), PROJECT_FILE)
    const value = await readJson<unknown>(path)
    return validateProjectDocument(value, path)
  }

  async getProject(reference: string): Promise<ProjectDocument> {
    const text = reference.trim()
    if (text === '') {
      throw new ProjectError('INVALID_ARGUMENT', 'Project reference must not be empty.')
    }
    if (isProjectId(text)) {
      if (await readJsonIfExists<unknown>(join(this.projectDir(text), PROJECT_FILE)) === undefined) {
        throw new ProjectError('PROJECT_NOT_FOUND', `No project with id ${text}.`)
      }
      return this.readProject(text)
    }
    const lookup = normalizeLookup(text)
    const { projects } = await this.listProjects(true)
    const matches = projects.filter((project) =>
      normalizeLookup(project.name) === lookup ||
      project.aliases.some((alias) => normalizeLookup(alias) === lookup),
    )
    if (matches.length === 0) {
      throw new ProjectError(
        'PROJECT_NOT_FOUND',
        `No project matches "${text}".`,
        'Run project_list or /project list; names and aliases are matched case-insensitively.',
      )
    }
    if (matches.length > 1) {
      throw new ProjectError(
        'PROJECT_AMBIGUOUS',
        `"${text}" matches ${matches.length} projects.`,
        `Use a project id: ${matches.map((project) => project.id).join(', ')}.`,
      )
    }
    return this.readProject(matches[0]!.id)
  }

  async createProject(input: {
    name: string
    aliases?: string[]
    primaryPath: string
  }): Promise<{ project: ProjectDocument; created: boolean }> {
    const name = validateName(input.name)
    const aliases = validateAliases(input.aliases)
    const primaryPath = validatePrimaryPath(input.primaryPath)
    return this.registryLock(async () => {
      const current = await this.listProjects(true)
      const all = await Promise.all(current.projects.map((item) => this.readProject(item.id)))
      const lookup = normalizeLookup(name)
      const existing = all.find((project) => normalizeLookup(project.name) === lookup)
      if (existing !== undefined) {
        const compatible = aliases.every((alias) =>
          [existing.name, ...existing.aliases].some((value) => normalizeLookup(value) === normalizeLookup(alias)),
        )
        if (!compatible || existing.primaryPath !== primaryPath) {
          throw new ProjectError(
            'PROJECT_EXISTS',
            `Project "${existing.name}" already exists (${existing.id}) with different aliases or primaryPath.`,
            'Use a different name, or omit create and use the existing project.',
          )
        }
        return { project: existing, created: false }
      }
      for (const project of all) {
        for (const alias of aliases) {
          if (
            normalizeLookup(project.name) === normalizeLookup(alias) ||
            project.aliases.some((value) => normalizeLookup(value) === normalizeLookup(alias))
          ) {
            throw new ProjectError(
              'PROJECT_EXISTS',
              `Alias "${alias}" is already used by ${project.name} (${project.id}).`,
            )
          }
        }
      }
      const id = newProjectId()
      const time = nowIso()
      const document: ProjectDocument = {
        schemaVersion: 1,
        id,
        name,
        aliases,
        createdAt: time,
        updatedAt: time,
        archived: false,
        primaryPath,
      }
      const temp = join(this.projectsDir, `.tmp-${id}-${Date.now().toString(36)}`)
      const final = this.projectDir(id)
      await ensureDir(temp)
      try {
        await writeJsonAtomic(join(temp, PROJECT_FILE), document)
        await writeFileAtomic(join(temp, MEMORY_FILE), this.initialMarkdown('Project memory'))
        await writeFileAtomic(join(temp, CONVENTIONS_FILE), this.initialMarkdown('Project conventions'))
        await writeFileAtomic(join(temp, DECISIONS_FILE), this.initialMarkdown('Project decisions'))
        await ensureDir(join(temp, 'refs'))
        await writeJsonAtomic(join(temp, 'refs', 'dirs.json'), [])
        await writeJsonAtomic(join(temp, 'refs', 'tools.json'), [])
        await writeFileAtomic(join(temp, PROGRESS_FILE), '')
        await writeJsonAtomic(join(temp, SESSIONS_FILE), {})
        await writeJsonAtomic(join(temp, TASKS_FILE), { schemaVersion: 1, tasks: {} })
        await writeJsonAtomic(join(temp, WORKSPACES_FILE), emptyWorkspaces(primaryPath))
        await ensureDir(join(temp, 'archive'))
        await rename(temp, final)
      } catch (error) {
        await rm(temp, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      return { project: document, created: true }
    })
  }

  private initialMarkdown(title: string): string {
    return `# ${title}\n\nEntries are separated by a standalone § line. This file is intentionally human-readable.\n`
  }

  async summarize(project: ProjectDocument): Promise<ProjectSummary> {
    const snapshot = await this.readSnapshot(project.id).catch(() => undefined)
    return {
      id: project.id,
      name: project.name,
      aliases: project.aliases,
      primaryPath: project.primaryPath,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      archived: project.archived,
      ...(project.forkedFrom === undefined ? {} : { forkedFrom: project.forkedFrom }),
      ...(project.mergedFrom === undefined ? {} : { mergedFrom: project.mergedFrom }),
      counts: {
        memory: snapshot === undefined ? 0 : activeEntriesForStatus(snapshot.memoryText).length,
        conventions: snapshot === undefined ? 0 : activeEntriesForStatus(snapshot.conventionsText).length,
        decisions: snapshot === undefined ? 0 : activeEntriesForStatus(snapshot.decisionsText).length,
        dirs: snapshot?.dirs.length ?? 0,
        tools: snapshot?.tools.length ?? 0,
        progress: snapshot?.progress.length ?? 0,
        sessions: snapshot === undefined ? 0 : Object.keys(snapshot.sessions).length,
        tasks: snapshot?.tasks.length ?? 0,
        members: snapshot?.workspaces.members.length ?? 0,
      },
    }
  }

  async readSnapshot(id: string): Promise<ProjectSnapshot> {
    const project = await this.readProject(id)
    const dir = this.projectDir(id)
    const [memoryText, conventionsText, decisionsText, dirs, tools, progress, sessions, tasks, workspaces] =
      await Promise.all([
        readTextIfExists(join(dir, MEMORY_FILE)),
        readTextIfExists(join(dir, CONVENTIONS_FILE)),
        readTextIfExists(join(dir, DECISIONS_FILE)),
        readDirs(join(dir, 'refs', 'dirs.json')),
        readTools(join(dir, 'refs', 'tools.json')),
        readProgress(join(dir, PROGRESS_FILE)),
        this.readSessionsWithArchive(id),
        readTasks(join(dir, TASKS_FILE)),
        readWorkspaces(join(dir, WORKSPACES_FILE), project.primaryPath),
      ])
    return {
      project,
      memoryText: memoryText ?? '',
      conventionsText: conventionsText ?? '',
      decisionsText: decisionsText ?? '',
      dirs,
      tools,
      progress,
      sessions,
      tasks,
      workspaces,
    }
  }

  async updateProject(id: string, update: (project: ProjectDocument) => ProjectDocument): Promise<ProjectDocument> {
    return this.projectLock(id, async () => {
      const current = await this.readProject(id)
      const next = update({ ...current, updatedAt: nowIso() })
      await writeJsonAtomic(this.file(id, PROJECT_FILE), next)
      return next
    })
  }

  async writeMemory(
    id: string,
    content: string,
    sourceSessionId: string,
  ): Promise<NoteWriteResult> {
    return this.appendMarkdown(id, 'memory', content, sourceSessionId)
  }

  async writeConvention(
    id: string,
    content: string,
    sourceSessionId: string,
  ): Promise<NoteWriteResult> {
    return this.appendMarkdown(id, 'convention', content, sourceSessionId)
  }

  private async appendMarkdown(
    id: string,
    kind: 'memory' | 'convention',
    content: string,
    sourceSessionId: string,
  ): Promise<NoteWriteResult> {
    const limit = kind === 'memory' ? this.limits.memoryBytes : this.limits.conventionsBytes
    const entryLimit = kind === 'memory'
      ? this.limits.memoryEntryBytes
      : this.limits.conventionEntryBytes
    const body = cleanBody(content, entryLimit, kind === 'memory' ? 'Memory entry' : 'Convention')
    const file = this.file(id, kind === 'memory' ? MEMORY_FILE : CONVENTIONS_FILE)
    return this.projectLock(id, async () => {
      const text = (await readTextIfExists(file)) ?? ''
      const entries = parseMarkdown(text)
      const duplicate = activeEntries(entries).find((entry) => contentKey(entry.body) === contentKey(body))
      if (duplicate !== undefined && duplicate.meta !== null) {
        return { entryId: duplicate.meta.id, deduped: true, archived: 0 }
      }
      const prefix = kind === 'memory' ? 'mem' : 'con'
      const entry: MarkdownEntry = {
        meta: {
          id: newEntryId(prefix),
          createdAt: nowIso(),
          updatedAt: nowIso(),
          source: sourceSessionId,
        },
        body,
        raw: '',
      }
      entries.push(entry)
      const archived = await this.archiveMarkdownIfNeeded(id, file, kind, entries, limit)
      await this.writeMarkdown(file, kind, entries)
      await this.touchProject(id)
      return { entryId: entry.meta!.id, deduped: false, archived: archived.count }
    })
  }

  async writeDecision(
    id: string,
    input: {
      title?: string
      context: string
      decision: string
      consequences: string
      status?: 'proposed' | 'accepted' | 'superseded' | 'deprecated'
      sourceSessionId: string
    },
  ): Promise<NoteWriteResult> {
    const decisionBody = cleanBody(input.decision, this.limits.decisionEntryBytes, 'Decision')
    const file = this.file(id, DECISIONS_FILE)
    return this.projectLock(id, async () => {
      const text = (await readTextIfExists(file)) ?? ''
      const entries = parseMarkdown(text)
      const existing = activeEntries(entries).find((entry) => {
        const parsed = parseDecisionBody(entry.body, entry.meta?.createdAt ?? nowIso())
        return contentKey(parsed.decision) === contentKey(decisionBody)
      })
      if (existing !== undefined && existing.meta !== null) {
        return { entryId: existing.meta.id, deduped: true, archived: 0 }
      }
      const decisionId = nextDecisionId(entries)
      const time = nowIso()
      const body = renderDecisionBody({
        id: decisionId,
        date: time.slice(0, 10),
        status: input.status ?? 'accepted',
        ...(input.title === undefined ? {} : { title: input.title }),
        context: cleanInline(input.context, 1_000),
        decision: decisionBody,
        consequences: cleanInline(input.consequences, 1_500),
      })
      const entry: MarkdownEntry = {
        meta: { id: decisionId, createdAt: time, updatedAt: time, source: input.sourceSessionId },
        body,
        raw: '',
      }
      entries.push(entry)
      const archived = await this.archiveMarkdownIfNeeded(id, file, 'decision', entries, this.limits.decisionsBytes)
      await this.writeMarkdown(file, 'decision', entries)
      await this.touchProject(id)
      return { entryId: decisionId, deduped: false, archived: archived.count }
    })
  }

  private async writeMarkdown(
    file: string,
    kind: 'memory' | 'convention' | 'decision',
    entries: MarkdownEntry[],
  ): Promise<void> {
    const rendered = renderEntries(entries, kind)
    await writeFileAtomic(file, rendered)
  }

  private async archiveMarkdownIfNeeded(
    id: string,
    file: string,
    kind: 'memory' | 'convention' | 'decision',
    entries: MarkdownEntry[],
    limit: number,
  ): Promise<{ count: number }> {
    if (Buffer.byteLength(renderEntries(entries, kind), 'utf8') <= limit) return { count: 0 }
    const target = Math.max(1, Math.floor(limit * this.limits.archiveRatio))
    const candidates = activeEntries(entries)
      .filter((entry) => entry.meta !== undefined)
      .sort((left, right) =>
        (left.meta?.updatedAt ?? left.meta?.createdAt ?? '').localeCompare(
          right.meta?.updatedAt ?? right.meta?.createdAt ?? '',
        ),
      )
    const archiveEntries: MarkdownEntry[] = []
    while (
      Buffer.byteLength(renderEntries(entries, kind), 'utf8') > target &&
      candidates.length > 0
    ) {
      const candidate = candidates.shift()
      if (candidate?.meta === undefined) break
      archiveEntries.push(candidate)
    }
    if (archiveEntries.length === 0) return { count: 0 }
    const kindName = kind === 'memory' ? 'MEMORY' : kind === 'convention' ? 'CONVENTIONS' : 'DECISIONS'
    const archivedForFile: MarkdownEntry[] = archiveEntries.map((entry) => {
      if (entry.meta === null) return entry
      const { archived: _archived, ...meta } = entry.meta
      return { ...entry, meta }
    })
    const archive = await writeArchiveText(
      this.projectDir(id),
      `${kindName}-${timestampSlug()}`,
      renderEntries(archivedForFile, kind),
      'md',
    )
    for (const entry of archiveEntries) {
      if (entry.meta === null) continue
      entry.meta = { ...entry.meta, archived: archive.relative }
      entry.body = `> Archived entry \`${entry.meta.id}\` — see \`${archive.relative}\`.`
    }
    const first = archiveEntries[0]?.meta?.createdAt ?? nowIso()
    const last = archiveEntries[archiveEntries.length - 1]?.meta?.createdAt ?? nowIso()
    await recordArchive(this.projectDir(id), {
      kind,
      file: archive.relative,
      count: archiveEntries.length,
      from: first,
      to: last,
    })
    return { count: archiveEntries.length }
  }

  async writeProgress(
    id: string,
    input: {
      sessionId: string
      stage: string
      did: string
      next: string
      blocked?: string
      tags?: string[]
    },
  ): Promise<{ deduped: boolean; archived: number }> {
    const entry = normalizeProgress({
      ...input,
      lineBytes: this.limits.progressLineBytes,
    })
    return this.projectLock(id, async () => {
      const file = this.file(id, PROGRESS_FILE)
      const current = await readProgress(file)
      if (isDuplicateProgress(entry, current)) return { deduped: true, archived: 0 }
      current.push(entry)
      const archived = await this.archiveProgressIfNeeded(id, file, current)
      await writeProgress(file, current)
      await this.touchProject(id)
      return { deduped: false, archived }
    })
  }

  private async archiveProgressIfNeeded(
    id: string,
    file: string,
    entries: ProgressEntry[],
  ): Promise<number> {
    const bytes = Buffer.byteLength(entries.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8')
    if (entries.length <= this.limits.progressLines && bytes <= this.limits.progressBytes) return 0
    const keep = Math.max(1, Math.floor(this.limits.progressLines * this.limits.archiveRatio))
    const remove = Math.max(1, entries.length - keep)
    const archived = entries.splice(0, remove)
    const archive = await writeArchiveText(
      this.projectDir(id),
      `progress-${timestampSlug()}`,
      archived.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      'jsonl',
    )
    const pointer = renderProgressArchivePointer({
      count: archived.length,
      through: archived[archived.length - 1]?.ts ?? nowIso(),
      file: archive.relative,
    })
    entries.unshift(pointer)
    await recordArchive(this.projectDir(id), {
      kind: 'progress',
      file: archive.relative,
      count: archived.length,
      from: archived[0]?.ts ?? nowIso(),
      to: archived[archived.length - 1]?.ts ?? nowIso(),
    })
    return archived.length
  }

  async writeDirRef(
    id: string,
    input: {
      kind: 'dir' | 'file'
      path: string
      purpose: string
      note?: string
      addedBy: string
    },
  ): Promise<RefWriteResult> {
    const file = this.file(id, join('refs', 'dirs.json'))
    return this.projectLock(id, async () => {
      const refs = await readDirs(file)
      const existing = refs.find((ref) => ref.kind === input.kind && ref.path === input.path.trim())
      if (existing !== undefined) {
        const updated = { ...existing, purpose: cleanInline(input.purpose, 500), note: cleanInline(input.note ?? '', 1_000) }
        await upsertDir(file, updated, this.limits.refsEntries, async (archived) => {
          const archive = await writeArchiveText(
            this.projectDir(id),
            `dirs-${timestampSlug()}`,
            `${JSON.stringify(archived, null, 2)}\n`,
            'json',
          )
          await recordArchive(this.projectDir(id), {
            kind: 'dirs',
            file: archive.relative,
            count: archived.length,
            from: archived[0]?.addedAt ?? nowIso(),
            to: archived[archived.length - 1]?.addedAt ?? nowIso(),
          })
        })
        await this.touchProject(id)
        return { deduped: true, archived: 0, entry: updated }
      }
      const ref = {
        kind: input.kind,
        path: input.path.trim(),
        purpose: cleanInline(input.purpose, 500),
        note: cleanInline(input.note ?? '', 1_000),
        addedAt: nowIso(),
        addedBy: input.addedBy,
      } as DirectoryRef
      const result = await upsertDir(file, ref, this.limits.refsEntries, async (archived) => {
        const archive = await writeArchiveText(
          this.projectDir(id),
          `dirs-${timestampSlug()}`,
          `${JSON.stringify(archived, null, 2)}\n`,
          'json',
        )
        await recordArchive(this.projectDir(id), {
          kind: 'dirs',
          file: archive.relative,
          count: archived.length,
          from: archived[0]?.addedAt ?? nowIso(),
          to: archived[archived.length - 1]?.addedAt ?? nowIso(),
        })
      })
      await this.touchProject(id)
      return { deduped: result.deduped, archived: result.archived, entry: ref }
    })
  }

  async writeToolRef(
    id: string,
    input: {
      kind: 'tool' | 'plugin' | 'mcp'
      tool: string
      args?: string[]
      purpose: string
      note?: string
      addedBy: string
    },
  ): Promise<RefWriteResult> {
    const file = this.file(id, join('refs', 'tools.json'))
    return this.projectLock(id, async () => {
      const refs = await readTools(file)
      const key = `${input.kind}:${input.tool.trim()}:${JSON.stringify(input.args ?? [])}`
      const existing = refs.find((ref) => `${ref.kind}:${ref.tool}:${JSON.stringify(ref.args)}` === key)
      if (existing !== undefined) {
        const updated = { ...existing, purpose: cleanInline(input.purpose, 500), note: cleanInline(input.note ?? '', 1_000) }
        const result = await upsertTool(file, updated, this.limits.refsEntries, async (archived) => {
          const archive = await writeArchiveText(
            this.projectDir(id),
            `tools-${timestampSlug()}`,
            `${JSON.stringify(archived, null, 2)}\n`,
            'json',
          )
          await recordArchive(this.projectDir(id), {
            kind: 'tools',
            file: archive.relative,
            count: archived.length,
            from: archived[0]?.addedAt ?? nowIso(),
            to: archived[archived.length - 1]?.addedAt ?? nowIso(),
          })
        })
        await this.touchProject(id)
        return { deduped: true, archived: result.archived, entry: updated }
      }
      const ref = {
        kind: input.kind,
        tool: input.tool.trim(),
        args: (input.args ?? []).map((arg) => cleanInline(arg, 500)).filter((arg) => arg !== ''),
        purpose: cleanInline(input.purpose, 500),
        note: cleanInline(input.note ?? '', 1_000),
        addedAt: nowIso(),
        addedBy: input.addedBy,
      } as ToolRef
      const result = await upsertTool(file, ref, this.limits.refsEntries, async (archived) => {
        const archive = await writeArchiveText(
          this.projectDir(id),
          `tools-${timestampSlug()}`,
          `${JSON.stringify(archived, null, 2)}\n`,
          'json',
        )
        await recordArchive(this.projectDir(id), {
          kind: 'tools',
          file: archive.relative,
          count: archived.length,
          from: archived[0]?.addedAt ?? nowIso(),
          to: archived[archived.length - 1]?.addedAt ?? nowIso(),
        })
      })
      await this.touchProject(id)
      return { deduped: result.deduped, archived: result.archived, entry: ref }
    })
  }

  async readSessionsWithArchive(id: string): Promise<SessionBindings> {
    const active = await readSessions(this.file(id, SESSIONS_FILE))
    const archiveDir = join(this.projectDir(id), 'archive')
    let files: string[] = []
    try {
      files = (await readdir(archiveDir)).filter((name) => /^sessions-.*\.json$/u.test(name))
    } catch {
      files = []
    }
    if (files.length === 0) return active
    const merged: SessionBindings = { ...active }
    for (const file of files) {
      const archived = await readSessions(join(archiveDir, file)).catch(() => ({}))
      for (const [sessionId, binding] of Object.entries(archived)) {
        if (merged[sessionId] === undefined) merged[sessionId] = binding
      }
    }
    return merged
  }

  async findBinding(sessionId: string): Promise<{ projectId: string; binding: SessionBinding } | undefined> {
    const { projects } = await this.listProjects(true)
    let best: { projectId: string; binding: SessionBinding } | undefined
    for (const project of projects) {
      const bindings = await this.readSessionsWithArchive(project.id)
      const binding = bindingFor(bindings, sessionId)
      if (binding === undefined) continue
      if (best === undefined || binding.boundAt > best.binding.boundAt) {
        best = { projectId: project.id, binding }
      }
    }
    return best
  }

  async bindSession(
    id: string,
    sessionId: string,
    binding: SessionBinding,
  ): Promise<void> {
    await this.projectLock(id, async () => {
      const current = await readSessions(this.file(id, SESSIONS_FILE))
      const next = setBinding(current, sessionId, binding)
      if (Object.keys(next).length > this.limits.sessionsEntries) {
        const entries = Object.entries(next).sort((left, right) =>
          left[1].boundAt.localeCompare(right[1].boundAt),
        )
        const remove = entries.slice(0, entries.length - Math.max(1, Math.floor(this.limits.sessionsEntries * this.limits.archiveRatio)))
        const archived: SessionBindings = Object.fromEntries(remove)
        const retained: SessionBindings = Object.fromEntries(entries.slice(remove.length))
        const archive = await writeArchiveText(
          this.projectDir(id),
          `sessions-${timestampSlug()}`,
          `${JSON.stringify(archived, null, 2)}\n`,
          'json',
        )
        await recordArchive(this.projectDir(id), {
          kind: 'sessions',
          file: archive.relative,
          count: remove.length,
          from: remove[0]?.[1].boundAt ?? nowIso(),
          to: remove[remove.length - 1]?.[1].boundAt ?? nowIso(),
        })
        await writeSessions(this.file(id, SESSIONS_FILE), retained)
      } else {
        await writeSessions(this.file(id, SESSIONS_FILE), next)
      }
      await this.touchProject(id)
    })
    // Best-effort removal from other projects; the resolver uses boundAt when
    // a crash leaves a duplicate behind.
    const { projects } = await this.listProjects(true)
    await Promise.all(projects
      .filter((project) => project.id !== id)
      .map(async (project) => {
        try {
          await this.projectLock(project.id, async () => {
            const current = await readSessions(this.file(project.id, SESSIONS_FILE))
            if (current[sessionId] === undefined) return
            await writeSessions(this.file(project.id, SESSIONS_FILE), removeBinding(current, sessionId))
          })
        } catch {
          // A concurrent writer or a removed project leaves the duplicate for
          // the latest-boundAt resolver.
        }
      }))
  }

  async insertWorkspaceMember(
    id: string,
    input: {
      kind: 'directory' | 'session' | 'project'
      path?: string
      sessionId?: string
      projectId?: string
      label?: string
      note?: string
      addedBy: string
    },
  ): Promise<{ deduped: boolean; member: WorkspaceMember }> {
    if (input.kind === 'directory' && (input.path === undefined || !isAbsolute(input.path))) {
      throw new ProjectError('INVALID_ARGUMENT', 'A directory member requires an absolute path.')
    }
    if (input.kind === 'session' && (input.sessionId === undefined || input.sessionId.trim() === '')) {
      throw new ProjectError('INVALID_ARGUMENT', 'A session member requires a sessionId.')
    }
    if (input.kind === 'project' && (input.projectId === undefined || !isProjectId(input.projectId))) {
      throw new ProjectError('INVALID_ARGUMENT', 'A project member requires a project id.')
    }
    return this.projectLock(id, async () => {
      const project = await this.readProject(id)
      const workspaces = await readWorkspaces(this.file(id, WORKSPACES_FILE), project.primaryPath)
      const member = makeMember({
        ...input,
        id: newMemberId(),
        addedBy: input.addedBy,
      })
      const result = await insertMember(this.file(id, WORKSPACES_FILE), workspaces, member)
      await this.touchProject(id)
      return result
    })
  }

  async removeWorkspaceMember(id: string, memberId: string): Promise<boolean> {
    return this.projectLock(id, async () => {
      const project = await this.readProject(id)
      const workspaces = await readWorkspaces(this.file(id, WORKSPACES_FILE), project.primaryPath)
      const removed = await removeMember(this.file(id, WORKSPACES_FILE), workspaces, memberId)
      if (removed) await this.touchProject(id)
      return removed
    })
  }

  async readTasks(id: string): Promise<TaskRecord[]> {
    return readTasks(this.file(id, TASKS_FILE))
  }

  async writeTask(id: string, task: TaskRecord): Promise<void> {
    await this.projectLock(id, async () => {
      const tasks = await readTasks(this.file(id, TASKS_FILE))
      const next = trimTasks(
        upsertTaskList(tasks, task),
        this.limits.tasksEntries,
      )
      await writeTasks(this.file(id, TASKS_FILE), next)
      await this.touchProject(id)
    })
  }

  async touchProject(id: string): Promise<void> {
    const current = await this.readProject(id)
    await writeJsonAtomic(this.file(id, PROJECT_FILE), { ...current, updatedAt: nowIso() })
  }

  async forkProject(
    sourceId: string,
    input: { name: string; aliases?: string[]; primaryPath?: string },
  ): Promise<ProjectDocument> {
    const source = await this.readSnapshot(sourceId)
    const name = validateName(input.name)
    const aliases = validateAliases(input.aliases)
    const primaryPath = validatePrimaryPath(input.primaryPath ?? source.project.primaryPath)
    return this.registryLock(async () => {
      const { projects } = await this.listProjects(true)
      const all = await Promise.all(projects.map((project) => this.readProject(project.id)))
      const lookup = normalizeLookup(name)
      if (all.some((project) =>
        normalizeLookup(project.name) === lookup ||
        project.aliases.some((alias) => normalizeLookup(alias) === lookup) ||
        aliases.some((alias) =>
          normalizeLookup(project.name) === normalizeLookup(alias) ||
          project.aliases.some((value) => normalizeLookup(value) === normalizeLookup(alias)),
        ),
      )) {
        throw new ProjectError('PROJECT_EXISTS', `Project name or alias "${name}" is already in use.`)
      }
      const id = newProjectId()
      const time = nowIso()
      const document: ProjectDocument = {
        schemaVersion: 1,
        id,
        name,
        aliases,
        createdAt: time,
        updatedAt: time,
        archived: false,
        primaryPath,
        forkedFrom: sourceId,
      }
      const temp = join(this.projectsDir, `.tmp-${id}-${Date.now().toString(36)}`)
      const final = this.projectDir(id)
      await ensureDir(temp)
      try {
        await writeJsonAtomic(join(temp, PROJECT_FILE), document)
        await writeFileAtomic(join(temp, MEMORY_FILE), source.memoryText || this.initialMarkdown('Project memory'))
        await writeFileAtomic(join(temp, CONVENTIONS_FILE), source.conventionsText || this.initialMarkdown('Project conventions'))
        await writeFileAtomic(join(temp, DECISIONS_FILE), source.decisionsText || this.initialMarkdown('Project decisions'))
        await ensureDir(join(temp, 'refs'))
        await writeJsonAtomic(join(temp, 'refs', 'dirs.json'), source.dirs)
        await writeJsonAtomic(join(temp, 'refs', 'tools.json'), source.tools)
        await writeFileAtomic(
          join(temp, PROGRESS_FILE),
          source.progress.map((entry) => JSON.stringify(entry)).join('\n') + (source.progress.length === 0 ? '' : '\n'),
        )
        await writeJsonAtomic(join(temp, SESSIONS_FILE), {})
        await writeJsonAtomic(join(temp, TASKS_FILE), { schemaVersion: 1, tasks: {} })
        await writeJsonAtomic(join(temp, WORKSPACES_FILE), {
          ...source.workspaces,
          primary: { path: primaryPath, label: source.workspaces.primary.label },
        })
        await ensureDir(join(temp, 'archive'))
        await rename(temp, final)
      } catch (error) {
        await rm(temp, { recursive: true, force: true }).catch(() => undefined)
        throw error
      }
      return document
    })
  }

  async mergeProjects(
    sourceId: string,
    targetId: string,
    input: { deleteSource?: boolean; purgeSource?: boolean } = {},
  ): Promise<{ sourceRetained: boolean }> {
    if (sourceId === targetId) {
      throw new ProjectError('INVALID_ARGUMENT', 'A project cannot be merged into itself.')
    }
    return this.twoProjectLocks(sourceId, targetId, async () => {
      const source = await this.readSnapshot(sourceId)
      const target = await this.readSnapshot(targetId)
      const merged = mergeSnapshots(source, target, this.limits, input.deleteSource === true)
      await this.writeMergedSnapshot(targetId, merged)
      if (input.deleteSource === true) {
        await this.deleteProjectUnlocked(sourceId, input.purgeSource === true ? 'purge' : 'trash')
        return { sourceRetained: false }
      }
      return { sourceRetained: true }
    })
  }

  private async writeMergedSnapshot(id: string, snapshot: ProjectSnapshot): Promise<void> {
    const dir = this.projectDir(id)
    await writeFileAtomic(join(dir, MEMORY_FILE), snapshot.memoryText)
    await writeFileAtomic(join(dir, CONVENTIONS_FILE), snapshot.conventionsText)
    await writeFileAtomic(join(dir, DECISIONS_FILE), snapshot.decisionsText)
    await writeJsonAtomic(join(dir, 'refs', 'dirs.json'), snapshot.dirs)
    await writeJsonAtomic(join(dir, 'refs', 'tools.json'), snapshot.tools)
    await writeFileAtomic(
      join(dir, PROGRESS_FILE),
      snapshot.progress.map((entry) => JSON.stringify(entry)).join('\n') + (snapshot.progress.length === 0 ? '' : '\n'),
    )
    await writeJsonAtomic(join(dir, SESSIONS_FILE), snapshot.sessions)
    await writeTasks(join(dir, TASKS_FILE), snapshot.tasks)
    await writeJsonAtomic(join(dir, WORKSPACES_FILE), snapshot.workspaces)
    await writeJsonAtomic(join(dir, PROJECT_FILE), {
      ...snapshot.project,
      updatedAt: nowIso(),
    })
  }

  async deleteProject(id: string, mode: 'trash' | 'purge'): Promise<{ trashPath?: string }> {
    return this.registryLock(() => this.deleteProjectUnlocked(id, mode))
  }

  private async deleteProjectUnlocked(
    id: string,
    mode: 'trash' | 'purge',
  ): Promise<{ trashPath?: string }> {
    const dir = this.projectDir(id)
    await this.readProject(id)
    if (mode === 'purge') {
      await rm(dir, { recursive: true, force: true })
      return {}
    }
    const trashDir = join(this.projectsDir, '.trash')
    await mkdir(trashDir, { recursive: true, mode: 0o700 })
    const destination = join(trashDir, `${id}-${timestampSlug()}`)
    await rename(dir, destination)
    await rm(join(destination, '.lock'), { force: true }).catch(() => undefined)
    return { trashPath: destination }
  }

  async setArchived(id: string, archived: boolean): Promise<ProjectDocument> {
    return this.updateProject(id, (project) => ({ ...project, archived }))
  }

  async readArchivedSessions(id: string): Promise<SessionBindings> {
    return this.readSessionsWithArchive(id)
  }

  async writeDecisionUnlocked(
    id: string,
    entries: MarkdownEntry[],
    limit: number,
  ): Promise<{ archived: number }> {
    const file = this.file(id, DECISIONS_FILE)
    const archived = await this.archiveMarkdownIfNeeded(id, file, 'decision', entries, limit)
    await this.writeMarkdown(file, 'decision', entries)
    return { archived: archived.count }
  }

  async writeTextForTest(id: string, relative: string, content: string): Promise<void> {
    await writeFileAtomic(join(this.projectDir(id), relative), content)
  }

  async readTextForTest(id: string, relative: string): Promise<string | undefined> {
    return readTextIfExists(join(this.projectDir(id), relative))
  }

  async readMemoryEntries(id: string): Promise<MarkdownEntry[]> {
    return parseMarkdown((await readTextIfExists(this.file(id, MEMORY_FILE))) ?? '')
  }

  async readConventionEntries(id: string): Promise<MarkdownEntry[]> {
    return parseMarkdown((await readTextIfExists(this.file(id, CONVENTIONS_FILE))) ?? '')
  }

  async readDecisionEntries(id: string): Promise<MarkdownEntry[]> {
    return parseMarkdown((await readTextIfExists(this.file(id, DECISIONS_FILE))) ?? '')
  }

  async readDecisionViews(id: string): Promise<Array<ReturnType<typeof parseDecisionBody> & { id: string; entry: MarkdownEntry }>> {
    const entries = await this.readDecisionEntries(id)
    return activeEntries(entries).flatMap((entry) => {
      if (entry.meta === null) return []
      return [{ id: entry.meta.id, entry, ...parseDecisionBody(entry.body, entry.meta.createdAt) }]
    })
  }

  async readEffectiveProgress(id: string): Promise<ProgressEntry[]> {
    const text = (await readTextIfExists(this.file(id, PROGRESS_FILE))) ?? ''
    return parseProgress(text).entries
  }

  async readTaskEvents(id: string): Promise<string[]> {
    const text = (await readTextIfExists(this.file(id, 'task-events.jsonl'))) ?? ''
    return text.split('\n').filter((line) => line.trim() !== '')
  }
}

function upsertTaskList(tasks: TaskRecord[], task: TaskRecord): TaskRecord[] {
  const index = tasks.findIndex((candidate) => candidate.id === task.id)
  if (index < 0) return [...tasks, task]
  const next = [...tasks]
  next[index] = task
  return next
}

function mergeSnapshots(
  source: ProjectSnapshot,
  target: ProjectSnapshot,
  limits: ProjectLimits,
  deleteSource: boolean,
): ProjectSnapshot {
  const memory = mergeMarkdown(source.memoryText, target.memoryText, 'memory')
  const conventions = mergeMarkdown(source.conventionsText, target.conventionsText, 'convention')
  const decisions = mergeDecisions(source.decisionsText, target.decisionsText)
  const dirs = uniqueBy(
    [...target.dirs, ...source.dirs],
    (ref) => `${ref.kind}:${ref.path}`,
  )
  const tools = uniqueBy(
    [...target.tools, ...source.tools],
    (ref) => `${ref.kind}:${ref.tool}:${JSON.stringify(ref.args)}`,
  )
  const progressKeys = new Set(target.progress.map(progressKey))
  const progress = [...target.progress]
  for (const entry of source.progress) {
    const key = progressKey(entry)
    if (progressKeys.has(key)) continue
    progressKeys.add(key)
    progress.push({ ...entry, tags: uniqueBy([...entry.tags, `merged:${source.project.id}`], (tag) => tag) })
  }
  if (progress.length > limits.progressLines) progress.splice(0, progress.length - limits.progressLines)
  const sessions = { ...target.sessions }
  if (deleteSource) {
    for (const [sessionId, binding] of Object.entries(source.sessions)) {
      if (sessions[sessionId] === undefined || binding.boundAt > sessions[sessionId]!.boundAt) {
        sessions[sessionId] = binding
      }
    }
  }
  const tasks = deleteSource
    ? uniqueBy(
      [...target.tasks, ...source.tasks.map((task) => ({ ...task, projectId: target.project.id }))],
      (task) => task.id,
    ).slice(-limits.tasksEntries)
    : [...target.tasks]
  const members = uniqueBy(
    [
      ...target.workspaces.members.filter((member) => !(deleteSource && member.projectId === source.project.id)),
      ...source.workspaces.members.filter((member) => member.projectId !== source.project.id || !deleteSource),
      ...(source.project.primaryPath === target.project.primaryPath
        ? []
        : [{
          id: newMemberId(),
          kind: 'directory' as const,
          path: source.project.primaryPath,
          label: source.project.name,
          note: 'merged source workspace',
          addedAt: nowIso(),
          addedBy: 'merge',
        }]),
    ],
    (member) => `${member.kind}:${member.path ?? member.sessionId ?? member.projectId ?? member.id}`,
  )
  return {
    project: {
      ...target.project,
      updatedAt: nowIso(),
      mergedFrom: uniqueBy([...(target.project.mergedFrom ?? []), source.project.id], (id) => id),
    },
    memoryText: memory,
    conventionsText: conventions,
    decisionsText: decisions,
    dirs,
    tools,
    progress,
    sessions,
    tasks,
    workspaces: {
      ...target.workspaces,
      members,
    },
  }
}

function progressKey(entry: ProgressEntry): string {
  return `${entry.ts}|${entry.sessionId}|${entry.stage}|${entry.did}|${entry.next}|${entry.blocked ?? ''}`
}

function mergeMarkdown(
  sourceText: string,
  targetText: string,
  kind: 'memory' | 'convention',
): string {
  const targetEntries = parseMarkdown(targetText)
  const seen = new Set(activeEntries(targetEntries).map((entry) => contentKey(entry.body)))
  const additions: MarkdownEntry[] = []
  for (const entry of activeEntries(parseMarkdown(sourceText))) {
    if (entry.meta === null) continue
    const key = contentKey(entry.body)
    if (seen.has(key)) continue
    seen.add(key)
    if (entry.meta === null) continue
    additions.push({
      meta: {
        id: newEntryId(kind === 'memory' ? 'mem' : 'con'),
        createdAt: entry.meta.createdAt,
        updatedAt: nowIso(),
        ...(entry.meta.source === undefined ? {} : { source: entry.meta.source }),
      },
      body: entry.body,
      raw: '',
    })
  }
  return renderEntries([...targetEntries, ...additions], kind)
}

function mergeDecisions(sourceText: string, targetText: string): string {
  const targetEntries = parseMarkdown(targetText)
  const seen = new Set(activeEntries(targetEntries).map((entry) =>
    contentKey(parseDecisionBody(entry.body, entry.meta?.createdAt ?? nowIso()).decision),
  ))
  let next = targetEntries
  for (const entry of activeEntries(parseMarkdown(sourceText))) {
    if (entry.meta === null) continue
    const body = parseDecisionBody(entry.body, entry.meta.createdAt)
    const key = contentKey(body.decision)
    if (seen.has(key)) continue
    seen.add(key)
    const id = nextDecisionId(next)
    const time = nowIso()
    const rendered = renderDecisionBody({
      id,
      date: body.date,
      status: body.status,
      title: body.title,
      context: body.context,
      decision: body.decision,
      consequences: body.consequences,
    })
    next.push({
      meta: { id, createdAt: time, updatedAt: time, source: entry.meta.source ?? 'merge' },
      body: rendered,
      raw: '',
    })
  }
  return renderEntries(next, 'decision')
}
