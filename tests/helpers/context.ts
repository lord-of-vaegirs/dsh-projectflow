import type { DshContext, DshToolDefinition, DshCommandDefinition } from '../../src/dsh/contracts.js'

export function fakeContext(overrides: Partial<DshContext> = {}): {
  ctx: DshContext
  tools: Map<string, DshToolDefinition>
  commands: Map<string, DshCommandDefinition>
  listeners: Map<string, Array<(...args: any[]) => unknown>>
} {
  const tools = new Map<string, DshToolDefinition>()
  const commands = new Map<string, DshCommandDefinition>()
  const listeners = new Map<string, Array<(...args: any[]) => unknown>>()
  const ctx: DshContext = {
    logger: { info: () => undefined, warn: () => undefined, debug: () => undefined },
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => tools.delete(definition.name) } },
    commands: { register: (definition) => { commands.set(definition.name, definition); return () => commands.delete(definition.name) } },
    on: (event, handler) => {
      const current = listeners.get(event) ?? []
      current.push(handler)
      listeners.set(event, current)
      return () => {
        const next = (listeners.get(event) ?? []).filter((candidate) => candidate !== handler)
        listeners.set(event, next)
      }
    },
    ...overrides,
  }
  return { ctx, tools, commands, listeners }
}

export function execFor(agent: any, args: unknown): any {
  return {
    callId: 'call-1',
    name: 'test',
    arguments: args,
    agent,
    signal: new AbortController().signal,
  }
}
