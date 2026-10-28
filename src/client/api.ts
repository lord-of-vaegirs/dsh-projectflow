import type {
  ProjectStatus,
  ProjectSummary,
  RpcBindingResult,
  RpcContextResult,
} from '../shared/contracts.js'

export interface ClientRpcResult<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string }
}

export interface ClientConnection {
  rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<ClientRpcResult<unknown>>
  }
}

export async function callProjectflow<T>(
  connection: ClientConnection,
  endpoint: string,
  payload: unknown,
): Promise<T> {
  const response = await connection.rpc.call('/projectflow', endpoint, payload)
  if (response.ok !== true) {
    throw new Error(response.error?.message ?? 'projectflow request failed')
  }
  return response.value as T
}

export interface ClientWorkspace {
  workspaceId: string
  path: string
  title?: string
}

export interface ClientSessionSummary {
  id: string
  title?: string
  cwd?: string
  blank?: boolean
}

export interface ClientConversation {
  id: string
  title: string
  cwd: string
}

export interface ClientPanelApi {
  list(): Promise<{ projects: ProjectSummary[]; invalid: Array<{ id: string; error: string }> }>
  status(project: string): Promise<ProjectStatus>
  create(input: { name: string; aliases: string[]; primaryPath: string; bindSessionId?: string }): Promise<{ project: ProjectSummary }>
  remove(project: string): Promise<{ projectId: string; mode: string; trashPath?: string }>
  fork(project: string, name?: string): Promise<{ project: ProjectSummary }>
  merge(source: string, target: string, deleteSource: boolean): Promise<unknown>
  insert(input: {
    project: string
    kind: 'directory' | 'session' | 'project'
    path?: string
    sessionId?: string
    targetProjectId?: string
    label?: string
  }): Promise<unknown>
  removeMember(project: string, memberId: string): Promise<unknown>
  ref(input: {
    project: string
    kind: 'dir' | 'file' | 'tool' | 'plugin' | 'mcp'
    path?: string
    tool?: string
    args?: string[]
    purpose: string
    note?: string
  }): Promise<unknown>
  note(input: {
    project: string
    category: 'fact' | 'convention' | 'decision' | 'progress'
    content: string
    stage?: string
    next?: string
  }): Promise<unknown>
  bind(sessionId: string, project: string): Promise<RpcBindingResult>
  task(project: string, sessionId: string, action: 'list' | 'checkpoint' | 'interrupt' | 'resume' | 'done' | 'blocked'): Promise<unknown>
  context(sessionId: string): Promise<RpcContextResult>
  enter(project: ProjectSummary): Promise<string>
  listConversations(project: ProjectSummary): ClientConversation[]
  openConversation(sessionId: string): void
  listSessions(): Array<{ id: string; title: string; cwd: string }>
}
