import { describe, expect, it } from 'vitest'
import { registerProjectRpc } from '../../src/dsh/rpc.js'
import { cleanup, fakeAgent, serviceFor, tempProjectRoot } from '../helpers/tmp.js'
import { fakeContext } from '../helpers/context.js'

describe('browser RPC bridge', () => {
  it('dispatches list, create, bind, and context', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      let handler: any
      const { ctx } = fakeContext({
        inject: (_deps, callback) => {
          callback({
            connection: {
              rpc: {
                handle: (_channel, next) => {
                  handler = next
                  return async () => undefined
                },
              },
            },
            effect: (operation: () => unknown) => { operation() },
          } as any)
        },
      })
      registerProjectRpc(ctx, service)
      expect(handler).toBeDefined()
      const empty = await handler('list', {})
      expect(empty.ok).toBe(true)
      expect(empty.value.projects).toHaveLength(0)

      const created = await handler('create', {
        name: 'RPC',
        primaryPath: '/tmp/rpc',
        bindSessionId: 's1',
      })
      expect(created.ok).toBe(true)
      expect(created.value.project.name).toBe('RPC')

      const bound = await handler('bind', { sessionId: 's1', project: 'RPC' })
      expect(bound.ok).toBe(true)

      const context = await handler('context', { sessionId: 's1' })
      expect(context.ok).toBe(true)
      expect(context.value.projectId).toBe(created.value.project.id)

      const failure = await handler('status', {})
      expect(failure.ok).toBe(false)
      expect(failure.error.code).toBe('SESSION_REQUIRED')
    } finally {
      await cleanup(root)
    }
  })
})
