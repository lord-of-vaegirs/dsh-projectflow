import { describe, expect, it, vi } from 'vitest'
import { cleanup, serviceFor, tempProjectRoot } from '../helpers/tmp.js'

describe('task struct', () => {
  it('checkpoints, interrupts, stores a system prompt, and injects it', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const project = await service.create({ name: 'Task', primaryPath: '/tmp/task', bindSessionId: 's1' })
      const cancel = vi.fn()
      const agent: any = {
        id: 's1',
        session: {
          id: 's1',
          header: { cwd: '/tmp/task' },
          snapshotEvents: () => [
            { type: 'turn/start', data: { turn: 1 } },
            { type: 'step/start', data: { turn: 1, step: 1 } },
            { type: 'user/message', data: { message: { content: [{ type: 'text', text: 'Do the work' }] } } },
            { type: 'tool/call', data: { callId: 'c1', name: 'bash' } },
            { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Working on it' }] } } },
          ],
        },
        cancel,
      }
      const checkpoint = await service.task({ project: project.project.id, action: 'checkpoint' }, agent)
      expect(checkpoint.task.status).toBe('running')
      expect(checkpoint.task.checkpoint.lastTool).toBe('bash')
      expect(checkpoint.task.checkpoint.pendingTools).toContain('bash')

      const interrupted = await service.task({
        project: project.project.id,
        action: 'interrupt',
        prompt: 'Switch to the urgent fix.',
      }, agent)
      expect(interrupted.task.status).toBe('interrupted')
      expect(interrupted.task.pendingPrompt).toContain('urgent fix')
      expect(cancel).toHaveBeenCalledOnce()

      const context = await service.context(project.project.id, 's1')
      expect(context.text).toContain('[SYSTEM INJECTION]')
      expect(context.text).toContain('urgent fix')

      const resumed = await service.task({ project: project.project.id, action: 'resume' }, agent)
      expect(resumed.task.status).toBe('running')
    } finally {
      await cleanup(root)
    }
  })
})
