import { z } from 'zod'
import type { ProjectFlowConfig } from '../config.js'
import { ProjectError } from '../errors.js'
import type { ProjectService } from '../domain/project-service.js'
import type {
  DecisionStatus,
  NoteCategory,
  ProjectStatus,
  RefKind,
} from '../shared/contracts.js'
import type {
  DshContentBlock,
  DshContext,
  DshToolDefinition,
  DshToolExecution,
} from './contracts.js'

const TEXT_OUTPUT = {
  type: 'object',
  additionalProperties: true,
} as const

function text(value: unknown): DshContentBlock[] {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return [{ type: 'text', text: body }]
}

function json(value: unknown): DshContentBlock[] {
  return text(value)
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`)
    .join('; ')
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ProjectError('INVALID_ARGUMENT', `Invalid arguments: ${formatIssues(result.error)}`)
  }
  return result.data
}

function requireAgent(exec: DshToolExecution) {
  if (exec.agent === undefined) {
    throw new ProjectError('AGENT_REQUIRED', 'This operation requires a live DSH session.')
  }
  return exec.agent
}

function bindAgent(sessionId: string, project: string, note?: string) {
  return { sessionId, project, ...(note === undefined ? {} : { note }) }
}

function projectRefSchema() {
  return z.object({
    project: z.string().min(1).optional(),
  })
}

function renderStatus(status: ProjectStatus): string {
  const latest = status.progress[0]
  const lines = [
    `Project: ${status.project.name} (${status.project.id})`,
    `Primary workspace: ${status.project.primaryPath}`,
    `Updated: ${status.project.updatedAt}`,
    `Counts: ${status.project.counts.conventions} conventions, ${status.project.counts.decisions} decisions, ${status.project.counts.progress} progress, ${status.project.counts.memory} memory, ${status.project.counts.dirs} directory/file refs, ${status.project.counts.tools} tool/plugin/mcp refs`,
    `Workspace members: ${status.members.length}`,
    `Context: ~${status.estimatedContextTokens}/${status.contextBudgetTokens} tokens`,
  ]
  if (latest !== undefined) {
    lines.push(
      '',
      'Latest progress:',
      `  [${latest.stage}] did: ${latest.did}`,
      `  next: ${latest.next}`,
      ...(latest.blocked === undefined ? [] : [`  blocked: ${latest.blocked}`]),
    )
  }
  if (status.conventions.length > 0) {
    lines.push('', 'Conventions:')
    for (const convention of status.conventions.slice(0, 10)) lines.push(`- ${convention.content}`)
  }
  if (status.decisions.length > 0) {
    lines.push('', 'Recent decisions:')
    for (const decision of status.decisions.slice(0, 3)) {
      lines.push(`- ${decision.id} [${decision.status}] ${decision.decision}`)
    }
  }
  if (status.progress.length > 0) {
    lines.push('', 'Progress:')
    for (const entry of status.progress.slice(0, 10)) {
      lines.push(`- ${entry.ts.slice(0, 10)} [${entry.stage}] ${entry.did} | next: ${entry.next}${entry.blocked === undefined ? '' : ` | blocked: ${entry.blocked}`}`)
    }
  }
  if (status.dirs.length > 0) {
    lines.push('', 'Directory/file refs:')
    for (const ref of status.dirs) lines.push(`- ${ref.kind}: ${ref.path} — ${ref.purpose}`)
  }
  if (status.tools.length > 0) {
    lines.push('', 'Tool/plugin/MCP refs:')
    for (const ref of status.tools) lines.push(`- ${ref.kind}: ${ref.tool} — ${ref.purpose}`)
  }
  if (status.sessions.length > 0) {
    lines.push('', 'Bound sessions:')
    for (const session of status.sessions.slice(0, 20)) lines.push(`- ${session.sessionId} (${session.binding.boundAt})`)
  }
  if (status.tasks.length > 0) {
    lines.push('', 'Tasks:')
    for (const task of status.tasks.slice(0, 10)) lines.push(`- ${task.id} [${task.status}] ${task.title}`)
  }
  if (status.members.length > 0) {
    lines.push('', 'Workspace members:')
    for (const member of status.members) lines.push(`- ${member.kind}: ${member.label}`)
  }
  return lines.join('\n')
}

function renderList(value: { projects: Array<{ id: string; name: string; primaryPath: string; aliases: string[]; archived: boolean }>; invalid: unknown[] }): string {
  const lines = [`Projects (${value.projects.length}):`]
  for (const project of value.projects) {
    lines.push(`- ${project.name} (${project.id})${project.archived ? ' [archived]' : ''} — ${project.primaryPath}`)
    if (project.aliases.length > 0) lines.push(`  aliases: ${project.aliases.join(', ')}`)
  }
  if (value.invalid.length > 0) lines.push(`Skipped ${value.invalid.length} unreadable project(s).`)
  return lines.join('\n')
}

export function registerProjectTools(
  ctx: DshContext,
  service: ProjectService,
  config: ProjectFlowConfig,
): void {
  const createSchema = z.object({
    name: z.string().min(1),
    aliases: z.array(z.string()).optional(),
    primaryPath: z.string().min(1).optional(),
    bind: z.boolean().optional(),
  })
  const useSchema = z.object({
    project: z.string().min(1),
    note: z.string().optional(),
  })
  const noteSchema = z.object({
    project: z.string().min(1).optional(),
    category: z.enum([
      'fact', 'convention', 'decision', 'progress',
      'ref-dir', 'ref-file', 'ref-tool', 'ref-plugin', 'ref-mcp',
    ]),
    content: z.string().optional(),
    title: z.string().optional(),
    stage: z.string().optional(),
    next: z.string().optional(),
    blocked: z.string().optional(),
    tags: z.array(z.string()).optional(),
    context: z.string().optional(),
    consequences: z.string().optional(),
    status: z.enum(['proposed', 'accepted', 'superseded', 'deprecated']).optional(),
    path: z.string().optional(),
    tool: z.string().optional(),
    args: z.array(z.string()).optional(),
    purpose: z.string().optional(),
    note: z.string().optional(),
  })
  const refSchema = z.object({
    project: z.string().min(1).optional(),
    kind: z.enum(['dir', 'file', 'tool', 'plugin', 'mcp']),
    path: z.string().optional(),
    tool: z.string().optional(),
    args: z.array(z.string()).optional(),
    purpose: z.string().min(1),
    note: z.string().optional(),
  })
  const statusSchema = z.object({
    project: z.string().min(1).optional(),
    sections: z.array(z.enum([
      'overview', 'memory', 'conventions', 'decisions', 'progress',
      'refs', 'sessions', 'tasks', 'members',
    ])).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    stage: z.string().min(1).optional(),
    tag: z.string().min(1).optional(),
    since: z.string().min(1).optional(),
    blockedOnly: z.boolean().optional(),
  })
  const workspaceSchema = z.object({
    action: z.enum(['insert', 'remove-member', 'fork', 'merge', 'delete', 'archive', 'unarchive']),
    project: z.string().min(1).optional(),
    memberId: z.string().min(1).optional(),
    kind: z.enum(['directory', 'session', 'project']).optional(),
    path: z.string().optional(),
    sessionId: z.string().optional(),
    targetProjectId: z.string().optional(),
    label: z.string().optional(),
    note: z.string().optional(),
    name: z.string().optional(),
    source: z.string().optional(),
    target: z.string().optional(),
    deleteSource: z.boolean().optional(),
    purgeSource: z.boolean().optional(),
    mode: z.enum(['trash', 'purge']).optional(),
  })
  const taskSchema = z.object({
    project: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    action: z.enum(['list', 'checkpoint', 'interrupt', 'resume', 'done', 'blocked']),
    title: z.string().optional(),
    prompt: z.string().optional(),
    summary: z.string().optional(),
    next: z.string().optional(),
    blocked: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })

  const register = (definition: DshToolDefinition): void => {
    ctx.tools.register(definition)
  }

  register({
    name: 'project_create',
    description: 'Create a project workspace with a stable id, aliases, and a primary directory. The current session becomes bound by default. Repeating the same name is idempotent.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name; unique across projects.' },
        aliases: { type: 'array', items: { type: 'string' }, description: 'Optional lookup aliases.' },
        primaryPath: { type: 'string', description: 'Absolute primary workspace directory. Defaults to the session cwd.' },
        bind: { type: 'boolean', description: 'Bind this session (default true).' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => json(value) },
    execute: async (raw, exec) => {
      const args = parse(createSchema, raw)
      const agent = requireAgent(exec)
      const primaryPath = args.primaryPath ?? agent.session.header.cwd
      if (primaryPath === undefined) {
        throw new ProjectError('INVALID_ARGUMENT', 'primaryPath is required when the session has no cwd.')
      }
      const result = await service.create({
        name: args.name,
        ...(args.aliases === undefined ? {} : { aliases: args.aliases }),
        primaryPath,
        ...(args.bind === false ? {} : { bindSessionId: agent.id }),
      })
      return { ...result, contextBudgetTokens: config.contextBudgetTokens }
    },
  })

  register({
    name: 'project_list',
    description: 'List project workspaces, their stable ids, aliases, primary directories, and record counts.',
    parameters: {
      type: 'object',
      properties: {
        includeArchived: { type: 'boolean', description: 'Include archived projects.' },
      },
      additionalProperties: false,
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => text(renderList(value as Parameters<typeof renderList>[0])) },
    isConcurrencySafe: () => true,
    execute: async (raw) => {
      const args = parse(z.object({ includeArchived: z.boolean().optional() }), raw)
      return service.list(args.includeArchived === true)
    },
  })

  register({
    name: 'project_use',
    description: 'Bind the current DSH session to a project by id, name, or alias. The project summary is injected into the system prompt from the next model step.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, name, or alias.' },
        note: { type: 'string', description: 'Optional binding note.' },
      },
      required: ['project'],
      additionalProperties: false,
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => json(value) },
    execute: async (raw, exec) => {
      const args = parse(useSchema, raw)
      const agent = requireAgent(exec)
      return bindAgentUse(service, agent.id, args.project, args.note)
    },
  })

  register({
    name: 'project_note',
    description: 'Record a project fact, convention, decision, progress checkpoint, or reference. References store only the item metadata, never copied files or tool code.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Defaults to the session-bound project.' },
        category: {
          type: 'string',
          enum: ['fact', 'convention', 'decision', 'progress', 'ref-dir', 'ref-file', 'ref-tool', 'ref-plugin', 'ref-mcp'],
        },
        content: { type: 'string', description: 'Fact/convention text, decision statement, progress did, or reference target fallback.' },
        title: { type: 'string' },
        stage: { type: 'string', description: 'Progress stage.' },
        next: { type: 'string', description: 'Progress next action.' },
        blocked: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        context: { type: 'string', description: 'Decision context.' },
        consequences: { type: 'string', description: 'Decision consequences.' },
        status: { type: 'string', enum: ['proposed', 'accepted', 'superseded', 'deprecated'] },
        path: { type: 'string', description: 'Absolute directory or file path for ref-dir/ref-file.' },
        tool: { type: 'string', description: 'Tool, plugin, or MCP name for ref-tool/ref-plugin/ref-mcp.' },
        args: { type: 'array', items: { type: 'string' } },
        purpose: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['category'],
      additionalProperties: false,
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => json(value) },
    execute: async (raw, exec) => {
      const args = parse(noteSchema, raw)
      const agent = requireAgent(exec)
      return service.note(
        {
          ...(args.project === undefined ? {} : { project: args.project }),
          category: args.category as NoteCategory,
          ...(args.content === undefined ? {} : { content: args.content }),
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.stage === undefined ? {} : { stage: args.stage }),
          ...(args.next === undefined ? {} : { next: args.next }),
          ...(args.blocked === undefined ? {} : { blocked: args.blocked }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
          ...(args.context === undefined ? {} : { context: args.context }),
          ...(args.consequences === undefined ? {} : { consequences: args.consequences }),
          ...(args.status === undefined ? {} : { status: args.status as DecisionStatus }),
          ...(args.path === undefined ? {} : { path: args.path }),
          ...(args.tool === undefined ? {} : { tool: args.tool }),
          ...(args.args === undefined ? {} : { args: args.args }),
          ...(args.purpose === undefined ? {} : { purpose: args.purpose }),
          ...(args.note === undefined ? {} : { note: args.note }),
        },
        agent.id,
      )
    },
  })

  register({
    name: 'project_ref',
    description: 'Add a directory/file reference or a tool/plugin/MCP reference. Only metadata is stored; the referenced content is never copied into the project.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        kind: { type: 'string', enum: ['dir', 'file', 'tool', 'plugin', 'mcp'] },
        path: { type: 'string' },
        tool: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        purpose: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['kind', 'purpose'],
      additionalProperties: false,
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => json(value) },
    execute: async (raw, exec) => {
      const args = parse(refSchema, raw)
      const agent = requireAgent(exec)
      return service.ref(
        {
          ...(args.project === undefined ? {} : { project: args.project }),
          kind: args.kind as RefKind,
          ...(args.path === undefined ? {} : { path: args.path }),
          ...(args.tool === undefined ? {} : { tool: args.tool }),
          ...(args.args === undefined ? {} : { args: args.args }),
          purpose: args.purpose,
          ...(args.note === undefined ? {} : { note: args.note }),
        },
        agent.id,
      )
    },
  })

  register({
    name: 'project_status',
    description: 'Return a filterable project summary: overview, memory, conventions, decisions, progress, references, bound sessions, tasks, and workspace members.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        sections: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        stage: { type: 'string' },
        tag: { type: 'string' },
        since: { type: 'string' },
        blockedOnly: { type: 'boolean' },
      },
      additionalProperties: false,
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => text(renderStatus(value as ProjectStatus)) },
    isConcurrencySafe: () => true,
    execute: async (raw, exec) => {
      const args = parse(statusSchema, raw)
      const agent = requireAgent(exec)
      const project = args.project ?? await bindingReference(service, agent.id)
      const status = await service.status(project, agent.id)
      return filterStatus(status, args)
    },
  })

  register({
    name: 'project_workspace',
    description: 'Manage project workspaces: insert a directory/session/project member, remove a member, fork, merge (optionally deleting the source), delete to trash or purge, archive, or unarchive.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['insert', 'remove-member', 'fork', 'merge', 'delete', 'archive', 'unarchive'] },
        project: { type: 'string' },
        memberId: { type: 'string' },
        kind: { type: 'string', enum: ['directory', 'session', 'project'] },
        path: { type: 'string' },
        sessionId: { type: 'string' },
        targetProjectId: { type: 'string' },
        label: { type: 'string' },
        note: { type: 'string' },
        name: { type: 'string' },
        source: { type: 'string' },
        target: { type: 'string' },
        deleteSource: { type: 'boolean' },
        purgeSource: { type: 'boolean' },
        mode: { type: 'string', enum: ['trash', 'purge'] },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => json(value) },
    execute: async (raw, exec) => {
      const args = parse(workspaceSchema, raw)
      const agent = requireAgent(exec)
      switch (args.action) {
        case 'insert': {
          const project = args.project ?? await bindingReference(service, agent.id)
          if (args.kind === undefined) throw new ProjectError('INVALID_ARGUMENT', 'insert requires kind.')
          return service.insert({
            project,
            kind: args.kind,
            ...(args.path === undefined ? {} : { path: args.path }),
            ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
            ...(args.targetProjectId === undefined ? {} : { targetProjectId: args.targetProjectId }),
            ...(args.label === undefined ? {} : { label: args.label }),
            ...(args.note === undefined ? {} : { note: args.note }),
            actor: agent.id,
          })
        }
        case 'remove-member': {
          const project = args.project ?? await bindingReference(service, agent.id)
          if (args.memberId === undefined) throw new ProjectError('INVALID_ARGUMENT', 'remove-member requires memberId.')
          return { removed: await service.removeMember(project, args.memberId) }
        }
        case 'fork': {
          const project = args.project ?? await bindingReference(service, agent.id)
          return service.fork({
            project,
            ...(args.name === undefined ? {} : { name: args.name }),
            bindSessionId: agent.id,
          })
        }
        case 'merge': {
          if (args.source === undefined || args.target === undefined) {
            throw new ProjectError('INVALID_ARGUMENT', 'merge requires source and target.')
          }
          return service.merge({
            source: args.source,
            target: args.target,
            ...(args.deleteSource === undefined ? {} : { deleteSource: args.deleteSource }),
            ...(args.purgeSource === undefined ? {} : { purgeSource: args.purgeSource }),
          })
        }
        case 'delete': {
          const project = args.project ?? await bindingReference(service, agent.id)
          return service.delete({
            project,
            ...(args.mode === undefined ? {} : { mode: args.mode }),
          })
        }
        case 'archive':
        case 'unarchive': {
          const project = args.project ?? await bindingReference(service, agent.id)
          return service.archive(project, args.action === 'archive')
        }
      }
    },
  })

  register({
    name: 'project_task',
    description: 'Track the current task like an OS task record. checkpoint snapshots the session; interrupt saves the checkpoint, stores a system prompt, and cooperatively cancels the active turn; resume/done/blocked update its state.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        sessionId: { type: 'string' },
        action: { type: 'string', enum: ['list', 'checkpoint', 'interrupt', 'resume', 'done', 'blocked'] },
        title: { type: 'string' },
        prompt: { type: 'string' },
        summary: { type: 'string' },
        next: { type: 'string' },
        blocked: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: { schema: TEXT_OUTPUT, render: (_args, value) => json(value) },
    execute: async (raw, exec) => {
      const args = parse(taskSchema, raw)
      const agent = requireAgent(exec)
      return service.task(
        {
          ...(args.project === undefined ? {} : { project: args.project }),
          ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
          action: args.action,
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.next === undefined ? {} : { next: args.next }),
          ...(args.blocked === undefined ? {} : { blocked: args.blocked }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
        },
        agent,
      )
    },
  })
}

async function bindAgentUse(
  service: ProjectService,
  sessionId: string,
  project: string,
  note?: string,
) {
  return service.use(sessionId, project, note)
}

async function bindingReference(service: ProjectService, sessionId: string): Promise<string> {
  const binding = await service.bindingForSession(sessionId)
  if (binding === undefined) {
    throw new ProjectError(
      'NOT_BOUND',
      'This session is not bound to a project.',
      'Pass a project argument or run /project use <name>.',
    )
  }
  return binding.projectId
}

export function filterStatus(
  status: ProjectStatus,
  args: {
    sections?: string[] | undefined
    limit?: number | undefined
    stage?: string | undefined
    tag?: string | undefined
    since?: string | undefined
    blockedOnly?: boolean | undefined
  },
): ProjectStatus {
  const limit = args.limit ?? 20
  const sections = args.sections === undefined ? undefined : new Set(args.sections)
  const include = (name: string): boolean => sections === undefined || sections.has(name)
  const since = args.since === undefined ? undefined : Date.parse(args.since)
  return {
    ...status,
    memory: include('memory') ? status.memory.slice(0, limit) : [],
    conventions: include('conventions') ? status.conventions.slice(0, limit) : [],
    decisions: include('decisions') ? status.decisions.slice(0, limit) : [],
    progress: include('progress')
      ? status.progress
        .filter((entry) => args.stage === undefined || entry.stage === args.stage)
        .filter((entry) => args.tag === undefined || entry.tags.includes(args.tag))
        .filter((entry) => since === undefined || !Number.isNaN(since) && Date.parse(entry.ts) >= since)
        .filter((entry) => args.blockedOnly !== true || (entry.blocked !== undefined && entry.blocked !== ''))
        .slice(0, limit)
      : [],
    dirs: include('refs') ? status.dirs.slice(0, limit) : [],
    tools: include('refs') ? status.tools.slice(0, limit) : [],
    sessions: include('sessions') ? status.sessions.slice(0, limit) : [],
    tasks: include('tasks') ? status.tasks.slice(0, limit) : [],
    members: include('members') ? status.members.slice(0, limit) : [],
    project: status.project,
  }
}
