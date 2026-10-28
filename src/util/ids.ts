import { randomBytes } from 'node:crypto'

const HEX = '0123456789abcdef'

function randomHex(bytes: number): string {
  const buffer = randomBytes(bytes)
  let value = ''
  for (const byte of buffer) {
    value += HEX[byte >>> 4] ?? '0'
    value += HEX[byte & 0x0f] ?? '0'
  }
  return value
}

/** Stable, path-safe project identity. The name is display data, never a path. */
export function newProjectId(): string {
  return `prj_${randomHex(16)}`
}

export function newEntryId(prefix: 'mem' | 'con'): string {
  return `${prefix}_${randomHex(8)}`
}

export function newMemberId(): string {
  return `wsm_${randomHex(8)}`
}

export function newTaskId(): string {
  return `task_${randomHex(8)}`
}

export function newNonce(): string {
  return randomHex(12)
}

export function isProjectId(value: string): boolean {
  return /^prj_[0-9a-f]{32}$/u.test(value)
}
