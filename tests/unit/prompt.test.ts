import { describe, expect, it } from 'vitest'
import { registerPromptContribution } from '../../src/dsh/prompt.js'
import { cleanup, fakeAgent, serviceFor, tempProjectRoot } from '../helpers/tmp.js'
import { fakeContext } from '../helpers/context.js'

describe('prompt contribution', () => {
  it('adds a project section for a bound session', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const project = await service.create({ name: 'Prompt', primaryPath: '/tmp/prompt', bindSessionId: 's1' })
      await service.note({ project: project.project.id, category: 'convention', content: 'Always test.' }, 's1')
      const { ctx, listeners } = fakeContext()
      registerPromptContribution(ctx, service)
      const handler = listeners.get('system-prompt/assemble')?.[0]
      expect(handler).toBeDefined()
      const assembly = {
        sections: [{ name: 'identity', text: 'You are...' }],
        contexts: [],
        tools: [],
        variables: {},
      }
      const result = await handler!(assembly, { agent: fakeAgent({ id: 's1' }) }, async () => assembly) as typeof assembly
      expect(result.sections.some((section) => section.name === 'projectflow:context')).toBe(true)
      const section = result.sections.find((section) => section.name === 'projectflow:context')
      expect(section?.text).toContain('[PROJECTFLOW]')
      expect(section?.text).toContain('Always test.')
      expect(section?.interpolate).toBe(false)
      expect(result.sections.some((section) => section.name === 'identity')).toBe(true)
    } finally {
      await cleanup(root)
    }
  })

  it('leaves the assembly unchanged for an unbound session', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const { ctx, listeners } = fakeContext()
      registerPromptContribution(ctx, service)
      const handler = listeners.get('system-prompt/assemble')?.[0]
      const assembly = { sections: [{ name: 'identity', text: 'x' }], contexts: [], tools: [], variables: {} }
      const result = await handler!(assembly, { agent: fakeAgent({ id: 'nobody' }) }, async () => assembly) as typeof assembly
      expect(result).toBe(assembly)
    } finally {
      await cleanup(root)
    }
  })
})
