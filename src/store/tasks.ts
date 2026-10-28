import { readJsonIfExists, writeJsonAtomic } from '../fs/json.js'
import type { TaskCheckpoint, TaskRecord } from '../shared/contracts.js'
import { nowIso } from '../util/time.js'
import { newTaskId } from '../util/ids.js'

export interface TasksDocument {
  schemaVersion: 1
  tasks: Record<string, TaskRecord>
}

export async function readTasks(path: string): Promise<TaskRecord[]> {
  const value = await readJsonIfExists<TasksDocument>(path)
  if (value === undefined || value.schemaVersion !== 1 || typeof value.tasks !== 'object' || value.tasks === null) {
    return []
  }
  return Object.values(value.tasks).filter(isTask)
}

function isTask(value: unknown): value is TaskRecord {
  if (typeof value !== 'object' || value === null) return false
  const task = value as Partial<TaskRecord>
  return (
    typeof task.id === 'string' &&
    typeof task.projectId === 'string' &&
    typeof task.sessionId === 'string' &&
    typeof task.status === 'string' &&
    typeof task.checkpoint === 'object' &&
    task.checkpoint !== null
  )
}

export function emptyCheckpoint(): TaskCheckpoint {
  return {
    summary: '',
    did: '',
    next: '',
    blocked: '',
    lastTool: '',
    pendingTools: [],
    turn: 0,
    step: 0,
    updatedAt: nowIso(),
  }
}

export function newTask(input: {
  projectId: string
  sessionId: string
  title?: string
  source?: 'system' | 'user'
  priority?: number
}): TaskRecord {
  const time = nowIso()
  return {
    id: newTaskId(),
    projectId: input.projectId,
    sessionId: input.sessionId,
    title: input.title ?? '',
    status: 'queued',
    source: input.source ?? 'user',
    priority: input.priority ?? 100,
    createdAt: time,
    updatedAt: time,
    checkpoint: emptyCheckpoint(),
    tags: [],
  }
}

export async function writeTasks(path: string, tasks: TaskRecord[]): Promise<void> {
  const document: TasksDocument = {
    schemaVersion: 1,
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
  }
  await writeJsonAtomic(path, document)
}

export function upsertTask(tasks: TaskRecord[], task: TaskRecord): TaskRecord[] {
  const index = tasks.findIndex((candidate) => candidate.id === task.id)
  if (index < 0) return [...tasks, task]
  const next = [...tasks]
  next[index] = task
  return next
}

export function activeTaskFor(
  tasks: TaskRecord[],
  sessionId: string,
): TaskRecord | undefined {
  return tasks
    .filter((task) => task.sessionId === sessionId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}

export function trimTasks(tasks: TaskRecord[], limit: number): TaskRecord[] {
  if (tasks.length <= limit) return tasks
  return [...tasks]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
}
