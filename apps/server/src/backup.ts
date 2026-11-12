import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
/** anything that can write a consistent copy of its database (Store, AccountStore) */
export interface BackupSource { backupTo(file: string): void }

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

/**
 * Database redundancy. Everything a user builds (canvases, model setups, result history) lives in one
 * SQLite file, so it gets two safety nets:
 *
 * - Rotating backups: a consistent copy (`VACUUM INTO`) at startup when the newest one is stale and then
 *   every few hours, kept in <dataDir>/backups (the newest `keep`). Writing to a temporary name and
 *   renaming means a crash mid-backup never leaves a half-written file that looks like a backup.
 * - Startup check: before the server opens the database it runs `PRAGMA quick_check`. A damaged file
 *   (disk error, power loss on a bad drive, a sync tool writing over it) is moved aside, never deleted,
 *   and the newest backup that passes the same check takes its place. The recovery is reported in
 *   /api/system so Settings can tell the user what happened.
 */
export interface BackupInfo { name: string; size: number; createdAt: string }
export interface RecoveryNote {
  at: string
  /** what was wrong with the database file */
  problem: string
  /** the backup that was restored; absent when none was usable (the app started with an empty database) */
  restoredFrom?: string
  /** where the damaged file was kept */
  keptAs?: string
}

/** <prefix>-<UTC time to the millisecond>.sqlite: names sort in time order */
const nameRe = (prefix: string) => new RegExp(`^${prefix}-(\\d{8})T(\\d{6})(\\d{3})?Z\\.sqlite$`)

/** tables a canvas database must have */
export const CANVAS_TABLES = ['projects', 'profiles']

const stamp = (d = new Date()) => d.toISOString().replace(/[-:.]/g, '')

/**
 * 'ok'; 'damaged' with the reason (corrupt, not a database, not ours); or 'unknown' when the file could
 * not be checked for another reason (locked by another process, permissions) — never treated as damage.
 */
export type FileCheck = { state: 'ok' } | { state: 'damaged' | 'unknown'; reason: string }

const SQLITE_CORRUPT = 11
const SQLITE_NOTADB = 26

export function checkDatabaseFile(file: string, tables: string[] = CANVAS_TABLES): FileCheck {
  let db: InstanceType<typeof DatabaseSync> | undefined
  try {
    db = new DatabaseSync(file, { readOnly: true })
    db.exec('PRAGMA busy_timeout = 5000')
    const rows = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[]
    const res = rows.map((r) => r.quick_check).join('; ')
    if (res !== 'ok') return { state: 'damaged', reason: `完整性检查未通过：${res.slice(0, 200)}` }
    // the file opens and is consistent; it must also be ours (an empty or foreign file is not a backup)
    const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name))
    return tables.every((t) => names.has(t)) ? { state: 'ok' } : { state: 'damaged', reason: '文件是空的或不是海柱无限画布的数据' }
  } catch (e) {
    const code = Number((e as { errcode?: number }).errcode) & 0xff
    const reason = (e as Error).message
    return code === SQLITE_CORRUPT || code === SQLITE_NOTADB ? { state: 'damaged', reason: `无法读取：${reason}` } : { state: 'unknown', reason }
  } finally {
    try { db?.close() } catch { /* ignore */ }
  }
}

export class Backups {
  readonly dir: string
  private timer?: ReturnType<typeof setInterval>

  private prefix: string
  private name: RegExp
  private tables: string[]

  /** `prefix` names the files (hzc-…, accounts-…); `tables` are the ones a usable copy must have */
  constructor(dataDir: string, private opts: { keep?: number; intervalMs?: number; prefix?: string; tables?: string[] } = {}) {
    this.dir = join(dataDir, 'backups')
    this.prefix = opts.prefix ?? 'hzc'
    this.name = nameRe(this.prefix)
    this.tables = opts.tables ?? CANVAS_TABLES
  }

  /** how many backups are kept (a bad setting falls back to 14 — it must never prune everything) */
  get keep() { const k = this.opts.keep; return k !== undefined && Number.isInteger(k) && k >= 1 ? Math.min(k, 1000) : 14 }
  /** backup interval (a bad setting falls back to 6 h; never under 15 min) */
  get intervalMs() { const i = this.opts.intervalMs; return i !== undefined && Number.isFinite(i) && i > 0 ? Math.max(15 * 60_000, i) : 6 * 3600_000 }

