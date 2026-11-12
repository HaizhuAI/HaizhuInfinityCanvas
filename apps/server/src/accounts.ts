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

export interface User { id: string; email: string; createdAt: string; lastLogin?: string; disabled: boolean }

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
  return { id: r.id as string, email: r.email as string, createdAt: r.created_at as string, lastLogin: (r.last_login as string) ?? undefined, disabled: !!r.disabled }
}

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
    `)
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
      this.db.prepare('INSERT INTO users (id, email, password, created_at) VALUES (?,?,?,?)').run(id, email, hash, new Date().toISOString())
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

  endSession(token: string | undefined) { if (token) this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sha(token)) }

  endAllSessions(userId: string) { this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId) }

  pruneSessions() { this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString()) }

  backupTo(file: string) { this.db.prepare('VACUUM INTO ?').run(file) }

  close() { this.db.close() }
}

/** tables an accounts database must have (backup / recovery check) */
export const ACCOUNT_TABLES = ['users', 'sessions']
