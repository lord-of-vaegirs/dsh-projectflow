import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const FILE_MODE = 0o600
const DIR_MODE = 0o700

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: DIR_MODE })
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    if ((error as NodeJS.ErrnoException).code === 'EISDIR') return true
    throw error
  }
}

/**
 * Write a complete file through a same-directory temp inode and rename.
 * Readers observe either the old or the new body. No caller-supplied path is
 * ever joined with unvalidated user text.
 */
export async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
  const directory = dirname(path)
  await ensureDir(directory)
  const temp = join(
    directory,
    `.tmp-${process.pid}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`,
  )
  let descriptor: Awaited<ReturnType<typeof open>> | undefined
  try {
    descriptor = await open(temp, 'wx', FILE_MODE)
    const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
    let offset = 0
    while (offset < bytes.byteLength) {
      const result = await descriptor.write(bytes, offset, bytes.byteLength - offset)
      offset += result.bytesWritten
    }
    await descriptor.sync()
    await descriptor.close()
    descriptor = undefined
    await rename(temp, path)
  } catch (error) {
    if (descriptor !== undefined) await descriptor.close().catch(() => undefined)
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path))
  await writeFile(path, content, { encoding: 'utf8', mode: FILE_MODE })
}

export async function removeFileIfExists(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}


export const fileModes = { file: FILE_MODE, dir: DIR_MODE } as const