  /** newest first */
  list(): BackupInfo[] {
    if (!existsSync(this.dir)) return []
    const out: BackupInfo[] = []
    for (const name of readdirSync(this.dir)) {
      const m = this.name.exec(name)
      if (!m) continue
      try {
        const st = statSync(join(this.dir, name))
        const [, d, t, ms] = m as unknown as [string, string, string, string | undefined]
        const createdAt = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.${ms ?? '000'}Z`
        out.push({ name, size: st.size, createdAt })
      } catch { /* removed meanwhile */ }
    }
    return out.sort((a, b) => (a.name < b.name ? 1 : -1))
  }

  /** Write a consistent copy of the live database, then drop the oldest beyond `keep`. */
  create(store: BackupSource): BackupInfo {
    mkdirSync(this.dir, { recursive: true })
    const now = new Date()
    while (existsSync(join(this.dir, `${this.prefix}-${stamp(now)}.sqlite`))) now.setTime(now.getTime() + 1)
    const name = `${this.prefix}-${stamp(now)}.sqlite`
    const tmp = join(this.dir, `.${name}.partial`)
    rmSync(tmp, { force: true })
    try {
      store.backupTo(tmp)
      renameSync(tmp, join(this.dir, name))
    } catch (e) {
      rmSync(tmp, { force: true })
      throw e
    }
    const info = { name, size: statSync(join(this.dir, name)).size, createdAt: now.toISOString() }
    this.prune()
    return info
  }

  prune() {
    for (const b of this.list().slice(this.keep)) rmSync(join(this.dir, b.name), { force: true })
    // leftovers of a backup interrupted by a crash
    if (existsSync(this.dir)) for (const n of readdirSync(this.dir)) if (n.endsWith('.partial')) rmSync(join(this.dir, n), { force: true })
  }

  /** Back up now if the newest backup is older than the interval, then on every interval. Returns a stop function. */
  schedule(store: BackupSource, log: (msg: string) => void = console.log): () => void {
    const run = (why: string) => {
      try {
        const b = this.create(store)
        log(`[hzc] database backup (${why}): ${b.name}`)
      } catch (e) {
        console.error('[hzc] database backup failed:', e)
      }
    }
    const newest = this.list()[0]
    if (!newest || Date.now() - Date.parse(newest.createdAt) > this.intervalMs) run('startup')
    this.timer = setInterval(() => run('scheduled'), this.intervalMs)
    this.timer.unref()
    return () => clearInterval(this.timer)
  }

  /**
   * Run before opening the database. When the file is damaged it is moved aside (with its WAL files)
   * and the newest good backup is copied into its place. Returns what happened, or undefined when the
   * file was fine (or did not exist yet).
   */
  recoverIfDamaged(dbFile: string): RecoveryNote | undefined {
    if (!existsSync(dbFile)) return undefined
    const check = checkDatabaseFile(dbFile, this.tables)
    if (check.state === 'unknown') console.error(`[hzc] could not check the database (${check.reason}); opening it as it is`)
    if (check.state !== 'damaged') return undefined
    const problem = check.reason
    const at = new Date().toISOString()
    const keptAs = `${dbFile}.damaged-${stamp()}`
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(dbFile + suffix)) renameSync(dbFile + suffix, keptAs + suffix)
    }
    console.error(`[hzc] the database was damaged (${problem}); kept it as ${basename(keptAs)}`)
    for (const b of this.list()) {
      const file = join(this.dir, b.name)
      if (checkDatabaseFile(file, this.tables).state !== 'ok') { console.error(`[hzc] backup ${b.name} is not usable either`); continue }
      copyFileSync(file, `${dbFile}.restoring`)
      renameSync(`${dbFile}.restoring`, dbFile)
      console.error(`[hzc] restored the database from backup ${b.name}`)
      return { at, problem, restoredFrom: b.name, keptAs: basename(keptAs) }
    }
    console.error('[hzc] no usable backup: starting with an empty database')
    return { at, problem, keptAs: basename(keptAs) }
  }
}
