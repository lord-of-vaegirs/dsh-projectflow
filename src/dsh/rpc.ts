import type { IncomingMessage, ServerResponse } from 'node:http'
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
    case 'ensure-workspace':
      return service.ensureConversationWorkspace(string(input.project, 'project'))
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

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.byteLength
    if (size > 1_048_576) throw new ProjectError('INVALID_ARGUMENT', 'RPC body is too large.')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Register the browser bridge as an exact authenticated Web route.
 *
 * A direct route is used instead of `connection.rpc.handle` because the latter
 * owns its route through the calling fiber; a plugin fiber mounted from a
 * profile's bundle layer can otherwise block during boot. `connection.admit`
 * still applies the same Host/Origin and browser-cookie fence.
 */
export function registerProjectRpc(ctx: DshContext, service: ProjectService): void {
  if (ctx.inject === undefined) return
  ctx.inject(['connection', 'webServer'], (inner) => {
    const connection = inner.connection as any
    const webServer = (inner as any).webServer as {
      register(route: {
        kind: 'prefix'
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
      }): () => void
    } | undefined
    if (connection === undefined || webServer === undefined) return
    const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const admission = connection.admit(req)
      if ('rejection' in admission) {
        res.writeHead(admission.rejection)
        res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://projectflow.invalid').pathname
      const endpoint = pathname.startsWith('/projectflow/') ? pathname.slice('/projectflow/'.length) : undefined
      if (endpoint === undefined || endpoint === '') {
        res.writeHead(404)
        res.end('not found')
        return
      }
      try {
        const text = await readBody(req)
        const message = JSON.parse(text) as Record<string, unknown>
        if (message.type !== 'client-request' || typeof message.rpcId !== 'string' || typeof message.method !== 'string') {
          writeJson(res, 400, { type: 'server-response', rpcId: typeof message.rpcId === 'string' ? message.rpcId : '', result: { ok: false, error: { code: 'invalid-request', message: 'invalid client-request envelope' } } })
          return
        }
        if (message.method !== endpoint) {
          writeJson(res, 200, {
            type: 'server-response',
            rpcId: message.rpcId,
            result: { ok: false, error: { code: 'bad-request', message: 'method does not match endpoint' } },
          })
          return
        }
        let result: unknown
        try {
          result = { ok: true, value: await dispatch(ctx, service, endpoint, message.payload) }
        } catch (error) {
          const projectError = error instanceof ProjectError
            ? error
            : new ProjectError('IO_ERROR', (error as Error).message)
          result = { ok: false, error: { code: projectError.code, message: projectError.message } }
        }
        writeJson(res, 200, { type: 'server-response', rpcId: message.rpcId, result })
      } catch (error) {
        writeJson(res, 400, {
          type: 'server-response',
          rpcId: '',
          result: { ok: false, error: { code: 'bad-request', message: (error as Error).message } },
        })
      }
    }
    const route = { kind: 'prefix' as const, path: '/projectflow', handler }
    const dispose = webServer.register(route)
    inner.effect?.(() => dispose, 'projectflow: browser RPC route')
  })
}
