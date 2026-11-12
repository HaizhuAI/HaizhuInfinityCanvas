import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_VERSION, buildApp, type AppOptions } from './app'
import { Store } from './db'
import { SecretBox } from './secrets'
import { AssetStore } from './assets'
import { Engine } from './engine'
import { SkillStore } from './skills'
import { existsSync, rmSync } from 'node:fs'
import { AgentAccess } from './agent'
import { writeAtomic } from './fsutil'
import { Backups } from './backup'
import { ACCOUNT_TABLES, AccountStore, isSignupMode } from './accounts'
import { smtpMailer } from './mail'
import { Workspaces } from './workspaces'
import { runAdmin } from './admin'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(process.env.HZC_DATA_DIR ?? join(process.cwd(), 'data'))
const port = Number(process.env.PORT ?? 8787)
// Desktop shell keeps this on loopback; for WebUI/Docker set HZC_HOST=0.0.0.0 AND HZC_TOKEN (one user)
// or HZC_ACCOUNTS=1 (sign-up / sign-in, one private workspace per user)
const host = process.env.HZC_HOST ?? '127.0.0.1'
const accessToken = process.env.HZC_TOKEN || undefined
const accountsMode = process.env.HZC_ACCOUNTS === '1'
const allowedHosts = (process.env.HZC_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)
const loopback = host === '127.0.0.1' || host === 'localhost'

// the desktop app hands over the keychain-unsealed master key; keep it out of the environment afterwards
const masterKey = process.env.HZC_MASTER_KEY || undefined
delete process.env.HZC_MASTER_KEY
const secrets = () => new SecretBox(join(dataDir, 'master.key'), masterKey)

// operator commands (accounts mode): `node index.mjs admin …`
if (process.argv[2] === 'admin') process.exit(await runAdmin(process.argv.slice(3), dataDir, secrets))

if (!loopback) {
  if (accountsMode) {
    // sign-in protects the data; the Host check is what keeps other web sites out (DNS rebinding)
    if (!allowedHosts.length) {
      console.error('[hzc] HZC_ACCOUNTS=1 on a non-loopback address needs HZC_ALLOWED_HOSTS (the domain / address people open, e.g. canvas.example.com)')
      process.exit(1)
    }
  } else if (!accessToken) {
    console.error('[hzc] refusing to listen on a non-loopback address without HZC_TOKEN set (or HZC_ACCOUNTS=1 for sign-in accounts)')
    process.exit(1)
  }
  // reachable by others: a short or copied-from-the-example token is as good as none
  if (accessToken && (accessToken.length < 16 || /^change-me/i.test(accessToken))) {
    console.error('[hzc] HZC_TOKEN is too weak for a non-loopback address: use at least 16 random characters (e.g. `openssl rand -hex 24`), not the example value')
    process.exit(1)
  }
}
// many users share this server: their model endpoints must not reach into its own network, unless the
// operator explicitly allows it
if (accountsMode && process.env.HZC_BLOCK_PRIVATE_NETWORK === undefined) process.env.HZC_BLOCK_PRIVATE_NETWORK = '1'

// (invalid values fall back to the defaults inside Backups)
const backupOpts = {
  keep: process.env.HZC_BACKUP_KEEP ? Number(process.env.HZC_BACKUP_KEEP) : undefined,
  intervalMs: process.env.HZC_BACKUP_HOURS ? Number(process.env.HZC_BACKUP_HOURS) * 3600_000 : undefined,
}
const webDir = process.env.HZC_WEB_DIR ?? resolve(here, '../../web/dist')
// built-in skills sit next to the bundle (dist/skills) or, in dev, at apps/server/skills
const builtinSkills = process.env.HZC_SKILLS_DIR ?? [resolve(here, 'skills'), resolve(here, '../skills')].find((d) => existsSync(d))
// HZC_MAX_PARALLEL: how many model calls may run at once (1–8, default 4; 1 = one node at a time)
const maxParallel = process.env.HZC_MAX_PARALLEL ? Number(process.env.HZC_MAX_PARALLEL) : undefined
const common = { webDir, accessToken, allowedHosts, hsts: process.env.HZC_HSTS === '1', trustProxy: process.env.HZC_TRUST_PROXY === '1' }

