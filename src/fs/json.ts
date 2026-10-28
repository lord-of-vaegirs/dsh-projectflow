import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic.js'
import { ProjectError } from '../errors.js'

export async function readJson<T>(path: string): Promise<T> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new ProjectError('CORRUPT_DATA', `Missing project data file: ${path}.`)
    }
    throw error
  }
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new ProjectError(
      'CORRUPT_DATA',
      `Project data is not valid JSON: ${path} (${(error as Error).message}).`,
      'Nothing was overwritten. Restore the file or move the project out of the data root.',
    )
  }
}

export async function readJsonIfExists<T>(path: string): Promise<T | undefined> {
  try {
    return await readJson<T>(path)
  } catch (error) {
    if (error instanceof ProjectError && error.message.startsWith('Missing project data file')) {
      return undefined
    }
    throw error
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectError('CORRUPT_DATA', `${label} must be a JSON object.`)
  }
  return value as Record<string, unknown>
}
