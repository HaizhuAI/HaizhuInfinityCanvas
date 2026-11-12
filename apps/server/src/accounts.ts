import { createRequire } from 'node:module'
import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

/**
 * Accounts for a multi-user (SaaS) deployment: email + password, cookie sessions. Only identities live
 * here; each user's canvases, models, files and history are in their own workspace database (see
 * workspaces.ts), so no query can ever mix two users' data.
 *
 * - Passwords: scrypt (N=2^15, r=8, p=1), random 16-byte salt, compared in constant time. A login for an
 *   unknown email still runs scrypt, so response time doesn't reveal which emails have accounts.
 * - Sessions: a 256-bit random token in an HttpOnly cookie; only its SHA-256 is stored, so a leaked
 *   database copy holds no usable sessions. Sliding 30-day expiry; changing the password ends every
 *   other session.
 */
export class AccountError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export interface User { id: string; email: string; createdAt: string; lastLogin?: string; disabled: boolean; isAdmin: boolean; quotaMb?: number }
export interface Usage { bytes: number; runs: number; lastRun?: string }
export interface UserRow extends User { usage: Usage }
export interface Invite { id: string; label: string; note?: string; createdAt: string; expiresAt: string; maxUses: number; uses: number; revoked: boolean; active: boolean }
/** who may create an account: anyone, only with an invite link, or nobody (the admin creates accounts) */
export type SignupMode = 'open' | 'invite' | 'closed'
export const isSignupMode = (v: unknown): v is SignupMode => v === 'open' || v === 'invite' || v === 'closed'
export const RESET_MINUTES = 30

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200
export const SESSION_DAYS = 30
const SESSIONS_PER_USER = 20
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

const SCRYPT: ScryptOptions = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))))

export function normalizeEmail(email: unknown): string {
  if (typeof email !== 'string') throw new AccountError('请填写邮箱')
  const e = email.trim().toLowerCase()
  if (e.length > 254 || !EMAIL.test(e)) throw new AccountError('邮箱格式不正确')
  return e
}

export function checkPassword(pw: unknown, email?: string): string {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) throw new AccountError(`密码至少 ${PASSWORD_MIN} 位`)
  if (pw.length > PASSWORD_MAX) throw new AccountError(`密码最多 ${PASSWORD_MAX} 位`)
  if (email && pw.toLowerCase() === email.toLowerCase()) throw new AccountError('密码不能和邮箱相同')
  if (/^(.)\1*$/.test(pw) || /^(?:0123456789|1234567890|12345678|123456789|password|qwertyui|11111111)/i.test(pw)) throw new AccountError('密码太容易被猜到，请换一个')
  return pw
}

/** scrypt$N$r$p$salt$hash (base64) */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(pw, salt, 64, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64')
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem })
  return got.length === want.length && timingSafeEqual(got, want)
}

/** a real hash of nothing, so unknown emails cost as much as known ones */
let dummy: Promise<string> | undefined
const dummyHash = () => (dummy ??= hashPassword(randomBytes(12).toString('hex')))

const sha = (token: string) => createHash('sha256').update(token).digest('hex')

function toUser(r: Record<string, unknown>): User {
  return {
    id: r.id as string, email: r.email as string, createdAt: r.created_at as string, lastLogin: (r.last_login as string) ?? undefined,
    disabled: !!r.disabled, isAdmin: !!r.is_admin, quotaMb: r.quota_mb == null ? undefined : Number(r.quota_mb),
  }
}
const nowIso = () => new Date().toISOString()