let appOpts: AppOptions
let closeData: () => void
if (accountsMode) {
  // identities in accounts.sqlite (backed up and checked like a workspace); each user's work in users/<id>/
  const accountBackups = new Backups(dataDir, { ...backupOpts, prefix: 'accounts', tables: ACCOUNT_TABLES })
  accountBackups.recoverIfDamaged(join(dataDir, 'accounts.sqlite'))
  const accounts = new AccountStore(join(dataDir, 'accounts.sqlite'))
  const stopAccountBackups = accountBackups.schedule(accounts)
  const quotaEnv = Number(process.env.HZC_USER_QUOTA_MB)
  const defaultQuotaMb = Number.isFinite(quotaEnv) && quotaEnv > 0 ? quotaEnv : 2048
  const workspaces = new Workspaces(dataDir, {
    secrets: secrets(), builtinSkills, maxParallel, backupKeep: backupOpts.keep, backupIntervalMs: backupOpts.intervalMs,
    // an admin can give one account its own limit; it applies at once
    quotaBytes: (userId) => (accounts.getUser(userId)?.quotaMb ?? defaultQuotaMb) * 1024 * 1024,
    onStorage: (userId, bytes) => accounts.recordStorage(userId, bytes),
    onRun: (userId) => accounts.recordRun(userId),
  })
  const prune = setInterval(() => accounts.pruneSessions(), 3600_000)
  prune.unref()
  // HZC_ADMIN_EMAILS: the operator's own accounts get the admin console (/admin)
  const adminEmails = (process.env.HZC_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  accounts.promoteEmails(adminEmails)
  const signupEnv = process.env.HZC_SIGNUP ?? 'open'
  const signup = isSignupMode(signupEnv) ? signupEnv : 'open'
  // HZC_SMTP_URL (+ HZC_MAIL_FROM): password-reset links by mail; links point at HZC_PUBLIC_URL
  const mailer = process.env.HZC_SMTP_URL ? smtpMailer(process.env.HZC_SMTP_URL, process.env.HZC_MAIL_FROM || 'Haizhu Infinity Canvas <no-reply@localhost>') : undefined
  appOpts = { ...common, accounts: { accounts, workspaces, signup, mailer, publicUrl: process.env.HZC_PUBLIC_URL || undefined, adminEmails, defaultQuotaMb, secureCookies: process.env.HZC_SECURE_COOKIES === '1' ? true : 'auto' } }
  closeData = () => { clearInterval(prune); stopAccountBackups(); workspaces.closeAll(); accounts.close() }
  console.log(`[hzc] accounts mode: ${accounts.countUsers()} account(s), ${accounts.countAdmins()} admin(s); sign-up ${accounts.getSetting('signup') ?? signup}; password-reset mail ${mailer ? 'on' : 'off'}`)
} else {
  // redundancy: a damaged database is set aside and the newest good backup takes its place; then a
  // consistent backup is written now (if the last one is stale) and every HZC_BACKUP_HOURS (default 6)
  const dbFile = join(dataDir, 'hzc.sqlite')
  const backups = new Backups(dataDir, backupOpts)
  const recovery = backups.recoverIfDamaged(dbFile)
  const store = new Store(dbFile, secrets())
  const stopBackups = backups.schedule(store)
  const assets = new AssetStore(dataDir, store)
  const skills = new SkillStore(builtinSkills, dataDir)
  const engine = new Engine(store, assets, { skills, maxParallel })
  // agents (MCP): the access key lives in the data folder; on this machine they may read local files.
  // The desktop app says how an MCP client starts its bridge (shown in 设置 → Agent 接入).
  const desktop = process.env.HZC_DESKTOP_EXE && process.env.HZC_MCP_BRIDGE
    ? { exe: process.env.HZC_DESKTOP_EXE, bridge: process.env.HZC_MCP_BRIDGE, kind: process.env.HZC_DESKTOP_KIND || 'installed' }
    : undefined
  appOpts = { ...common, store, assets, engine, skills, backups, recovery, agentAccess: new AgentAccess(dataDir), localFiles: loopback, desktop }
  closeData = () => { stopBackups(); store.close() }
}
const app = await buildApp(appOpts)

await app.listen({ port, host })
console.log(`[hzc] Haizhu Infinity Canvas listening on http://${host}:${port}  (data: ${dataDir})`)

// where this server can be reached, for the desktop MCP bridge (it starts with Claude Code and finds the
// running app here). Only for a single-user server on this machine; removed again on shutdown.
const endpointFile = join(dataDir, 'agent-endpoint.json')
const ownsEndpoint = !accountsMode && loopback
if (ownsEndpoint) {
  try { writeAtomic(endpointFile, JSON.stringify({ url: `http://127.0.0.1:${port}`, pid: process.pid, version: APP_VERSION }), 0o600) } catch (e) { console.error('[hzc] could not write agent-endpoint.json:', e) }
}

/**
 * Graceful shutdown: stop taking requests, let running ones finish, then close the database (which
 * folds the write-ahead log back into the file). Remote generation jobs are NOT cancelled — they are
 * stored and picked up again on the next run. If something hangs, exit anyway after 10 s.
 */
let stopping = false
async function shutdown(why: string, code = 0) {
  if (stopping) return
  stopping = true
  console.log(`[hzc] shutting down (${why})`)
  const closeStore = () => { try { closeData() } catch { /* already closed */ } }
  if (ownsEndpoint) try { rmSync(endpointFile, { force: true }) } catch { /* ignore */ }
  const force = setTimeout(() => { console.error('[hzc] shutdown took too long; exiting'); closeStore(); process.exit(code || 1) }, 10_000)
  force.unref()
  try { await app.close() } catch (e) { console.error('[hzc] closing the server failed:', e) }
  closeStore()
  process.exit(code)
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => void shutdown(sig))
// the desktop app asks over its IPC channel (Windows has no SIGTERM) and, if the app itself goes away
// without asking (crash, killed), the server must not linger on its own
process.on('message', (m) => { if ((m as { type?: string })?.type === 'shutdown') void shutdown('requested by the desktop app') })
process.on('disconnect', () => void shutdown('the desktop app is gone'))
// a stray promise rejection is logged, not fatal; an uncaught exception leaves unknown state, so the
// server stops cleanly and its supervisor (desktop app, Docker restart policy) starts a fresh one
process.on('unhandledRejection', (e) => console.error('[hzc] unhandled promise rejection:', e))
process.on('uncaughtException', (e) => { console.error('[hzc] uncaught exception:', e); void shutdown('uncaught exception', 1) })
