import type { ProjectService } from '../domain/project-service.js'
import { errorMessage, ProjectError } from '../errors.js'
import type {
  DecisionStatus,
  NoteCategory,
  ProjectStatus,
  RefKind,
} from '../shared/contracts.js'
import { oneLine } from '../util/text.js'
import type { DshCommandInvocation, DshCommandResult, DshContext } from './contracts.js'
import { filterStatus } from './tools.js'

interface ParsedLine {
  positionals: string[]
  flags: Map<string, string[]>
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  for (const character of input) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\' && quote !== undefined) {
      escaped = true
      continue
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else current += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (/\s/u.test(character)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += character
  }
  if (current !== '') tokens.push(current)
  return tokens
}

export function parseCommandLine(input: string): ParsedLine {
  const tokens = tokenize(input)
  const positionals: string[] = []
  const flags = new Map<string, string[]>()
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue
    if (!token.startsWith('--') || token === '--') {
      positionals.push(token)
      continue
    }
    const body = token.slice(2)
    const equal = body.indexOf('=')
    if (equal >= 0) {
      const key = body.slice(0, equal)
      const value = body.slice(equal + 1)
      flags.set(key, [...(flags.get(key) ?? []), value])
      continue
    }
    const next = tokens[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(body, [...(flags.get(body) ?? []), next])
      index += 1
    } else {
      flags.set(body, [...(flags.get(body) ?? []), 'true'])
    }
  }
  return { positionals, flags }
}

function flag(parsed: ParsedLine, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1)
}

function flagAll(parsed: ParsedLine, name: string): string[] {
  return parsed.flags.get(name) ?? []
}

function booleanFlag(parsed: ParsedLine, name: string): boolean {
  return parsed.flags.has(name) && flag(parsed, name) !== 'false'
}

function success(text: string): DshCommandResult {
  return { kind: 'success', text }
}

function failure(error: unknown): DshCommandResult {
  return { kind: 'error', text: errorMessage(error) }
}

