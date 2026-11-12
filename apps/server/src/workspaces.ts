import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Store } from './db'
import type { SecretBox } from './secrets'
import { AssetStore } from './assets'
import { SkillStore } from './skills'
import { Engine } from './engine'
import { Backups, type RecoveryNote } from './backup'

/**
 * Everything one person works with: their canvases, model profiles (with encrypted API keys), files,
 * imported skills, run engine and backups. In a multi-user deployment each user gets their own folder
 * (<data>/users/<id>/) with its own database, so isolation does not depend on every query remembering
 * a user filter — one user's requests simply never touch another user's database or files.
 */
export interface Workspace {
  id: string
  dir: string
  store: Store
  assets: AssetStore
  skills: SkillStore
  engine: Engine
  backups: Backups
  /** set when this workspace's database was damaged and restored from a backup when it was opened */
  recovery?: RecoveryNote
}

export interface WorkspaceOptions {
  secrets: SecretBox
  builtinSkills?: string
  maxParallel?: number
  /** storage quota per workspace, in bytes */
  quotaBytes?: number
  backupKeep?: number
  backupIntervalMs?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Open a workspace in `dir`: recover a damaged database, open it, start its backups. */
export function openWorkspace(id: string, dir: string, o: WorkspaceOptions): Workspace & { stopBackups: () => void } {
  const dbFile = join(dir, 'hzc.sqlite')
  const backups = new Backups(dir, { keep: o.backupKeep, intervalMs: o.backupIntervalMs })
  const recovery = backups.recoverIfDamaged(dbFile)
  const store = new Store(dbFile, o.secrets)
  const assets = new AssetStore(dir, store, { quotaBytes: o.quotaBytes })
  const skills = new SkillStore(o.builtinSkills, dir)
  const engine = new Engine(store, assets, { skills, maxParallel: o.maxParallel })
  const stopBackups = backups.schedule(store, () => undefined)
  return { id, dir, store, assets, skills, engine, backups, recovery, stopBackups }
}

/** Opens user workspaces on demand and closes ones nobody has used for a while. */
export class Workspaces {
  private open = new Map<string, Workspace & { stopBackups: () => void; lastUsed: number }>()
  private sweeper: ReturnType<typeof setInterval>

  constructor(private root: string, private o: WorkspaceOptions & { idleMs?: number; maxOpen?: number }) {
    this.sweeper = setInterval(() => this.closeIdle(), 5 * 60_000)
    this.sweeper.unref()
  }

  dirOf(userId: string) {
    if (!UUID.test(userId)) throw new Error('invalid user id') // ids name folders: never anything else
    return join(this.root, 'users', userId)
  }

  get(userId: string): Workspace {
    let w = this.open.get(userId)
    if (!w) {
      w = { ...openWorkspace(userId, this.dirOf(userId), this.o), lastUsed: Date.now() }
      this.open.set(userId, w)
      this.closeIdle(this.o.maxOpen ?? 200)
    }
    w.lastUsed = Date.now()
    return w
  }

  /** close workspaces idle for `idleMs` (and the least recently used beyond `keep`), never busy ones */
  closeIdle(keep = Infinity) {
    const idleMs = this.o.idleMs ?? 30 * 60_000
    const byAge = [...this.open.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    let excess = byAge.length - keep
    for (const w of byAge) {
      if (w.engine.busy) continue
      if (Date.now() - w.lastUsed > idleMs || excess > 0) { this.close(w.id); excess-- }
    }
  }

  private close(userId: string) {
    const w = this.open.get(userId)
    if (!w) return
    this.open.delete(userId)
    w.stopBackups()
    try { w.store.close() } catch { /* already closed */ }
  }

  /** Delete a user's workspace and all its files (account deletion). */
  remove(userId: string) {
    const dir = this.dirOf(userId)
    const w = this.open.get(userId)
    w?.engine.cancelAll()
    this.close(userId)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }

  closeAll() {
    clearInterval(this.sweeper)
    for (const id of [...this.open.keys()]) this.close(id)
  }

  get openCount() { return this.open.size }
}
