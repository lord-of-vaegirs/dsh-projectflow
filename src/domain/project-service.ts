import type { ProjectFlowConfig } from '../config.js'
import { ProjectError } from '../errors.js'
import type {
  DecisionStatus,
  DirectoryRef,
  NoteCategory,
  ProgressEntry,
  ProjectContextResult,
  ProjectCreateInput,
  ProjectCreateResult,
  ProjectDeleteInput,
  ProjectDeleteResult,
  ProjectDocument,
  ProjectForkInput,
  ProjectForkResult,
  ProjectInsertInput,
  ProjectInsertResult,
  ProjectMergeInput,
  ProjectMergeResult,
  ProjectNoteInput,
  ProjectNoteResult,
  ProjectRefInput,
  ProjectRefResult,
  ProjectStatus,
  ProjectSummary,
  ProjectTaskInput,
  ProjectTaskResult,
  ProjectUseResult,
  RefKind,
  SessionBinding,
  TaskCheckpoint,
  TaskRecord,
  WorkspaceMember,
} from '../shared/contracts.js'
import { nowIso } from '../util/time.js'
import { cleanBody, cleanInline, oneLine } from '../util/text.js'
import { activeEntriesForStatus, ProjectStore } from '../store/project-store.js'
import { parseDecisionBody } from '../store/markdown.js'
import { newTaskId } from '../util/ids.js'
import { emptyCheckpoint } from '../store/tasks.js'
import { renderProjectContext } from '../injection/render.js'
import { estimateTokens } from '../injection/token-estimate.js'

export interface AgentLike {
  id: string
  session: {
    id: string
    header?: {
      cwd?: string
      parentSession?: string
      createdAt?: number
    }
    snapshotEvents?: () => readonly unknown[]
  }
  cancel?: (cause: { kind: 'hook'; reason: string }, options?: { keepInbox?: boolean }) => void
}

