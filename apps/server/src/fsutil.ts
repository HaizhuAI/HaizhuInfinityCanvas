import { randomUUID } from 'node:crypto'
import { renameSync, rmSync, writeFileSync } from 'node:fs'

/**
 * Write to a temporary name, flush to disk, then rename: readers (and a crash at any moment) see
 * either no file or the whole file, never a partial one.
 */
export function writeAtomic(file: string, bytes: Buffer | string, mode?: number) {
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  try {
    writeFileSync(tmp, bytes, { mode, flush: true })
    renameSync(tmp, file)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}
