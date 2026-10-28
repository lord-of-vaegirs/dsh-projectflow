import { describe, expect, it } from 'vitest'
import { registerProjectTools } from '../../src/dsh/tools.js'
import { cleanup, configFor, fakeAgent, serviceFor, tempProjectRoot } from '../helpers/tmp.js'
import { execFor, fakeContext } from '../helpers/context.js'

async function setup() {
  const { root, dir } = await tempProjectRoot()
  const config = configFor(dir)
  const service = serviceFor(dir)
  const { ctx, tools } = fakeContext()
  registerProjectTools(ctx, service, config)
  return { root, dir, service, tools, agent: fakeAgent({ id: 's1', cwd: '/tmp/work' }) }
}

describe('project tools', () => {
  it('creates, lists, binds, notes, and returns a filtered status', async () => {
    const { root, tools, agent } = await setup()
    try {
      const create = tools.get('project_create')!
      const created = await create.execute({ name: 'Tools', primaryPath: '/tmp/tools' }, execFor(agent, {})) as any
      expect(created.created).toBe(true)
      const list = await tools.get('project_list')!.execute({}, execFor(agent, {})) as any
      expect(list.projects).toHaveLength(1)

      const use = await tools.get('project_use')!.execute({ project: 'Tools' }, execFor(agent, {})) as any
      expect(use.project.name).toBe('Tools')

      const note = await tools.get('project_note')!.execute({
        category: 'convention',
        content: 'Use the project context.',
      }, execFor(agent, {})) as any
      expect(note.category).toBe('convention')

      const progress = await tools.get('project_note')!.execute({
        category: 'progress',
        content: 'Finished tools',
        stage: 'M3',
        next: 'Client',
      }, execFor(agent, {})) as any
      expect(progress.deduped).toBe(false)

      const status = await tools.get('project_status')!.execute({
        sections: ['conventions', 'progress'],
        limit: 5,
      }, execFor(agent, {})) as any
      expect(status.conventions).toHaveLength(1)
      expect(status.progress).toHaveLength(1)
      expect(status.decisions).toHaveLength(0)
    } finally {
      await cleanup(root)
    }
  })

  it('validates progress arguments with an actionable error', async () => {
    const { root, tools, agent } = await setup()
    try {
      await tools.get('project_create')!.execute({ name: 'Validate', primaryPath: '/tmp/validate' }, execFor(agent, {}))
      await expect(tools.get('project_note')!.execute({
        category: 'progress',
        content: 'Missing stage',
      }, execFor(agent, {}))).rejects.toThrow(/stage/i)
    } finally {
      await cleanup(root)
    }
  })
})
