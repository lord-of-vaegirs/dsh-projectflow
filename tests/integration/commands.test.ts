import { describe, expect, it } from 'vitest'
import { registerProjectCommand } from '../../src/dsh/commands.js'
import { cleanup, fakeAgent, serviceFor, tempProjectRoot } from '../helpers/tmp.js'
import { fakeContext } from '../helpers/context.js'

async function setup() {
  const { root, dir } = await tempProjectRoot()
  const service = serviceFor(dir)
  const { ctx, commands } = fakeContext()
  registerProjectCommand(ctx, service)
  return { root, service, commands, agent: fakeAgent({ id: 's1', cwd: '/tmp/work' }) }
}

async function run(commands: Map<string, any>, agent: any, rawInput: string) {
  return commands.get('project')!.handler({ agent, rawInput, signal: new AbortController().signal })
}

describe('/project command', () => {
  it('creates, uses, notes, and reports status', async () => {
    const { root, commands, agent } = await setup()
    try {
      const created = await run(commands, agent, 'create Cmd --alias c --path /tmp/cmd')
      expect(created.kind).toBe('success')
      const used = await run(commands, agent, 'use c')
      expect(used.kind).toBe('success')
      const note = await run(commands, agent, 'note convention "Always run tests"')
      expect(note.kind).toBe('success')
      const progress = await run(commands, agent, 'note progress "Done" --stage M3 --next "Client"')
      expect(progress.kind).toBe('success')
      const status = await run(commands, agent, 'status --section conventions --section progress')
      expect(status.kind).toBe('success')
      expect(status.text).toContain('Always run tests')
      expect(status.text).toContain('M3')
    } finally {
      await cleanup(root)
    }
  })

  it('returns usage for an unknown subcommand', async () => {
    const { root, commands, agent } = await setup()
    try {
      const result = await run(commands, agent, 'wat')
      expect(result.kind).toBe('error')
      expect(result.text).toContain('Unknown /project subcommand')
    } finally {
      await cleanup(root)
    }
  })
})
