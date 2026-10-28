import { describe, expect, it } from 'vitest'
import { cleanup, serviceFor, tempProjectRoot } from '../helpers/tmp.js'

describe('workspace operations', () => {
  it('inserts members, forks, merges, and trashes', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const source = await service.create({ name: 'Source', primaryPath: '/tmp/source', bindSessionId: 's1' })
      await service.note({ project: source.project.id, category: 'convention', content: 'Source rule' }, 's1')
      await service.insert({
        project: source.project.id,
        kind: 'directory',
        path: '/tmp/extra',
        actor: 's1',
      })
      await service.insert({
        project: source.project.id,
        kind: 'project',
        targetProjectId: source.project.id,
        label: 'self',
        actor: 's1',
      })

      const fork = await service.fork({ project: source.project.id, name: 'Fork', bindSessionId: 's2' })
      expect(fork.project.name).toBe('Fork')
      const forkStatus = await service.status(fork.project.id, 's2')
      expect(forkStatus.conventions).toHaveLength(1)
      expect(forkStatus.members).toHaveLength(2)

      const target = await service.create({ name: 'Target', primaryPath: '/tmp/target' })
      const merged = await service.merge({
        source: fork.project.id,
        target: target.project.id,
        deleteSource: true,
      })
      expect(merged.sourceRetained).toBe(false)
      const targetStatus = await service.status(target.project.id)
      expect(targetStatus.conventions.length).toBe(1)
      expect(targetStatus.project.mergedFrom).toContain(fork.project.id)

      const deleted = await service.delete({ project: source.project.id })
      expect(deleted.mode).toBe('trash')
      expect(deleted.trashPath).toContain('.trash')
      await expect(service.get(source.project.id)).rejects.toThrow()
    } finally {
      await cleanup(root)
    }
  })
})

describe('merge dedupe', () => {
  it('does not duplicate progress copied by a fork and removes source project members', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const source = await service.create({ name: 'MergeSource', primaryPath: '/tmp/merge-source', bindSessionId: 's1' })
      await service.note({
        project: source.project.id,
        category: 'progress',
        content: 'Same work',
        stage: 'M1',
        next: 'Same next',
      }, 's1')
      const fork = await service.fork({ project: source.project.id, name: 'MergeFork' })
      const target = await service.create({ name: 'MergeTarget', primaryPath: '/tmp/merge-target' })
      await service.merge({ source: fork.project.id, target: target.project.id, deleteSource: true })
      const status = await service.status(target.project.id)
      const same = status.progress.filter((entry) => entry.did === 'Same work')
      expect(same).toHaveLength(1)
      expect(status.members.some((member) => member.projectId === fork.project.id)).toBe(false)
    } finally {
      await cleanup(root)
    }
  })
})
