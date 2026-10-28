import { open, readFile, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ensureDir } from './atomic.js'
import { ProjectError } from '../errors.js'

interface LockRecord {
  pid: number
  hostname: string
  startedAt: number
  nonce: string
}

export interface LockOptions {
  waitMs?: number
  staleMs?: number
  signal?: AbortSignal
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readLock(path: string): Promise<LockRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<LockRecord>
    if (
      typeof value.pid === 'number' &&
      typeof value.hostname === 'string' &&
      typeof value.startedAt === 'number' &&
      typeof value.nonce === 'string'
    ) {
      return value as LockRecord
    }
  } catch {
    // A partial record is treated as contention, never as a free lock.
  }
  return undefined
}

async function tryTakeover(path: string, staleMs: number): Promise<boolean> {
  const record = await readLock(path)
  if (record === undefined) {
    // A brand-new lock may be mid-write. Only take it over after a grace period.
    try {
      const { stat } = await import('node:fs/promises')
      const info = await stat(path)
      if (Date.now() - info.mtimeMs < Math.min(staleMs, 2_000)) return false
    } catch {
      return true
    }
    await unlink(path).catch(() => undefined)
    return true
  }
  const age = Date.now() - record.startedAt
  const sameHost = record.hostname === hostname()
  const dead = sameHost && !processAlive(record.pid)
  if (!dead && age < staleMs) return false
  // Re-read before unlinking so a fast successor's fresh lock is not removed.
  const current = await readLock(path)
  if (current?.nonce !== record.nonce) return false
  await unlink(path).catch(() => undefined)
  return true
}

/**
 * Serialize one read-modify-write cycle through a `wx`-created sibling lock.
 * The operation must re-read the file after acquisition; the lock does not
 * make a stale in-memory view safe.
 */
export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const waitMs = options.waitMs ?? 5_000
  const staleMs = options.staleMs ?? 60_000
  await ensureDir(dirname(lockPath))
  const deadline = Date.now() + waitMs
  let attempt = 0
  for (;;) {
    options.signal?.throwIfAborted()
    let descriptor: Awaited<ReturnType<typeof open>> | undefined
    const record: LockRecord = {
      pid: process.pid,
      hostname: hostname(),
      startedAt: Date.now(),
      nonce: randomBytes(12).toString('hex'),
    }
    try {
      descriptor = await open(lockPath, 'wx', 0o600)
      await descriptor.writeFile(`${JSON.stringify(record)}\n`, 'utf8')
      await descriptor.sync()
      await descriptor.close()
      descriptor = undefined
      try {
        return await operation()
      } finally {
        const current = await readLock(lockPath)
        if (current?.nonce === record.nonce) await unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      if (descriptor !== undefined) await descriptor.close().catch(() => undefined)
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await tryTakeover(lockPath, staleMs)) continue
      if (Date.now() >= deadline) {
        throw new ProjectError(
          'LOCK_TIMEOUT',
          `Another session is writing this project (waited ${waitMs} ms).`,
          'Retry in a few seconds; if no session is active, remove the stale .lock file.',
        )
      }
      attempt += 1
      const backoff = Math.min(250, 10 * 2 ** Math.min(attempt, 5))
      await sleep(backoff + Math.floor(Math.random() * 20))
    }
  }
}
