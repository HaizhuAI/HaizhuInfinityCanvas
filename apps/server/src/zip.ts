import { crc32, inflateRawSync } from 'node:zlib'

/**
 * Minimal ZIP support for project bundles (.hzc) and editor packages. Writing uses the "stored"
 * method (media is already compressed), one entry at a time so a large bundle can stream. Reading
 * accepts stored and deflated entries so a bundle re-zipped by another tool still imports.
 * No ZIP64: entries and archives must stay under 4 GB.
 */

export class ZipError extends Error {}

export interface ZipInput {
  name: string
  /** bytes, or a loader called only when this entry is written (keeps memory to one file) */
  data: Buffer | (() => Buffer)
}

export const ZIP_MAX = 0xffffffff

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** Yields the archive as a sequence of chunks. */
export function* zipChunks(entries: Iterable<ZipInput>, mtime = new Date()): Generator<Buffer> {
  const { time, date } = dosTime(mtime)
  const central: Buffer[] = []
  let offset = 0
  let count = 0
  for (const e of entries) {
    const data = typeof e.data === 'function' ? e.data() : e.data
    const name = Buffer.from(e.name, 'utf8')
    if (offset + 30 + name.length + data.length > ZIP_MAX) throw new ZipError('archive larger than 4 GB')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4) // made by
    cd.writeUInt16LE(20, 6) // needed
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt16LE(time, 12)
    cd.writeUInt16LE(date, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    // extra, comment, disk, internal attrs, external attrs = 0
    cd.writeUInt32LE(offset, 42)
    central.push(cd, name)
    yield local
    yield name
    yield data
    offset += 30 + name.length + data.length
    count++
  }
  if (count > 0xffff) throw new ZipError('too many files for one archive')
  const dir = Buffer.concat(central)
  if (offset + dir.length > ZIP_MAX) throw new ZipError('archive larger than 4 GB')
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(count, 8)
  end.writeUInt16LE(count, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  yield dir
  yield end
}

export const zipBuffer = (entries: Iterable<ZipInput>) => Buffer.concat([...zipChunks(entries)])

export interface ZipEntry { name: string; data: Buffer }

/**
 * Reads every file entry. Bounded: at most `maxEntries` entries and `maxTotal` uncompressed bytes,
 * every entry is CRC-checked, and inflation never produces more than the declared size.
 */
export function readZip(buf: Buffer, limits: { maxEntries?: number; maxTotal?: number } = {}): ZipEntry[] {
  const maxEntries = limits.maxEntries ?? 10_000
  const maxTotal = limits.maxTotal ?? 4 * 1024 ** 3
  try {
    let eocd = -1
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) throw new ZipError('not a zip archive')
    const count = buf.readUInt16LE(eocd + 10)
    const dirSize = buf.readUInt32LE(eocd + 12)
    const dirOff = buf.readUInt32LE(eocd + 16)
    if (count === 0xffff || dirOff === ZIP_MAX) throw new ZipError('ZIP64 archives are not supported')
    if (count > maxEntries) throw new ZipError('too many files in archive')
    if (dirOff + dirSize > eocd) throw new ZipError('corrupt archive (central directory)')
    const out: ZipEntry[] = []
    let p = dirOff
    let total = 0
    for (let k = 0; k < count; k++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('corrupt archive (entry header)')
      const flags = buf.readUInt16LE(p + 8)
      const method = buf.readUInt16LE(p + 10)
      const crc = buf.readUInt32LE(p + 16)
      const csize = buf.readUInt32LE(p + 20)
      const usize = buf.readUInt32LE(p + 24)
      const nlen = buf.readUInt16LE(p + 28)
      const xlen = buf.readUInt16LE(p + 30)
      const clen = buf.readUInt16LE(p + 32)
      const lho = buf.readUInt32LE(p + 42)
      const name = buf.toString('utf8', p + 46, p + 46 + nlen)
      p += 46 + nlen + xlen + clen
      if (name.endsWith('/')) continue
      if (flags & 1) throw new ZipError('encrypted archives are not supported')
      total += usize
      if (total > maxTotal) throw new ZipError('archive too large')
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new ZipError('corrupt archive (local header)')
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28)
      if (start + csize > buf.length) throw new ZipError('corrupt archive (truncated)')
      const raw = buf.subarray(start, start + csize)
      let data: Buffer
      if (method === 0) data = raw
      else if (method === 8) data = usize === 0 ? Buffer.alloc(0) : inflateRawSync(raw, { maxOutputLength: usize })
      else throw new ZipError(`unsupported compression method ${method}`)
      if (data.length !== usize || crc32(data) !== crc) throw new ZipError(`corrupt archive (${name})`)
      out.push({ name, data })
    }
    return out
  } catch (e) {
    if (e instanceof ZipError) throw e
    throw new ZipError(`corrupt archive (${(e as Error).message})`)
  }
}