function rpcStatus(status: ProjectStatus): string {
  const latest = status.progress[0]
  const lines = [
    `Project: ${status.project.name} (${status.project.id})`,
    `Primary workspace: ${status.project.primaryPath}`,
    `Counts: ${status.project.counts.conventions} conventions, ${status.project.counts.decisions} decisions, ${status.project.counts.progress} progress, ${status.project.counts.memory} memory, ${status.project.counts.dirs} dir/file refs, ${status.project.counts.tools} tool/plugin/mcp refs`,
    `Workspace members: ${status.members.length}`,
    `Context estimate: ~${status.estimatedContextTokens}/${status.contextBudgetTokens} tokens`,
  ]
  if (latest !== undefined) {
    lines.push(
      '',
      `Latest [${latest.stage}] ${latest.ts.slice(0, 10)}`,
      `  did: ${latest.did}`,
      `  next: ${latest.next}`,
      ...(latest.blocked === undefined ? [] : [`  blocked: ${latest.blocked}`]),
    )
  }
  if (status.conventions.length > 0) {
    lines.push('', 'Conventions:')
    for (const convention of status.conventions) lines.push(`- ${convention.content}`)
  }
  if (status.decisions.length > 0) {
    lines.push('', 'Recent decisions:')
    for (const decision of status.decisions) {
      lines.push(`- ${decision.id} [${decision.status}] ${decision.decision}`)
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
  if (status.progress.length > 0) {
    lines.push('', 'Progress:')
    for (const entry of status.progress.slice(0, 10)) {
      lines.push(`- ${entry.ts.slice(0, 10)} [${entry.stage}] ${entry.did} | next: ${entry.next}${entry.blocked === undefined ? '' : ` | blocked: ${entry.blocked}`}`)
    }
  }
  if (status.sessions.length > 0) {
    lines.push('', 'Bound sessions:')
    for (const session of status.sessions.slice(0, 20)) lines.push(`- ${session.sessionId} (${session.binding.boundAt})`)
  }
  if (status.members.length > 0) {
    lines.push('', 'Workspace members:')
    for (const member of status.members) {
      lines.push(`- ${member.kind}: ${member.label} (${member.path ?? member.sessionId ?? member.projectId ?? member.id})`)
    }
  }
  if (status.tasks.length > 0) {
    lines.push('', 'Tasks:')
    for (const task of status.tasks.slice(0, 5)) {
      lines.push(`- ${task.id} [${task.status}] ${task.title || '(untitled)'}`)
    }
  }
  return lines.join('\n')
}

function usage(): string {
  return [
    'Usage:',
    '  /project list [--include-archived]',
    '  /project create <name> [--alias <alias>]... [--path <absolute dir>] [--no-bind]',
    '  /project use [<id|name|alias>] [--note <text>]',
    '  /project note <fact|convention|decision|progress|ref-dir|ref-file|ref-tool|ref-plugin|ref-mcp> <text> [flags]',
    '  /project ref <dir|file|tool|plugin|mcp> <target> --purpose <text> [--note <text>] [--args <text>]',
    '  /project status [project] [--section <name>]... [--limit N] [--stage S] [--tag T] [--since ISO] [--blocked-only]',
    '  /project log [N] [--stage S] [--tag T]',
    '  /project fork [project] [--name <name>]',
    '  /project merge <source> <target> [--delete-source] [--purge-source]',
    '  /project delete [project] [--purge]',
    '  /project insert [project] <directory|session|project> <target> [--label L] [--note N]',
    '  /project task <list|checkpoint|interrupt|resume|done|blocked> [--prompt P] [--summary S] [--next N] [--blocked B]',
    '  /project archive|unarchive [project]',
    '  /project help',
  ].join('\n')
}

async function boundReference(service: ProjectService, sessionId: string): Promise<string> {
  const binding = await service.bindingForSession(sessionId)
  if (binding === undefined) {
    throw new ProjectError(
      'NOT_BOUND',
      'This session is not bound to a project.',
      'Run /project use <name>; /project list shows available projects.',
    )
  }
  return binding.projectId
}

async function execute(
  service: ProjectService,
  invocation: DshCommandInvocation,
): Promise<DshCommandResult> {
  const parsed = parseCommandLine(invocation.rawInput)
  const [command, ...rest] = parsed.positionals
  if (command === undefined || command === 'help') return success(usage())
  const sessionId = invocation.agent.id

  switch (command) {
    case 'list': {
      const result = await service.list(booleanFlag(parsed, 'include-archived'))
      if (result.projects.length === 0) return success('No project workspaces yet. Run /project create <name>.')
      const lines = [`Projects (${result.projects.length}):`]
      for (const project of result.projects) {
        lines.push(`- ${project.name} (${project.id})${project.archived ? ' [archived]' : ''}`)
        lines.push(`  path: ${project.primaryPath}`)
        lines.push(`  aliases: ${project.aliases.length === 0 ? '(none)' : project.aliases.join(', ')}`)
        lines.push(`  records: ${project.counts.conventions} conventions, ${project.counts.decisions} decisions, ${project.counts.progress} progress, ${project.counts.members} members`)
      }
      if (result.invalid.length > 0) lines.push(`Skipped ${result.invalid.length} unreadable project(s).`)
      return success(lines.join('\n'))
    }
    case 'create': {
      const name = rest[0]
      if (name === undefined) return failure(new ProjectError('INVALID_ARGUMENT', 'Usage: /project create <name> [--alias <alias>]... [--path <dir>]'))
      const primaryPath = flag(parsed, 'path') ?? invocation.agent.session.header.cwd
      if (primaryPath === undefined) {
        return failure(new ProjectError('INVALID_ARGUMENT', 'The session has no cwd; pass --path <absolute dir>.'))
      }
      const result = await service.create({
        name,
        aliases: flagAll(parsed, 'alias'),
        primaryPath,
        ...(booleanFlag(parsed, 'no-bind') ? {} : { bindSessionId: sessionId }),
      })
      return success(
        `${result.created ? 'Created' : 'Already exists'}: ${result.project.name} (${result.project.id})\nPath: ${result.project.primaryPath}`,
      )
    }
    case 'use': {
      const reference = rest[0]
      if (reference === undefined) {
        const binding = await service.bindingForSession(sessionId)
        if (binding === undefined) return success('No project is bound to this session.')
        const project = await service.get(binding.projectId)
        return success(`Bound to ${project.name} (${project.id}) since ${binding.binding.boundAt}.`)
      }
      const result = await service.use(sessionId, reference, flag(parsed, 'note'))
      return success(
        `Bound to ${result.project.name} (${result.project.id}).\nProject context is injected into the system prompt from the next model step.`,
      )
    }
    case 'note': {
      const category = rest[0] as NoteCategory | undefined
      if (category === undefined) return failure(new ProjectError('INVALID_ARGUMENT', 'Usage: /project note <category> <text>'))
      const content = rest.slice(1).join(' ')
      const project = await boundReference(service, sessionId)
      const result = await service.note({
        project,
        category,
        ...(content === '' ? {} : { content }),
        ...(flag(parsed, 'title') === undefined ? {} : { title: flag(parsed, 'title') }),
        ...(flag(parsed, 'stage') === undefined ? {} : { stage: flag(parsed, 'stage') }),
        ...(flag(parsed, 'next') === undefined ? {} : { next: flag(parsed, 'next') }),
        ...(flag(parsed, 'blocked') === undefined ? {} : { blocked: flag(parsed, 'blocked') }),
        ...(flagAll(parsed, 'tag').length === 0 ? {} : { tags: flagAll(parsed, 'tag') }),
        ...(flag(parsed, 'context') === undefined ? {} : { context: flag(parsed, 'context') }),
        ...(flag(parsed, 'consequences') === undefined ? {} : { consequences: flag(parsed, 'consequences') }),
        ...(flag(parsed, 'status') === undefined ? {} : { status: flag(parsed, 'status') as DecisionStatus }),
        ...(flag(parsed, 'path') === undefined ? {} : { path: flag(parsed, 'path') }),
        ...(flag(parsed, 'tool') === undefined ? {} : { tool: flag(parsed, 'tool') }),
        ...(flag(parsed, 'args') === undefined ? {} : { args: tokenize(flag(parsed, 'args') ?? '') }),
        ...(flag(parsed, 'purpose') === undefined ? {} : { purpose: flag(parsed, 'purpose') }),
        ...(flag(parsed, 'note') === undefined ? {} : { note: flag(parsed, 'note') }),
      }, sessionId)
      return success(
        `${result.deduped ? 'Already recorded' : 'Recorded'} ${result.category}${result.entryId === undefined ? '' : ` ${result.entryId}`}.\n${result.summary}`,
      )
    }
    case 'ref': {
      const kind = rest[0] as RefKind | undefined
      const target = rest[1]
      if (kind === undefined || target === undefined) {
        return failure(new ProjectError('INVALID_ARGUMENT', 'Usage: /project ref <dir|file|tool|plugin|mcp> <target> --purpose <text>'))
      }
      const purpose = flag(parsed, 'purpose')
      if (purpose === undefined) return failure(new ProjectError('INVALID_ARGUMENT', 'ref requires --purpose <text>.'))
      const project = await boundReference(service, sessionId)
      const result = await service.ref({
        project,
        kind,
        ...(kind === 'dir' || kind === 'file' ? { path: target } : { tool: target }),
        purpose,
        ...(flag(parsed, 'note') === undefined ? {} : { note: flag(parsed, 'note') }),
        ...(flag(parsed, 'args') === undefined ? {} : { args: tokenize(flag(parsed, 'args') ?? '') }),
      }, sessionId)
      return success(
        `${result.deduped ? 'Updated' : 'Added'} ${result.kind} reference. Project now has ${result.archived === 0 ? '' : `${result.archived} archived, `}the reference is recorded.`,
      )
    }
    case 'status': {
      const reference = rest[0] ?? await boundReference(service, sessionId)
      const status = await service.status(reference, sessionId)
      const filtered = filterStatus(status, {
        sections: flagAll(parsed, 'section').length === 0 ? undefined : flagAll(parsed, 'section'),
        limit: flag(parsed, 'limit') === undefined ? undefined : Number(flag(parsed, 'limit')),
        stage: flag(parsed, 'stage'),
        tag: flag(parsed, 'tag'),
        since: flag(parsed, 'since'),
        blockedOnly: booleanFlag(parsed, 'blocked-only'),
      })
      return success(rpcStatus(filtered))
    }
    case 'log': {
      const reference = await boundReference(service, sessionId)
      const status = await service.status(reference, sessionId)
      const limit = Math.min(100, Math.max(1, Number(rest[0] ?? 10) || 10))
      const entries = status.progress
        .filter((entry) => flag(parsed, 'stage') === undefined || entry.stage === flag(parsed, 'stage'))
        .filter((entry) => flag(parsed, 'tag') === undefined || entry.tags.includes(flag(parsed, 'tag') ?? ''))
        .slice(0, limit)
      if (entries.length === 0) return success('No progress entries match.')
      return success(entries.map((entry) =>
        `${entry.ts.slice(0, 19).replace('T', ' ')} [${entry.stage}] ${entry.did}\n  next: ${entry.next}${entry.blocked === undefined ? '' : `\n  blocked: ${entry.blocked}`}`,
      ).join('\n'))
    }
    case 'fork': {
      const project = rest[0] ?? await boundReference(service, sessionId)
      const result = await service.fork({
        project,
        ...(flag(parsed, 'name') === undefined ? {} : { name: flag(parsed, 'name') }),
        bindSessionId: sessionId,
      })
      return success(`Forked ${result.sourceProjectId} -> ${result.project.name} (${result.project.id}). This session is bound to the fork.`)
    }
    case 'merge': {
      const [source, target] = rest
      if (source === undefined || target === undefined) {
        return failure(new ProjectError('INVALID_ARGUMENT', 'Usage: /project merge <source> <target> [--delete-source] [--purge-source]'))
      }
      const result = await service.merge({
        source,
        target,
        deleteSource: booleanFlag(parsed, 'delete-source'),
        purgeSource: booleanFlag(parsed, 'purge-source'),
      })
      return success(
        `Merged ${result.sourceProjectId} -> ${result.targetProjectId}.\nSource retained: ${result.sourceRetained}\nTarget counts: ${result.merged.conventions} conventions, ${result.merged.decisions} decisions, ${result.merged.progress} progress.`,
      )
    }
    case 'delete': {
      const project = rest[0] ?? await boundReference(service, sessionId)
      const result = await service.delete({
        project,
        mode: booleanFlag(parsed, 'purge') ? 'purge' : 'trash',
      })
      return success(
        result.mode === 'trash'
          ? `Moved ${result.projectId} to trash: ${result.trashPath ?? '(trash)'}`
          : `Purged ${result.projectId}.`,
      )
    }
    case 'insert': {
      const project = rest[0] ?? await boundReference(service, sessionId)
      const kind = rest[1]
      const target = rest[2]
      if (kind === undefined || target === undefined) {
        return failure(new ProjectError('INVALID_ARGUMENT', 'Usage: /project insert <directory|session|project> <target>'))
      }
      if (kind !== 'directory' && kind !== 'session' && kind !== 'project') {
        return failure(new ProjectError('INVALID_ARGUMENT', 'kind must be directory, session, or project.'))
      }
      const result = await service.insert({
        project,
        kind,
        ...(kind === 'directory' ? { path: target } : kind === 'session' ? { sessionId: target } : { targetProjectId: target }),
        ...(flag(parsed, 'label') === undefined ? {} : { label: flag(parsed, 'label') }),
        ...(flag(parsed, 'note') === undefined ? {} : { note: flag(parsed, 'note') }),
        actor: sessionId,
      })
      return success(`${result.deduped ? 'Already inserted' : 'Inserted'} ${result.member.kind} member ${result.member.id}.`)
    }
    case 'archive':
    case 'unarchive': {
      const project = rest[0] ?? await boundReference(service, sessionId)
      const summary = await service.archive(project, command === 'archive')
      return success(`${summary.name}: archived=${summary.archived}`)
    }
    case 'task': {
      const action = rest[0]
      if (action !== 'list' && action !== 'checkpoint' && action !== 'interrupt' && action !== 'resume' && action !== 'done' && action !== 'blocked') {
        return failure(new ProjectError('INVALID_ARGUMENT', 'Usage: /project task <list|checkpoint|interrupt|resume|done|blocked>'))
      }
      const project = await boundReference(service, sessionId)
      const result = await service.task({
        project,
        action,
        ...(flag(parsed, 'title') === undefined ? {} : { title: flag(parsed, 'title') }),
        ...(flag(parsed, 'prompt') === undefined ? {} : { prompt: flag(parsed, 'prompt') }),
        ...(flag(parsed, 'summary') === undefined ? {} : { summary: flag(parsed, 'summary') }),
        ...(flag(parsed, 'next') === undefined ? {} : { next: flag(parsed, 'next') }),
        ...(flag(parsed, 'blocked') === undefined ? {} : { blocked: flag(parsed, 'blocked') }),
      }, invocation.agent)
      return success(
        `Task ${result.task.id} [${result.task.status}] ${result.task.title}\ncheckpoint: ${oneLine(result.task.checkpoint.summary || result.task.checkpoint.did || '(empty)', 500)}`,
      )
    }
    default:
      return failure(new ProjectError('INVALID_ARGUMENT', `Unknown /project subcommand: ${command}`, 'Run /project help.'))
  }
}

export function registerProjectCommand(ctx: DshContext, service: ProjectService): void {
  ctx.commands.register({
    name: 'project',
    description: 'Manage project workspaces and project-first context',
    input: { hint: '[list|create|use|note|ref|status|log|fork|merge|delete|insert|task|archive|unarchive|help]' },
    handler: async (invocation) => {
      try {
        return await execute(service, invocation)
      } catch (error) {
        return failure(error)
      }
    },
  })
}
