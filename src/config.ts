import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { ProjectFlowConfigInput, ProjectLimits } from './shared/contracts.js'

export interface ProjectFlowConfig {
  projectsDir: string
  contextBudgetTokens: number
  lockWaitMs: number
  taskTracking: boolean
  rpc: boolean
  limits: ProjectLimits
}

export const DEFAULT_LIMITS: ProjectLimits = {
  memoryBytes: 24 * 1024,
  conventionsBytes: 16 * 1024,
  decisionsBytes: 32 * 1024,
  progressLines: 512,
  progressBytes: 256 * 1024,
  refsEntries: 200,
  sessionsEntries: 2_000,
  tasksEntries: 200,
  taskEventsLines: 1_000,
  memoryEntryBytes: 4 * 1024,
  conventionEntryBytes: 4 * 1024,
  decisionEntryBytes: 8 * 1024,
  progressLineBytes: 4 * 1024,
  refNoteBytes: 2 * 1024,
  archiveRatio: 0.8,
}

/**
 * Resolve the host's data root. The plugin never reads or writes the current
 * working directory; `$DSH_HOME/projects` is the only default location.
 */
export function defaultProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME?.trim()
  const home = configured !== undefined && configured !== '' ? configured : join(homedir(), '.dsh')
  return join(resolve(home), 'projects')
}

function positiveInteger(name: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`dsh-projectflow: ${name} must be a positive integer`)
  }
  return value
}

function mergeLimits(input: Partial<ProjectLimits> | undefined): ProjectLimits {
  if (input === undefined) return { ...DEFAULT_LIMITS }
  const limits = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof ProjectLimits>) {
    const value = input[key]
    if (value === undefined) continue
    if (value <= 0) throw new Error(`dsh-projectflow: limits.${key} must be positive`)
    limits[key] = value
  }
  if (limits.archiveRatio <= 0 || limits.archiveRatio >= 1) {
    throw new Error('dsh-projectflow: limits.archiveRatio must be between 0 and 1')
  }
  return limits
}

export function resolveConfig(input: ProjectFlowConfigInput | undefined): ProjectFlowConfig {
  const raw = input ?? {}
  const projectsDir = raw.projectsDir === undefined ? defaultProjectsDir() : raw.projectsDir.trim()
  if (projectsDir === '') throw new Error('dsh-projectflow: projectsDir must not be empty')
  if (!isAbsolute(projectsDir)) throw new Error('dsh-projectflow: projectsDir must be an absolute path')
  const contextBudgetTokens = positiveInteger(
    'contextBudgetTokens',
    raw.contextBudgetTokens,
    1_200,
  )
  if (contextBudgetTokens < 200 || contextBudgetTokens > 4_000) {
    throw new Error('dsh-projectflow: contextBudgetTokens must be between 200 and 4000')
  }
  const lockWaitMs = positiveInteger('lockWaitMs', raw.lockWaitMs, 5_000)
  if (lockWaitMs < 100 || lockWaitMs > 60_000) {
    throw new Error('dsh-projectflow: lockWaitMs must be between 100 and 60000')
  }
  return {
    projectsDir: resolve(projectsDir),
    contextBudgetTokens,
    lockWaitMs,
    taskTracking: raw.taskTracking !== false,
    rpc: raw.rpc !== false,
    limits: mergeLimits(raw.limits),
  }
}
