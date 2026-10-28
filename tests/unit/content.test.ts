import { describe, expect, it } from 'vitest'
import { cleanup, serviceFor, tempProjectRoot } from '../helpers/tmp.js'

describe('records and references', () => {
  it('writes facts, conventions, decisions, progress, and refs', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const created = await service.create({ name: 'Beta', primaryPath: '/tmp/beta', bindSessionId: 's1' })
      const id = created.project.id

      const fact = await service.note({ project: id, category: 'fact', content: 'Use pnpm.' }, 's1')
      expect(fact.entryId).toMatch(/^mem_/u)
      const duplicate = await service.note({ project: id, category: 'fact', content: 'Use pnpm.' }, 's1')
      expect(duplicate.deduped).toBe(true)
      expect(duplicate.entryId).toBe(fact.entryId)

      const convention = await service.note({ project: id, category: 'convention', content: 'Run tests before commit.' }, 's1')
      expect(convention.entryId).toMatch(/^con_/u)

      const decision = await service.note({
        project: id,
        category: 'decision',
        content: 'Store data under DSH_HOME.',
        context: 'Workspaces move.',
        consequences: 'Data survives uninstall.',
      }, 's1')
      expect(decision.entryId).toBe('ADR-0001')

      const progress = await service.note({
        project: id,
        category: 'progress',
        content: 'Implemented storage',
        stage: 'M1',
        next: 'Implement tools',
        tags: ['storage'],
      }, 's1')
      expect(progress.deduped).toBe(false)

      const ref = await service.ref({
        project: id,
        kind: 'dir',
        path: '/tmp/ref',
        purpose: 'Reference directory',
      }, 's1')
      expect(ref.entry.kind).toBe('dir')

      const tool = await service.ref({
        project: id,
        kind: 'mcp',
        tool: 'filesystem',
        purpose: 'Reference MCP server',
      }, 's1')
      expect(tool.entry.kind).toBe('mcp')

      const status = await service.status(id, 's1')
      expect(status.conventions).toHaveLength(1)
      expect(status.decisions).toHaveLength(1)
      expect(status.progress).toHaveLength(1)
      expect(status.dirs).toHaveLength(1)
      expect(status.tools).toHaveLength(1)
      expect(status.project.counts.conventions).toBe(1)
      expect(status.project.counts.members).toBe(0)
    } finally {
      await cleanup(root)
    }
  })

  it('archives old progress and keeps a pointer', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir, { limits: { progressLines: 5 } })
      const created = await service.create({ name: 'Progress', primaryPath: '/tmp/p', bindSessionId: 's1' })
      for (let index = 0; index < 12; index += 1) {
        await service.note({
          project: created.project.id,
          category: 'progress',
          content: `Did ${index}`,
          stage: 'M1',
          next: `Next ${index}`,
        }, 's1')
      }
      const status = await service.status(created.project.id, 's1')
      expect(status.progress.length).toBeLessThanOrEqual(5)
      expect(status.progress.some((entry) => entry.tags.includes('archive'))).toBe(true)
      const { readdir } = await import('node:fs/promises')
      const { join } = await import('node:path')
      expect((await readdir(join(dir, created.project.id, 'archive'))).some((file) => file.startsWith('progress-'))).toBe(true)
    } finally {
      await cleanup(root)
    }
  })
})
