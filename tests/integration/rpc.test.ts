import { describe, expect, it } from 'vitest'
import { registerProjectRpc } from '../../src/dsh/rpc.js'
import { cleanup, serviceFor, tempProjectRoot } from '../helpers/tmp.js'
import { fakeContext } from '../helpers/context.js'

function requestFor(endpoint: string, payload: unknown): any {
  const body = Buffer.from(JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: endpoint, payload }))
  return {
    method: 'POST',
    url: `/projectflow/${endpoint}`,
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield body
    },
  }
}

function responseSink(): { res: any; done: Promise<any> } {
  let resolve: (value: any) => void
  const done = new Promise<any>((next) => { resolve = next })
  const res = {
    writeHead: () => undefined,
    end: (text: string) => resolve(JSON.parse(text)),
  }
  return { res, done }
}

describe('browser RPC bridge', () => {
  it('dispatches list, create, bind, and context', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      let route: any
      const { ctx } = fakeContext({
        inject: (_deps, callback) => {
          callback({
            connection: { admit: () => ({ peer: {} }) },
            webServer: {
              register: (next: any) => {
                route = next
                return () => undefined
              },
            },
            effect: (operation: () => unknown) => { operation() },
          } as any)
        },
      })
      registerProjectRpc(ctx, service)
      expect(route?.path).toBe('/projectflow')

      const invoke = async (endpoint: string, payload: unknown) => {
        const sink = responseSink()
        await route.handler(requestFor(endpoint, payload), sink.res)
        return sink.done
      }

      const empty = await invoke('list', {})
      expect(empty.result.ok).toBe(true)
      expect(empty.result.value.projects).toHaveLength(0)

      const created = await invoke('create', {
        name: 'RPC',
        primaryPath: '/tmp/rpc',
        bindSessionId: 's1',
      })
      expect(created.result.ok).toBe(true)
      expect(created.result.value.project.name).toBe('RPC')

      const bound = await invoke('bind', { sessionId: 's1', project: 'RPC' })
      expect(bound.result.ok).toBe(true)

      const context = await invoke('context', { sessionId: 's1' })
      expect(context.result.ok).toBe(true)
      expect(context.result.value.projectId).toBe(created.result.value.project.id)

      const failure = await invoke('status', {})
      expect(failure.result.ok).toBe(false)
      expect(failure.result.error.code).toBe('SESSION_REQUIRED')
    } finally {
      await cleanup(root)
    }
  })
})
