import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from './db'

/** Accepted upload types. Video/audio arrive with later betas but are already storable. */
export const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'weba',
  'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/opus': 'opus', 'audio/mp4': 'm4a',
}

/** Non-standard media types some servers send, mapped to the registered type. */
export const MIME_ALIAS: Record<string, string> = { 'audio/mp3': 'audio/mpeg', 'audio/x-flac': 'audio/flac', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Content-addressed files under <dataDir>/assets/<sha256>.<ext>; ids are UUIDs in SQLite. */
export class AssetStore {
  private dir: string

  constructor(readonly dataDir: string, private store: Store) {
    this.dir = join(dataDir, 'assets')
    mkdirSync(this.dir, { recursive: true })
  }

  /** Throws on unsupported mime or content that does not match the declared image type. */
  put(bytes: Buffer, mime: string, name = 'upload') {
    mime = MIME_ALIAS[mime] ?? mime
    const ext = MIME_EXT[mime]
    if (!ext) throw new Error(`unsupported media type: ${mime}`)
    if (mime.startsWith('image/') && !sniffImage(bytes, mime)) throw new Error('file content does not match its image type')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const file = join(this.dir, `${sha256}.${ext}`)
    if (!existsSync(file)) writeFileSync(file, bytes)
    const id = randomUUID()
    this.store.insertAsset({ id, sha256, mime, size: bytes.length, name: name.slice(0, 200) })
    return { id, sha256, mime, size: bytes.length }
  }

  /** Validates the id format before touching the filesystem (no path traversal). */
  get(id: string) {
    if (!UUID.test(id)) return undefined
    const meta = this.store.getAsset(id)
    if (!meta) return undefined
    const file = join(this.dir, `${meta.sha256}.${MIME_EXT[meta.mime]}`)
    return existsSync(file) ? { ...meta, file } : undefined
  }

  readBase64(id: string): { mime: string; base64: string } {
    const a = this.get(id)
    if (!a) throw new Error(`asset not found: ${id}`)
    return { mime: a.mime, base64: readFileSync(a.file).toString('base64') }
  }
}

function sniffImage(b: Buffer, mime: string): boolean {
  const hex = b.subarray(0, 12).toString('hex')
  switch (mime) {
    case 'image/png': return hex.startsWith('89504e470d0a1a0a')
    case 'image/jpeg': return hex.startsWith('ffd8ff')
    case 'image/gif': return hex.startsWith('47494638')
    case 'image/webp': return hex.startsWith('52494646') && b.subarray(8, 12).toString('ascii') === 'WEBP'
    default: return false
  }
}
