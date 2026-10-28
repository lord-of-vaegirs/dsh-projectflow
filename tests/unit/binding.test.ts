import { describe, expect, it } from 'vitest'
import { cleanup, fakeAgent, serviceFor, tempProjectRoot } from '../helpers/tmp.js'

describe('fork inheritance', () => {
  it('materializes a child binding from parentSession', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const created = await service.create({
        name: 'Forked',
        primaryPath: '/tmp/parent',
        bindSessionId: 'parent',
      })
      const child = fakeAgent({ id: 'child', cwd: '/tmp/child', parentSession: 'parent' })
      await service.inheritForAgent(child)
      const binding = await service.bindingForSession('child')
      expect(binding?.projectId).toBe(created.project.id)
      expect(binding?.binding.parentSessionId).toBe('parent')
      expect(binding?.binding.note).toContain('inherited')
    } finally {
      await cleanup(root)
    }
  })

  it('does not guess a project from cwd', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      await service.create({ name: 'Cwd', primaryPath: '/tmp/parent' })
      const child = fakeAgent({ id: 'child', cwd: '/tmp/parent' })
      await service.inheritForAgent(child)
      expect(await service.bindingForSession('child')).toBeUndefined()
    } finally {
      await cleanup(root)
    }
  })

  it('keeps the child binding stable when the parent rebinds', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const first = await service.create({ name: 'First', primaryPath: '/tmp/one', bindSessionId: 'parent' })
      const child = fakeAgent({ id: 'child', parentSession: 'parent' })
      await service.inheritForAgent(child)
      const second = await service.create({ name: 'Second', primaryPath: '/tmp/two' })
      await service.use('parent', second.project.id)
      const binding = await service.bindingForSession('child')
      expect(binding?.projectId).toBe(first.project.id)
    } finally {
      await cleanup(root)
    }
  })
})
