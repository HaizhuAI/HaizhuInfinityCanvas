import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from './db'
import { writeAtomic } from './fsutil'

/** Accepted upload types. Video/audio arrive with later betas but are already storable. */
export const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'weba',
  'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/opus': 'opus', 'audio/mp4': 'm4a',
  // generated downloads only (editor packages); never accepted by the upload route
  'application/zip': 'zip',
}

/** Non-standard media types some servers send, mapped to the registered type. */
export const MIME_ALIAS: Record<string, string> = { 'audio/mp3': 'audio/mpeg', 'audio/x-flac': 'audio/flac', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav' }

/** storing a file would take this workspace over its storage quota */
export class QuotaError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Content-addressed files under <dataDir>/assets/<sha256>.<ext>; ids are UUIDs in SQLite. */
export class AssetStore {
  private dir: string

  /**
   * `quotaBytes`: total size of files this workspace may store (multi-user deployments; a function so an
   * admin's change applies at once). `onUsage`: told the stored total after every change.
   */
  constructor(readonly dataDir: string, private store: Store, private opts: { quotaBytes?: number | (() => number | undefined); onUsage?: (bytes: number) => void } = {}) {
    this.dir = join(dataDir, 'assets')
    mkdirSync(this.dir, { recursive: true })
  }

  /** bytes stored and the quota (undefined = unlimited) */
  private quota() { const q = this.opts.quotaBytes; return typeof q === 'function' ? q() : q }
  usage() { return { used: this.store.totalAssetBytes(), quota: this.quota() } }
  private changed() { try { this.opts.onUsage?.(this.store.totalAssetBytes()) } catch { /* reporting must never break a save */ } }

  /** Throws on unsupported mime or content that does not match the declared image type. */
  put(bytes: Buffer, mime: string, name = 'upload', id: string = randomUUID()) {
    const q = this.quota()
    if (q !== undefined && this.store.totalAssetBytes() + bytes.length > q) {
      throw new QuotaError(`存储空间已满（上限 ${Math.round(q / 1024 / 1024)} MB）：请删除不用的画布或素材后再试`)
    }
    const { sha256, mime: m } = this.writeFile(bytes, mime)
    this.store.insertAsset({ id, sha256, mime: m, size: bytes.length, name: name.slice(0, 200) })
    this.changed()
    return { id, sha256, mime: m, size: bytes.length }
  }

  /**
   * Import an asset from a project bundle, keeping its id so graphs, results and cache keys stay
   * valid. The id is reused when it is free or already names this exact file; otherwise
   * (an id collision with different bytes) a fresh id is returned.
   */
  adopt(id: string, bytes: Buffer, mime: string, name: string): string {
    const existing = UUID.test(id) ? this.store.getAsset(id) : undefined
    if (existing) {
      const { sha256 } = this.writeFile(bytes, mime)
      return existing.sha256 === sha256 && existing.mime === (MIME_ALIAS[mime] ?? mime) ? id : this.put(bytes, mime, name).id
    }
    return this.put(bytes, mime, name, UUID.test(id) ? id : randomUUID()).id
  }

  private writeFile(bytes: Buffer, mime: string) {
    mime = MIME_ALIAS[mime] ?? mime
    const ext = MIME_EXT[mime]
    if (!ext) throw new Error(`unsupported media type: ${mime}`)
    if (mime.startsWith('image/') && !sniffImage(bytes, mime)) throw new Error('file content does not match its image type')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const file = join(this.dir, `${sha256}.${ext}`)
    // a file left half-written by a crash (older versions wrote in place) has the wrong size: rewrite it
    if (!existsSync(file) || statSync(file).size !== bytes.length) writeAtomic(file, bytes)
    return { sha256, mime }
  }

  /** Validates the id format before touching the filesystem (no path traversal). */
  get(id: string) {
    if (!UUID.test(id)) return undefined
    const meta = this.store.getAsset(id)
    if (!meta) return undefined
    const file = join(this.dir, `${meta.sha256}.${MIME_EXT[meta.mime]}`)
    return existsSync(file) ? { ...meta, file } : undefined
  }

  /** Delete a stored file: every id naming the same content, and the file on disk (frees storage). */
  remove(id: string): boolean {
    if (!UUID.test(id)) return false
    const meta = this.store.getAsset(id)
    if (!meta) return false
    this.store.deleteAssetsWithSha(meta.sha256)
    rmSync(join(this.dir, `${meta.sha256}.${MIME_EXT[meta.mime]}`), { force: true })
    this.changed()
    return true
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
