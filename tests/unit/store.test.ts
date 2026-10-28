import { describe, expect, it } from 'vitest'
import { cleanup, serviceFor, tempProjectRoot } from '../helpers/tmp.js'

describe('project store', () => {
  it('creates, lists, resolves by name and alias, and binds', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const created = await service.create({
        name: 'Alpha',
        aliases: ['a1'],
        primaryPath: '/tmp/alpha',
        bindSessionId: 'session-a',
      })
      expect(created.created).toBe(true)
      expect(created.project.id).toMatch(/^prj_/u)
      expect(created.binding?.workspacePath).toBeUndefined()

      const again = await service.create({ name: 'Alpha', aliases: ['a1'], primaryPath: '/tmp/alpha' })
      expect(again.created).toBe(false)
      expect(again.project.id).toBe(created.project.id)

      const byAlias = await service.get('a1')
      expect(byAlias.id).toBe(created.project.id)
      const binding = await service.bindingForSession('session-a')
      expect(binding?.projectId).toBe(created.project.id)
      const list = await service.list()
      expect(list.projects).toHaveLength(1)
      expect(list.invalid).toHaveLength(0)
    } finally {
      await cleanup(root)
    }
  })

  it('does not overwrite the workspace directory', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      await service.create({ name: 'NoWrite', primaryPath: '/tmp/does-not-matter' })
      const { readdir } = await import('node:fs/promises')
      expect(await readdir(root)).toEqual(['projects'])
    } finally {
      await cleanup(root)
    }
  })
})
