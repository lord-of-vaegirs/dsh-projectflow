/**
 * Minimal structural contracts for the DSH host APIs this plugin consumes.
 *
 * They intentionally mirror the 0.2.1-rc.2 surfaces verified from the
 * installed packages. Runtime imports are avoided so the plugin has no
 * dependency on the host's private module tree; only type shapes are asserted
 * here. The integration tests use the same shapes.
 */

export interface DshContentBlock {
  type: 'text'
  text: string
}

export interface DshToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): DshContentBlock[]
  }
  execute(args: unknown, exec: DshToolExecution): Promise<unknown>
  isConcurrencySafe?(args: unknown): boolean
  presentCall?(args: unknown): unknown
  presentResult?(args: unknown, result: unknown): unknown
}

export interface DshToolExecution {
  callId: string
  name: string
  arguments: unknown
  agent?: DshAgent
  signal: AbortSignal
}

export interface DshSessionHeader {
  cwd?: string
  parentSession?: string
  createdAt?: number
  isSeeded?: boolean
  origin?: 'subagent'
}

export interface DshSession {
  id: string
  header: DshSessionHeader
  snapshotEvents?(): readonly unknown[]
}

export interface DshAgent {
  id: string
  session: DshSession
  cancel?(cause: { kind: 'hook'; reason: string }, options?: { keepInbox?: boolean }): void
}

export interface DshCommandInvocation {
  agent: DshAgent
  rawInput: string
  signal: AbortSignal
  attachments?: readonly unknown[]
}

export interface DshCommandResult {
  kind: 'success' | 'error'
  text: string
}

export interface DshCommandDefinition {
  name: string
  description: string
  input?: { hint?: string; attachments?: boolean }
  handler(invocation: DshCommandInvocation): DshCommandResult | Promise<DshCommandResult>
}

export interface DshPromptSection {
  name: string
  text: string
  interpolate?: boolean
}

export interface DshPromptAssembly {
  sections: DshPromptSection[]
  contexts: unknown[]
  tools: unknown[]
  variables: Record<string, string | undefined>
}

export interface DshAssembleContext {
  agent?: DshAgent
  signal?: AbortSignal
  scope?: unknown
}

export interface DshConnection {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>,
    ): () => Promise<void>
  }
}

export interface DshContext {
  logger?: {
    info?(message: string): void
    warn?(message: string): void
    debug?(message: string): void
  }
  tools: { register(definition: DshToolDefinition): () => void }
  commands: { register(definition: DshCommandDefinition): () => void }
  agents?: {
    get(id: string): DshAgent | undefined
    list?(): DshAgent[]
    roots?(): DshAgent[]
  }
  connection?: DshConnection
  on(
    event: string,
    handler: (...args: any[]) => unknown,
    options?: { prepend?: boolean },
  ): () => void
  inject?(dependencies: string[], callback: (ctx: DshContext) => void): void
  get?(service: string): unknown
  effect?(operation: () => (() => unknown) | void, label?: string): void
}

export interface PluginConfig {
  projectsDir?: string
  contextBudgetTokens?: number
  lockWaitMs?: number
  taskTracking?: boolean
  rpc?: boolean
  limits?: Record<string, number>
}