export class AccountStore {
  private db: DatabaseSyncType

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
        created_at TEXT NOT NULL, last_login TEXT, disabled INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen TEXT NOT NULL, agent TEXT
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, note TEXT, created_by TEXT, created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reset_tokens (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_tokens (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_used TEXT
      );
      CREATE TABLE IF NOT EXISTS usage (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        bytes INTEGER NOT NULL DEFAULT 0, runs INTEGER NOT NULL DEFAULT 0, last_run TEXT, updated_at TEXT
      );
    `)
    // migrations for databases created by rc.10
    const cols = (this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name)
    if (!cols.includes('is_admin')) this.db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
    if (!cols.includes('quota_mb')) this.db.exec('ALTER TABLE users ADD COLUMN quota_mb INTEGER')
  }

  // ---------- admins, quotas, settings
  setAdmin(userId: string, admin: boolean) { this.db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(admin ? 1 : 0, userId) }
  countAdmins(): number { return (this.db.prepare('SELECT count(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0').get() as { n: number }).n }
  /** HZC_ADMIN_EMAILS: these accounts are admins (applied at startup and when they sign up) */
  promoteEmails(emails: string[]) { for (const e of emails) this.db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(e.trim().toLowerCase()) }
  /** per-user storage limit in MB; undefined = the server's default */
  setQuota(userId: string, mb: number | undefined) { this.db.prepare('UPDATE users SET quota_mb = ? WHERE id = ?').run(mb ?? null, userId) }
  getSetting(key: string): string | undefined { return (this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value }
  setSetting(key: string, value: string) { this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value) }

  // ---------- usage (kept up to date by each workspace)
  recordStorage(userId: string, bytes: number) {
    this.db.prepare('INSERT INTO usage (user_id, bytes, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at').run(userId, bytes, nowIso())
  }
  recordRun(userId: string) {
    const t = nowIso()
    this.db.prepare('INSERT INTO usage (user_id, runs, last_run, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(user_id) DO UPDATE SET runs = runs + 1, last_run = excluded.last_run, updated_at = excluded.updated_at').run(userId, t, t)
  }
  usageOf(userId: string): Usage {
    const r = this.db.prepare('SELECT bytes, runs, last_run FROM usage WHERE user_id = ?').get(userId) as { bytes: number; runs: number; last_run: string | null } | undefined
    return { bytes: Number(r?.bytes ?? 0), runs: Number(r?.runs ?? 0), lastRun: r?.last_run ?? undefined }
  }

  /** accounts for the admin console, newest first; `q` filters by email */
  listUsersWithUsage(q = '', limit = 100, offset = 0): { users: UserRow[]; total: number } {
    const like = `%${q.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    const total = (this.db.prepare("SELECT count(*) AS n FROM users WHERE email LIKE ? ESCAPE '\\'").get(like) as { n: number }).n
    const rows = this.db.prepare(`SELECT u.*, coalesce(g.bytes, 0) AS u_bytes, coalesce(g.runs, 0) AS u_runs, g.last_run AS u_last_run
      FROM users u LEFT JOIN usage g ON g.user_id = u.id WHERE u.email LIKE ? ESCAPE '\\' ORDER BY u.created_at DESC LIMIT ? OFFSET ?`).all(like, Math.min(500, Math.max(1, limit)), Math.max(0, offset)) as Record<string, unknown>[]
    return { total, users: rows.map((r) => ({ ...toUser(r), usage: { bytes: Number(r.u_bytes), runs: Number(r.u_runs), lastRun: (r.u_last_run as string) ?? undefined } })) }
  }

  overview() {
    const one = (sql: string, ...a: (string | number)[]) => Number((this.db.prepare(sql).get(...a) as { n: number }).n)
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
    return {
      users: one('SELECT count(*) AS n FROM users'),
      admins: one('SELECT count(*) AS n FROM users WHERE is_admin = 1'),
      disabled: one('SELECT count(*) AS n FROM users WHERE disabled = 1'),
      active7d: one('SELECT count(*) AS n FROM users u LEFT JOIN usage g ON g.user_id = u.id WHERE u.last_login >= ? OR g.last_run >= ?', weekAgo, weekAgo),
      signups7d: one('SELECT count(*) AS n FROM users WHERE created_at >= ?', weekAgo),
      bytes: one('SELECT coalesce(sum(bytes), 0) AS n FROM usage'),
      runs: one('SELECT coalesce(sum(runs), 0) AS n FROM usage'),
    }
  }

  // ---------- invites (only a hash of the code is stored; the link is shown once)
  createInvite(o: { maxUses?: number; days?: number; note?: string; createdBy?: string }): { code: string; invite: Invite } {
    const code = randomBytes(15).toString('base64url')
    const maxUses = Math.min(1000, Math.max(1, Math.floor(o.maxUses ?? 1)))
    const days = Math.min(365, Math.max(1, Math.floor(o.days ?? 7)))
    const now = new Date()
    const id = sha(code)
    this.db.prepare('INSERT INTO invites (id, label, note, created_by, created_at, expires_at, max_uses) VALUES (?,?,?,?,?,?,?)').run(
      id, code.slice(0, 4), (o.note ?? '').slice(0, 120) || null, o.createdBy ?? null, now.toISOString(), new Date(now.getTime() + days * 86400_000).toISOString(), maxUses,
    )
    return { code, invite: this.listInvites().find((i) => i.id === id)! }
  }
  listInvites(): Invite[] {
    const now = Date.now()
    return (this.db.prepare('SELECT * FROM invites ORDER BY created_at DESC LIMIT 200').all() as Record<string, unknown>[]).map((r) => {
      const inv: Invite = {
        id: r.id as string, label: r.label as string, note: (r.note as string) ?? undefined, createdAt: r.created_at as string, expiresAt: r.expires_at as string,
        maxUses: Number(r.max_uses), uses: Number(r.uses), revoked: !!r.revoked, active: false,
      }
      inv.active = !inv.revoked && inv.uses < inv.maxUses && Date.parse(inv.expiresAt) > now
      return inv
    })
  }
  revokeInvite(id: string): boolean { return this.db.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').run(id).changes > 0 }
  /** whether an invite code can still be used (does not use it up) */
  inviteUsable(code: unknown): boolean {
    if (typeof code !== 'string' || !code || code.length > 64) return false
    const r = this.db.prepare('SELECT 1 FROM invites WHERE id = ? AND revoked = 0 AND uses < max_uses AND expires_at > ?').get(sha(code), nowIso())
    return !!r
  }
  /** use up one place on an invite; false if it was used up or revoked meanwhile */
  consumeInvite(code: string): boolean {
    return this.db.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ? AND revoked = 0 AND uses < max_uses AND expires_at > ?').run(sha(code), nowIso()).changes > 0
  }

  // ---------- password reset by email (only a hash of the token is stored)
  createResetToken(userId: string): string {
    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    this.db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(userId) // one live link at a time
    this.db.prepare('INSERT INTO reset_tokens (id, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(sha(token), userId, now.toISOString(), new Date(now.getTime() + RESET_MINUTES * 60_000).toISOString())
    return token
  }
  /** the user a reset link belongs to, if it is still valid (does not use it up) */
  resetTokenUser(token: unknown): User | undefined {
    if (typeof token !== 'string' || !token || token.length > 100) return undefined
    const r = this.db.prepare('SELECT user_id FROM reset_tokens WHERE id = ? AND used = 0 AND expires_at > ?').get(sha(token), nowIso()) as { user_id: string } | undefined
    const u = r ? this.getUser(r.user_id) : undefined
    return u && !u.disabled ? u : undefined
  }
  consumeResetToken(token: string): boolean {
    return this.db.prepare('UPDATE reset_tokens SET used = 1 WHERE id = ? AND used = 0 AND expires_at > ?').run(sha(token), nowIso()).changes > 0
  }

  countUsers(): number { return (this.db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n }

  listUsers(): User[] { return (this.db.prepare('SELECT * FROM users ORDER BY created_at').all() as Record<string, unknown>[]).map(toUser) }

  getUser(id: string): User | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    return r ? toUser(r) : undefined
  }

  findByEmail(email: string): User | undefined {
    const r = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase())
    return r ? toUser(r) : undefined
  }

  async createUser(emailIn: unknown, passwordIn: unknown): Promise<User> {
    const email = normalizeEmail(emailIn)
    const password = checkPassword(passwordIn, email)
    if (this.findByEmail(email)) throw new AccountError('这个邮箱已经注册过了，请直接登录', 409)
    const hash = await hashPassword(password)
    const id = randomUUID()
    try {
      const t = nowIso() // signing up signs in: it counts as the first login
      this.db.prepare('INSERT INTO users (id, email, password, created_at, last_login) VALUES (?,?,?,?,?)').run(id, email, hash, t, t)
    } catch {
      throw new AccountError('这个邮箱已经注册过了，请直接登录', 409) // a concurrent signup won the race
    }
    return this.getUser(id)!
  }

  /** the user, or undefined for a wrong email / password / disabled account (indistinguishable) */
  async authenticate(emailIn: unknown, password: unknown): Promise<User | undefined> {
    let email: string
    try { email = normalizeEmail(emailIn) } catch { await verifyPassword('x', await dummyHash()); return undefined }
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as Record<string, unknown> | undefined
    const pw = typeof password === 'string' && password.length <= PASSWORD_MAX ? password : ''
    const ok = await verifyPassword(pw, (row?.password as string) ?? (await dummyHash()))
    if (!row || !ok || row.disabled) return undefined
    this.db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), row.id as string)
    return toUser(row)
  }

