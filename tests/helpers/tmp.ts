import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig, type ProjectFlowConfig } from '../../src/config.js'
import { ProjectService } from '../../src/domain/project-service.js'
import type { ProjectFlowConfigInput } from '../../src/shared/contracts.js'

export async function tempProjectRoot(): Promise<{ root: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-projectflow-test-'))
  return { root, dir: join(root, 'projects') }
}

export async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true })
}

export function configFor(projectsDir: string, overrides: Partial<ProjectFlowConfigInput> = {}): ProjectFlowConfig {
  return resolveConfig({ projectsDir, ...overrides })
}

export function serviceFor(projectsDir: string, overrides: Partial<ProjectFlowConfigInput> = {}): ProjectService {
  return new ProjectService(configFor(projectsDir, overrides))
}

export function fakeAgent(input: {
  id: string
  cwd?: string
  parentSession?: string
  events?: readonly unknown[]
}): any {
  return {
    id: input.id,
    session: {
      id: input.id,
      header: {
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(input.parentSession === undefined ? {} : { parentSession: input.parentSession }),
      },
      snapshotEvents: () => input.events ?? [],
    },
    cancel: () => undefined,
  }
}
