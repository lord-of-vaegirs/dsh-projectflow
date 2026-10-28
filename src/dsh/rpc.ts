import type { ProjectService } from '../domain/project-service.js'
import { ProjectError } from '../errors.js'
import type { DshContext } from './contracts.js'

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectError('INVALID_ARGUMENT', 'RPC payload must be an object.')
  }
  return value as Record<string, unknown>
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectError('INVALID_ARGUMENT', `${name} must be a non-empty string.`)
  }
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

async function dispatch(
  ctx: DshContext,
  service: ProjectService,
  endpoint: string,
  payload: unknown,
): Promise<unknown> {
  const input = record(payload)
  switch (endpoint) {
    case 'list':
      return service.list(boolean(input.includeArchived) === true)
    case 'status': {
      const sessionId = optionalString(input.sessionId)
      const reference = optionalString(input.project)
      if (reference === undefined) {
        if (sessionId === undefined) throw new ProjectError('SESSION_REQUIRED', 'status requires project or sessionId.')
        const binding = await service.bindingForSession(sessionId)
        if (binding === undefined) throw new ProjectError('NOT_BOUND', 'This session is not bound to a project.')
        return service.status(binding.projectId, sessionId)
      }
      return service.status(reference, sessionId)
    }
    case 'create':
      return service.create({
        name: string(input.name, 'name'),
        ...(Array.isArray(input.aliases)
          ? { aliases: input.aliases.filter((item): item is string => typeof item === 'string') }
          : {}),
        primaryPath: string(input.primaryPath, 'primaryPath'),
        ...(optionalString(input.bindSessionId) === undefined
          ? {}
          : { bindSessionId: optionalString(input.bindSessionId)! }),
      })
    case 'delete':
      return service.delete({
        project: string(input.project, 'project'),
        mode: input.mode === 'purge' ? 'purge' : 'trash',
      })
    case 'fork':
      return service.fork({
        project: string(input.project, 'project'),
        ...(optionalString(input.name) === undefined ? {} : { name: optionalString(input.name)! }),
        ...(optionalString(input.bindSessionId) === undefined
          ? {}
          : { bindSessionId: optionalString(input.bindSessionId)! }),
      })
    case 'merge':
      return service.merge({
        source: string(input.source, 'source'),
        target: string(input.target, 'target'),
        deleteSource: boolean(input.deleteSource) === true,
        purgeSource: boolean(input.purgeSource) === true,
      })
    case 'insert': {
      const kind = input.kind
      if (kind !== 'directory' && kind !== 'session' && kind !== 'project') {
        throw new ProjectError('INVALID_ARGUMENT', 'kind must be directory, session, or project.')
      }
      return service.insert({
        project: string(input.project, 'project'),
        kind,
        ...(optionalString(input.path) === undefined ? {} : { path: optionalString(input.path)! }),
        ...(optionalString(input.sessionId) === undefined ? {} : { sessionId: optionalString(input.sessionId)! }),
        ...(optionalString(input.targetProjectId) === undefined ? {} : { targetProjectId: optionalString(input.targetProjectId)! }),
        ...(optionalString(input.label) === undefined ? {} : { label: optionalString(input.label)! }),
        ...(optionalString(input.note) === undefined ? {} : { note: optionalString(input.note)! }),
        actor: optionalString(input.actor) ?? 'ui',
      })
    }
    case 'remove-member':
      return {
        removed: await service.removeMember(
          string(input.project, 'project'),
          string(input.memberId, 'memberId'),
        ),
      }
    case 'ref':
      return service.ref({
        project: string(input.project, 'project'),
        kind: string(input.kind, 'kind') as any,
        ...(optionalString(input.path) === undefined ? {} : { path: optionalString(input.path)! }),
        ...(optionalString(input.tool) === undefined ? {} : { tool: optionalString(input.tool)! }),
        ...(Array.isArray(input.args)
          ? { args: input.args.filter((item): item is string => typeof item === 'string') }
          : {}),
        purpose: string(input.purpose, 'purpose'),
        ...(optionalString(input.note) === undefined ? {} : { note: optionalString(input.note)! }),
      }, optionalString(input.actor) ?? 'ui')
    case 'note':
      return service.note({
        project: string(input.project, 'project'),
        category: string(input.category, 'category') as any,
        ...(optionalString(input.content) === undefined ? {} : { content: optionalString(input.content)! }),
        ...(optionalString(input.title) === undefined ? {} : { title: optionalString(input.title)! }),
        ...(optionalString(input.stage) === undefined ? {} : { stage: optionalString(input.stage)! }),
        ...(optionalString(input.next) === undefined ? {} : { next: optionalString(input.next)! }),
        ...(optionalString(input.blocked) === undefined ? {} : { blocked: optionalString(input.blocked)! }),
        ...(Array.isArray(input.tags)
          ? { tags: input.tags.filter((item): item is string => typeof item === 'string') }
          : {}),
        ...(optionalString(input.context) === undefined ? {} : { context: optionalString(input.context)! }),
        ...(optionalString(input.consequences) === undefined ? {} : { consequences: optionalString(input.consequences)! }),
        ...(optionalString(input.status) === undefined ? {} : { status: optionalString(input.status) as any }),
        ...(optionalString(input.path) === undefined ? {} : { path: optionalString(input.path)! }),
        ...(optionalString(input.tool) === undefined ? {} : { tool: optionalString(input.tool)! }),
        ...(Array.isArray(input.args)
          ? { args: input.args.filter((item): item is string => typeof item === 'string') }
          : {}),
        ...(optionalString(input.purpose) === undefined ? {} : { purpose: optionalString(input.purpose)! }),
        ...(optionalString(input.note) === undefined ? {} : { note: optionalString(input.note)! }),
      }, optionalString(input.actor) ?? 'ui')
    case 'bind': {
      const sessionId = string(input.sessionId, 'sessionId')
      const result = await service.use(sessionId, string(input.project, 'project'), optionalString(input.note))
      return { sessionId, projectId: result.project.id, binding: result.binding }
    }
    case 'task': {
      const sessionId = optionalString(input.sessionId)
      const agent = sessionId === undefined ? undefined : ctx.agents?.get(sessionId)
      return service.task({
        ...(optionalString(input.project) === undefined ? {} : { project: optionalString(input.project)! }),
        ...(sessionId === undefined ? {} : { sessionId }),
        action: string(input.action, 'action') as any,
        ...(optionalString(input.title) === undefined ? {} : { title: optionalString(input.title)! }),
        ...(optionalString(input.prompt) === undefined ? {} : { prompt: optionalString(input.prompt)! }),
        ...(optionalString(input.summary) === undefined ? {} : { summary: optionalString(input.summary)! }),
        ...(optionalString(input.next) === undefined ? {} : { next: optionalString(input.next)! }),
        ...(optionalString(input.blocked) === undefined ? {} : { blocked: optionalString(input.blocked)! }),
        ...(Array.isArray(input.tags)
          ? { tags: input.tags.filter((item): item is string => typeof item === 'string') }
          : {}),
      }, agent)
    }
    case 'context': {
      const sessionId = string(input.sessionId, 'sessionId')
      const binding = await service.bindingForSession(sessionId)
      if (binding === undefined) {
        return { sessionId, context: { text: '', estimatedTokens: 0, truncated: false } }
      }
      return { sessionId, projectId: binding.projectId, context: await service.context(binding.projectId, sessionId) }
    }
    default:
      throw new ProjectError('INVALID_ARGUMENT', `Unknown projectflow RPC endpoint: ${endpoint}`)
  }
}

/**
 * Register the browser bridge. TUI/headless deployments have no connection
 * service; the bridge is optional and must not prevent host tools from working.
 */
export function registerProjectRpc(ctx: DshContext, service: ProjectService): void {
  if (ctx.inject === undefined) return
  ctx.inject(['connection'], (inner) => {
    const connection = inner.connection
    if (connection === undefined) return
    const handler = async (endpoint: string, payload: unknown) => {
      try {
        return { ok: true as const, value: await dispatch(ctx, service, endpoint, payload) }
      } catch (error) {
        const projectError = error instanceof ProjectError
          ? error
          : new ProjectError('IO_ERROR', (error as Error).message)
        return {
          ok: false as const,
          error: { code: projectError.code, message: projectError.message },
        }
      }
    }
    try {
      const dispose = connection.rpc.handle('/projectflow', handler)
      inner.effect?.(() => () => {
        void dispose()
      }, 'projectflow: browser RPC')
    } catch (error) {
      ctx.logger?.warn?.(`[projectflow] RPC bridge unavailable: ${(error as Error).message}`)
    }
  })
}
