import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanup, serviceFor, tempProjectRoot } from '../helpers/tmp.js'

function runWriter(dir: string, id: string, prefix: string, count: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      join(process.cwd(), 'tests/fixtures/writer.mjs'),
      dir,
      id,
      prefix,
      String(count),
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`writer exited ${code}: ${stderr}`))
    })
  })
}

describe('cross-process writes', () => {
  it('serializes concurrent writers without losing entries', async () => {
    const { root, dir } = await tempProjectRoot()
    try {
      const service = serviceFor(dir)
      const project = await service.create({ name: 'Concurrent', primaryPath: '/tmp/concurrent' })
      await Promise.all([
        runWriter(dir, project.project.id, 'one', 3),
        runWriter(dir, project.project.id, 'two', 3),
        runWriter(dir, project.project.id, 'three', 3),
        runWriter(dir, project.project.id, 'four', 3),
      ])
      const status = await service.status(project.project.id)
      expect(status.conventions).toHaveLength(12)
    } finally {
      await cleanup(root)
    }
  })
})