  async setPassword(userId: string, password: unknown, keepSession?: string) {
    const u = this.getUser(userId)
    if (!u) throw new AccountError('账号不存在', 404)
    const pw = checkPassword(password, u.email)
    this.db.prepare('UPDATE users SET password = ? WHERE id = ?').run(await hashPassword(pw), userId)
    // everyone else signed in with the old password is signed out
    if (keepSession) this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, sha(keepSession))
    else this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }

  async checkCurrentPassword(userId: string, password: unknown): Promise<boolean> {
    const row = this.db.prepare('SELECT password FROM users WHERE id = ?').get(userId) as { password: string } | undefined
    return !!row && typeof password === 'string' && password.length <= PASSWORD_MAX && (await verifyPassword(password, row.password))
  }

  setDisabled(userId: string, disabled: boolean) {
    this.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, userId)
    if (disabled) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }

  deleteUser(userId: string): boolean {
    return this.db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0 // sessions cascade
  }

  // ---------- sessions
  /** a new session; returns the token for the cookie (never stored) */
  createSession(userId: string, agent?: string): string {
    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    this.db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen, agent) VALUES (?,?,?,?,?,?)').run(
      sha(token), userId, now.toISOString(), new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString(), now.toISOString(), (agent ?? '').slice(0, 200),
    )
    // keep the newest few per user
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)').run(userId, userId, SESSIONS_PER_USER)
    return token
  }

  /** the signed-in user for a session token (extends the session at most every 10 minutes) */
  sessionUser(token: string | undefined): User | undefined {
    if (!token || token.length > 100) return undefined
    const id = sha(token)
    const s = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as { user_id: string; expires_at: string; last_seen: string } | undefined
    if (!s) return undefined
    const now = Date.now()
    if (Date.parse(s.expires_at) <= now) { this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id); return undefined }
    const u = this.getUser(s.user_id)
    if (!u || u.disabled) return undefined
    if (now - Date.parse(s.last_seen) > 10 * 60_000) {
      this.db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?').run(new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86400_000).toISOString(), id)
    }
    return u
  }

  // ---------- agent access (MCP): one key per account, only its SHA-256 stored; shown once when made
  createAgentToken(userId: string): string {
    const token = `hzc_${randomBytes(32).toString('base64url')}`
    this.db.prepare('INSERT INTO agent_tokens (user_id, hash, created_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET hash = excluded.hash, created_at = excluded.created_at, last_used = NULL')
      .run(userId, sha(token), nowIso())
    return token
  }
  agentTokenInfo(userId: string): { createdAt: string; lastUsed?: string } | undefined {
    const r = this.db.prepare('SELECT created_at, last_used FROM agent_tokens WHERE user_id = ?').get(userId) as { created_at: string; last_used: string | null } | undefined
    return r ? { createdAt: r.created_at, lastUsed: r.last_used ?? undefined } : undefined
  }
  revokeAgentToken(userId: string) { this.db.prepare('DELETE FROM agent_tokens WHERE user_id = ?').run(userId) }
  /** the (enabled) account an agent key belongs to */
  agentTokenUser(token: string | undefined): User | undefined {
    if (!token || token.length > 200) return undefined
    const r = this.db.prepare('SELECT user_id, last_used FROM agent_tokens WHERE hash = ?').get(sha(token)) as { user_id: string; last_used: string | null } | undefined
    const u = r ? this.getUser(r.user_id) : undefined
    if (!u || u.disabled) return undefined
    if (!r!.last_used || Date.now() - Date.parse(r!.last_used) > 10 * 60_000) this.db.prepare('UPDATE agent_tokens SET last_used = ? WHERE user_id = ?').run(nowIso(), u.id)
    return u
  }

  endSession(token: string | undefined) { if (token) this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sha(token)) }

  endAllSessions(userId: string) { this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId) }

  pruneSessions() {
    const t = nowIso()
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(t)
    this.db.prepare('DELETE FROM reset_tokens WHERE expires_at <= ? OR used = 1').run(t)
  }

  backupTo(file: string) { this.db.prepare('VACUUM INTO ?').run(file) }

  close() { this.db.close() }
}

/** tables an accounts database must have (backup / recovery check) */
export const ACCOUNT_TABLES = ['users', 'sessions']

/** a password the user is asked to change: 18 characters from an unambiguous alphabet */
export function oneTimePassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return [...randomBytes(18)].map((b) => abc[b % abc.length]).join('')
}