function sessionPath(agent: AgentLike): string | undefined {
  const cwd = agent.session.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

function parentSession(agent: AgentLike): string | undefined {
  const parent = agent.session.header?.parentSession
  return typeof parent === 'string' && parent !== '' ? parent : undefined
}

function noteCategory(category: NoteCategory): {
  target: 'memory' | 'convention' | 'decision' | 'progress' | 'dir' | 'tool'
  refKind?: RefKind
} {
  switch (category) {
    case 'fact': return { target: 'memory' }
    case 'convention': return { target: 'convention' }
    case 'decision': return { target: 'decision' }
    case 'progress': return { target: 'progress' }
    case 'ref-dir': return { target: 'dir', refKind: 'dir' }
    case 'ref-file': return { target: 'dir', refKind: 'file' }
    case 'ref-tool': return { target: 'tool', refKind: 'tool' }
    case 'ref-plugin': return { target: 'tool', refKind: 'plugin' }
    case 'ref-mcp': return { target: 'tool', refKind: 'mcp' }
  }
}

export class ProjectService {
  readonly config: ProjectFlowConfig
  readonly store: ProjectStore
  private readonly logger: { warn?: (message: string) => void } | undefined

  constructor(
    config: ProjectFlowConfig,
    store = new ProjectStore(config),
    logger?: { warn?: (message: string) => void },
  ) {
    this.config = config
    this.store = store
    this.logger = logger
  }

  async list(includeArchived = false): Promise<{ projects: ProjectSummary[]; invalid: Array<{ id: string; error: string }> }> {
    return this.store.listProjects(includeArchived)
  }

  async get(reference: string): Promise<ProjectDocument> {
    return this.store.getProject(reference)
  }

  async create(input: ProjectCreateInput): Promise<ProjectCreateResult> {
    const result = await this.store.createProject({
      name: input.name,
      ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
      primaryPath: input.primaryPath,
    })
    let binding: SessionBinding | undefined
    if (input.bindSessionId !== undefined && input.bindSessionId !== '') {
      binding = await this.bind(input.bindSessionId, result.project, undefined)
    }
    return {
      project: await this.store.summarize(result.project),
      created: result.created,
      ...(binding === undefined ? {} : { binding }),
    }
  }

  async use(sessionId: string, reference: string, note?: string): Promise<ProjectUseResult> {
    if (sessionId.trim() === '') throw new ProjectError('SESSION_REQUIRED', 'A live session is required to bind a project.')
    const project = await this.store.getProject(reference)
    if (project.archived) {
      throw new ProjectError('PROJECT_ARCHIVED', `Project ${project.name} is archived.`, 'Unarchive it before binding.')
    }
    const binding = await this.bind(sessionId, project, note)
    const context = await this.context(project.id)
    return {
      project: await this.store.summarize(project),
      binding,
      estimatedContextTokens: context.estimatedTokens,
      contextBudgetTokens: this.config.contextBudgetTokens,
    }
  }

  async bind(
    sessionId: string,
    project: ProjectDocument,
    note?: string,
    parentSessionId?: string,
    workspacePath?: string,
  ): Promise<SessionBinding> {
    const binding: SessionBinding = {
      boundAt: nowIso(),
      ...(parentSessionId === undefined ? {} : { parentSessionId }),
      ...(workspacePath === undefined ? {} : { workspacePath }),
      ...(note === undefined || note.trim() === '' ? {} : { note: cleanInline(note, 500) }),
    }
    await this.store.bindSession(project.id, sessionId, binding)
    return binding
  }

  async bindingForSession(sessionId: string): Promise<{ projectId: string; binding: SessionBinding } | undefined> {
    return this.store.findBinding(sessionId)
  }

  /**
   * Materialize a fork's inherited binding before its first prompt assembly.
   * A failure is logged and never fails agent creation.
   */
  async inheritForAgent(agent: AgentLike): Promise<void> {
    try {
      if (agent.id === undefined || agent.session?.id === undefined) return
      const existing = await this.store.findBinding(agent.id)
      if (existing !== undefined) return
      const parent = parentSession(agent)
      if (parent === undefined) return
      const parentBinding = await this.store.findBinding(parent)
      if (parentBinding === undefined) return
      const project = await this.store.readProject(parentBinding.projectId)
      if (project.archived) return
      await this.bind(
        agent.id,
        project,
        `inherited from ${parent}`,
        parent,
        sessionPath(agent),
      )
    } catch (error) {
      this.logger?.warn?.(`[projectflow] fork inheritance failed: ${(error as Error).message}`)
    }
  }

  async context(projectReference: string, sessionId?: string): Promise<ProjectContextResult> {
    const project = await this.store.getProject(projectReference)
    const snapshot = await this.store.readSnapshot(project.id)
    const memory = activeEntriesForStatus(snapshot.memoryText)
    const conventions = activeEntriesForStatus(snapshot.conventionsText)
    const decisions = activeEntriesForStatus(snapshot.decisionsText)
      .map((entry) => {
        if (entry.meta === null) return undefined
        const body = parseDecisionBody(entry.body, entry.meta.createdAt)
        return {
          id: entry.meta.id,
          createdAt: entry.meta.createdAt,
          ...body,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    const task = sessionId === undefined
      ? undefined
      : snapshot.tasks
        .filter((candidate) => candidate.sessionId === sessionId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    return renderProjectContext(
      {
        project,
        conventions: conventions.slice(-40).reverse().map((entry) => entry.content),
        decisions: decisions.slice(0, 3).map((entry) => ({
          id: entry.id,
          status: entry.status,
          decision: entry.decision,
          context: entry.context,
          consequences: entry.consequences,
        })),
        progress: snapshot.progress.slice(-5).reverse(),
        dirs: snapshot.dirs,
        tools: snapshot.tools,
        members: snapshot.workspaces.members,
        ...(task === undefined ? {} : { task }),
        archivedCounts: {
          memory: parseArchivedCount(snapshot.memoryText),
          conventions: parseArchivedCount(snapshot.conventionsText),
          decisions: parseArchivedCount(snapshot.decisionsText),
        },
      },
      this.config.contextBudgetTokens,
    )
  }

  async status(reference: string, sessionId?: string): Promise<ProjectStatus> {
    const project = await this.store.getProject(reference)
    const snapshot = await this.store.readSnapshot(project.id)
    const memory = activeEntriesForStatus(snapshot.memoryText)
      .map((entry) => ({
        id: entry.meta?.id ?? 'memory',
        content: entry.body,
        createdAt: entry.meta?.createdAt ?? nowIso(),
        updatedAt: entry.meta?.updatedAt ?? entry.meta?.createdAt ?? nowIso(),
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const conventions = activeEntriesForStatus(snapshot.conventionsText)
      .map((entry) => ({
        id: entry.meta?.id ?? 'convention',
        content: entry.body,
        createdAt: entry.meta?.createdAt ?? nowIso(),
        updatedAt: entry.meta?.updatedAt ?? entry.meta?.createdAt ?? nowIso(),
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const decisions = activeEntriesForStatus(snapshot.decisionsText)
      .map((entry) => {
        if (entry.meta === null) return undefined
        const body = parseDecisionBody(entry.body, entry.meta.createdAt)
        return {
          id: entry.meta.id,
          date: body.date,
          status: body.status as DecisionStatus,
          title: body.title,
          context: body.context,
          decision: body.decision,
          consequences: body.consequences,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
      .sort((left, right) => right.date.localeCompare(left.date))
    const progress = [...snapshot.progress].sort((left, right) => right.ts.localeCompare(left.ts))
    const tasks = [...snapshot.tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const context = await this.context(project.id, sessionId)
    return {
      project: await this.store.summarize(project),
      memory,
      conventions,
      decisions,
      progress,
      dirs: snapshot.dirs,
      tools: snapshot.tools,
      sessions: Object.entries(snapshot.sessions)
        .map(([sessionIdValue, binding]) => ({ sessionId: sessionIdValue, binding }))
        .sort((left, right) => right.binding.boundAt.localeCompare(left.binding.boundAt)),
      tasks,
      members: snapshot.workspaces.members,
      estimatedContextTokens: context.estimatedTokens,
      contextBudgetTokens: this.config.contextBudgetTokens,
    }
  }

  async note(input: ProjectNoteInput, sessionId: string): Promise<ProjectNoteResult> {
    const project = await this.resolveProject(input.project, sessionId)
    if (project.archived) throw new ProjectError('PROJECT_ARCHIVED', `Project ${project.name} is archived.`)
    const category = noteCategory(input.category)
    const actor = sessionId || input.actor || 'unknown'
    if (category.target === 'memory') {
      const result = await this.store.writeMemory(project.id, input.content ?? '', actor)
      return {
        projectId: project.id,
        category: input.category,
        entryId: result.entryId,
        deduped: result.deduped,
        archived: result.archived,
        summary: await this.summaryLine(project),
      }
    }
    if (category.target === 'convention') {
      const result = await this.store.writeConvention(project.id, input.content ?? '', actor)
      return {
        projectId: project.id,
        category: input.category,
        entryId: result.entryId,
        deduped: result.deduped,
        archived: result.archived,
        summary: await this.summaryLine(project),
      }
    }
    if (category.target === 'decision') {
      const result = await this.store.writeDecision(project.id, {
        ...(input.title === undefined ? {} : { title: input.title }),
        context: input.context ?? '',
        decision: input.content ?? '',
        consequences: input.consequences ?? '',
        ...(input.status === undefined ? {} : { status: input.status }),
        sourceSessionId: actor,
      })
      return {
        projectId: project.id,
        category: input.category,
        entryId: result.entryId,
        deduped: result.deduped,
        archived: result.archived,
        summary: await this.summaryLine(project),
      }
    }
    if (category.target === 'progress') {
      if ((input.stage ?? '').trim() === '' || (input.next ?? '').trim() === '') {
        throw new ProjectError('INVALID_ARGUMENT', 'Progress requires stage and next.')
      }
      const result = await this.store.writeProgress(project.id, {
        sessionId: actor,
        stage: input.stage ?? '',
        did: input.content ?? '',
        next: input.next ?? '',
        ...(input.blocked === undefined ? {} : { blocked: input.blocked }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
      })
      return {
        projectId: project.id,
        category: input.category,
        deduped: result.deduped,
        archived: result.archived,
        summary: await this.summaryLine(project),
      }
    }
    if (category.target === 'dir') {
      const path = input.path ?? input.content ?? ''
      if (path.trim() === '') throw new ProjectError('INVALID_ARGUMENT', `${input.category} requires a path.`)
      if (!path.startsWith('/')) throw new ProjectError('INVALID_ARGUMENT', `${input.category} requires an absolute path.`)
      const result = await this.store.writeDirRef(project.id, {
        kind: category.refKind === 'file' ? 'file' : 'dir',
        path,
        purpose: input.purpose ?? input.content ?? '',
        ...(input.note === undefined ? {} : { note: input.note }),
        addedBy: actor,
      })
      return {
        projectId: project.id,
        category: input.category,
        deduped: result.deduped,
        archived: result.archived,
        summary: await this.summaryLine(project),
      }
    }
    const tool = input.tool ?? input.content ?? ''
    if (tool.trim() === '') throw new ProjectError('INVALID_ARGUMENT', `${input.category} requires a tool/plugin/mcp name.`)
    const result = await this.store.writeToolRef(project.id, {
      kind: category.refKind === 'plugin' ? 'plugin' : category.refKind === 'mcp' ? 'mcp' : 'tool',
      tool,
      ...(input.args === undefined ? {} : { args: input.args }),
      purpose: input.purpose ?? input.content ?? '',
      ...(input.note === undefined ? {} : { note: input.note }),
      addedBy: actor,
    })
    return {
      projectId: project.id,
      category: input.category,
      deduped: result.deduped,
      archived: result.archived,
      summary: await this.summaryLine(project),
    }
  }

  async ref(input: ProjectRefInput, sessionId: string): Promise<ProjectRefResult> {
    const project = await this.resolveProject(input.project, sessionId)
    if (project.archived) throw new ProjectError('PROJECT_ARCHIVED', `Project ${project.name} is archived.`)
    const actor = sessionId || input.actor || 'unknown'
    if (input.kind === 'dir' || input.kind === 'file') {
      if (input.path === undefined || input.path.trim() === '') {
        throw new ProjectError('INVALID_ARGUMENT', `${input.kind} reference requires an absolute path.`)
      }
      if (!input.path.startsWith('/')) throw new ProjectError('INVALID_ARGUMENT', `${input.kind} reference requires an absolute path.`)
      const result = await this.store.writeDirRef(project.id, {
        kind: input.kind,
        path: input.path,
        purpose: input.purpose,
        ...(input.note === undefined ? {} : { note: input.note }),
        addedBy: actor,
      })
      return {
        projectId: project.id,
        kind: input.kind,
        entry: result.entry,
        deduped: result.deduped,
        archived: result.archived,
      }
    }
    if (input.tool === undefined || input.tool.trim() === '') {
      throw new ProjectError('INVALID_ARGUMENT', `${input.kind} reference requires a tool/plugin/mcp name.`)
    }
    const result = await this.store.writeToolRef(project.id, {
      kind: input.kind,
      tool: input.tool,
      ...(input.args === undefined ? {} : { args: input.args }),
      purpose: input.purpose,
      ...(input.note === undefined ? {} : { note: input.note }),
      addedBy: actor,
    })
    return {
      projectId: project.id,
      kind: input.kind,
      entry: result.entry,
      deduped: result.deduped,
      archived: result.archived,
    }
  }

  async insert(input: ProjectInsertInput): Promise<ProjectInsertResult> {
    const project = await this.store.getProject(input.project)
    const result = await this.store.insertWorkspaceMember(project.id, {
      kind: input.kind,
      ...(input.path === undefined ? {} : { path: input.path }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      ...(input.targetProjectId === undefined ? {} : { projectId: input.targetProjectId }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.note === undefined ? {} : { note: input.note }),
      addedBy: input.actor ?? 'ui',
    })
    return { projectId: project.id, member: result.member, deduped: result.deduped }
  }

  async removeMember(projectRef: string, memberId: string): Promise<boolean> {
    const project = await this.store.getProject(projectRef)
    return this.store.removeWorkspaceMember(project.id, memberId)
  }

  async fork(input: ProjectForkInput): Promise<ProjectForkResult> {
    const source = await this.store.getProject(input.project)
    const project = await this.store.forkProject(source.id, {
      name: input.name ?? `${source.name} fork`,
      ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
    })
    if (input.bindSessionId !== undefined && input.bindSessionId !== '') {
      await this.bind(input.bindSessionId, project, `forked from ${source.id}`)
    }
    return { sourceProjectId: source.id, project: await this.store.summarize(project) }
  }

  async merge(input: ProjectMergeInput): Promise<ProjectMergeResult> {
    const source = await this.store.getProject(input.source)
    const target = await this.store.getProject(input.target)
    if (source.id === target.id) throw new ProjectError('INVALID_ARGUMENT', 'A project cannot be merged into itself.')
    const result = await this.store.mergeProjects(source.id, target.id, {
      ...(input.deleteSource === undefined ? {} : { deleteSource: input.deleteSource }),
      ...(input.purgeSource === undefined ? {} : { purgeSource: input.purgeSource }),
    })
    const merged = await this.store.summarize(await this.store.readProject(target.id))
    return {
      sourceProjectId: source.id,
      targetProjectId: target.id,
      sourceRetained: result.sourceRetained,
      merged: merged.counts,
    }
  }

  async delete(input: ProjectDeleteInput): Promise<ProjectDeleteResult> {
    const project = await this.store.getProject(input.project)
    const mode = input.mode ?? 'trash'
    const result = await this.store.deleteProject(project.id, mode)
    return { projectId: project.id, mode, ...(result.trashPath === undefined ? {} : { trashPath: result.trashPath }) }
  }

  async archive(projectRef: string, archived: boolean): Promise<ProjectSummary> {
    const project = await this.store.getProject(projectRef)
    return this.store.summarize(await this.store.setArchived(project.id, archived))
  }

  async task(input: ProjectTaskInput, agent?: AgentLike): Promise<ProjectTaskResult> {
    const sessionId = input.sessionId ?? agent?.session.id ?? input.actor
    if (sessionId === undefined || sessionId.trim() === '') {
      throw new ProjectError('SESSION_REQUIRED', 'Task operations require a session id or a live agent.')
    }
    const project = await this.resolveProject(input.project, sessionId)
    const tasks = await this.store.readTasks(project.id)
    if (input.action === 'list') {
      const own = tasks
        .filter((candidate) => candidate.sessionId === sessionId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      return { projectId: project.id, task: own[0] ?? emptyTask(project.id, sessionId), tasks }
    }
    let task = tasks
      .filter((candidate) => candidate.sessionId === sessionId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    if (task === undefined) {
      task = {
        id: newTaskId(),
        projectId: project.id,
        sessionId,
        title: input.title ?? '',
        status: 'queued',
        source: 'user',
        priority: 100,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        checkpoint: emptyCheckpoint(),
        tags: [],
      }
    }
    if (input.action === 'checkpoint' || input.action === 'interrupt' || input.action === 'blocked') {
      task.checkpoint = this.checkpointFor(agent, task.checkpoint)
      if (input.summary !== undefined) task.checkpoint.summary = cleanInline(input.summary, 500)
      if (input.next !== undefined) task.checkpoint.next = cleanInline(input.next, 500)
      if (input.blocked !== undefined) task.checkpoint.blocked = cleanInline(input.blocked, 500)
      task.checkpoint.updatedAt = nowIso()
      task.updatedAt = nowIso()
      if (task.title === '' && input.title !== undefined) task.title = cleanInline(input.title, 160)
      if (input.action === 'interrupt') {
        task.status = 'interrupted'
        task.source = 'system'
        if (input.prompt !== undefined && input.prompt.trim() !== '') {
          task.pendingPrompt = cleanInline(input.prompt, 2_000)
          task.pendingPromptAddedAt = nowIso()
        }
      } else if (input.action === 'blocked') {
        task.status = 'blocked'
      } else {
        if (task.status !== 'interrupted' && task.status !== 'done' && task.status !== 'blocked') {
          task.status = agent === undefined ? task.status : 'running'
        }
      }
      if (input.tags !== undefined) task.tags = input.tags.map((tag) => cleanInline(tag, 40)).filter(Boolean)
    } else if (input.action === 'resume') {
      task.status = 'running'
      task.updatedAt = nowIso()
      task.startedAt ??= nowIso()
    } else if (input.action === 'done') {
      task.status = 'done'
      task.finishedAt = nowIso()
      task.updatedAt = nowIso()
      if (input.summary !== undefined) task.checkpoint.did = cleanInline(input.summary, 500)
      if (input.next !== undefined) task.checkpoint.next = cleanInline(input.next, 500)
    }
    await this.store.writeTask(project.id, task)
    if (input.action === 'interrupt') {
      agent?.cancel?.({ kind: 'hook', reason: 'projectflow:system-inject' }, { keepInbox: true })
    }
    const nextTasks = await this.store.readTasks(project.id)
    return { projectId: project.id, task, tasks: nextTasks }
  }

  private checkpointFor(agent: AgentLike | undefined, previous: TaskCheckpoint): TaskCheckpoint {
    if (agent === undefined) return previous
    const events = (agent.session.snapshotEvents?.() ?? []) as Array<Record<string, unknown>>
    let lastUser = ''
    let lastAssistant = ''
    let lastTool = ''
    const pending = new Map<string, string>()
    let turn = previous.turn
    let step = previous.step
    for (const event of events) {
      const type = event.type
      const data = event.data
      if (typeof data !== 'object' || data === null) continue
      const record = data as Record<string, unknown>
      if (type === 'user/message') {
        const message = record.message as Record<string, unknown> | undefined
        const content = message?.content
        if (Array.isArray(content)) {
          lastUser = content
            .filter((block): block is { type: string; text: string } =>
              typeof block === 'object' && block !== null &&
              (block as Record<string, unknown>).type === 'text' &&
              typeof (block as Record<string, unknown>).text === 'string',
            )
            .map((block) => block.text)
            .join('\n')
        }
      } else if (type === 'assistant/message') {
        const message = record.message as Record<string, unknown> | undefined
        const content = message?.content
        if (Array.isArray(content)) {
          lastAssistant = content
            .filter((block): block is { type: string; text: string } =>
              typeof block === 'object' && block !== null &&
              (block as Record<string, unknown>).type === 'text' &&
              typeof (block as Record<string, unknown>).text === 'string',
            )
            .map((block) => block.text)
            .join('\n')
        }
      } else if (type === 'tool/call') {
        const callId = typeof record.callId === 'string' ? record.callId : ''
        const name = typeof record.name === 'string' ? record.name : ''
        if (callId !== '') pending.set(callId, name)
        lastTool = name
      } else if (type === 'tool/result') {
        const callId = typeof record.callId === 'string' ? record.callId : ''
        pending.delete(callId)
      } else if (type === 'turn/start') {
        turn = typeof record.turn === 'number' ? record.turn : turn + 1
      } else if (type === 'step/start') {
        step = typeof record.step === 'number' ? record.step : step + 1
      }
    }
    return {
      ...previous,
      summary: oneLine(lastAssistant || lastUser || previous.summary, 500),
      did: oneLine(lastAssistant || previous.did, 500),
      next: previous.next,
      blocked: previous.blocked,
      lastTool,
      pendingTools: [...pending.values()],
      turn,
      step,
      updatedAt: nowIso(),
    }
  }

  private async resolveProject(reference: string | undefined, sessionId: string): Promise<ProjectDocument> {
    if (reference !== undefined && reference.trim() !== '') return this.store.getProject(reference)
    const binding = await this.store.findBinding(sessionId)
    if (binding === undefined) {
      throw new ProjectError(
        'NOT_BOUND',
        'This session is not bound to a project.',
        'Run /project use <name> or call project_use.',
      )
    }
    return this.store.readProject(binding.projectId)
  }

  private async summaryLine(project: ProjectDocument): Promise<string> {
    const summary = await this.store.summarize(project)
    return `${summary.name} (${summary.id}) — ${summary.counts.conventions} conventions, ${summary.counts.decisions} decisions, ${summary.counts.progress} progress`
  }
}

function emptyTask(projectId: string, sessionId: string): TaskRecord {
  return {
    id: newTaskId(),
    projectId,
    sessionId,
    title: '',
    status: 'queued',
    source: 'user',
    priority: 100,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    checkpoint: emptyCheckpoint(),
    tags: [],
  }
}

function parseArchivedCount(text: string): number {
  return (text.match(/<!--\s*pf-(?:entry|decision)\s+[^>]*archived=/gu) ?? []).length
}

// Re-exported for the status renderer and tests without leaking store internals.
export { activeEntriesForStatus }
