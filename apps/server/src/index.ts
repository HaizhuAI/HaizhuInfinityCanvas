import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app'
import { Store } from './db'
import { SecretBox } from './secrets'
import { AssetStore } from './assets'
import { Engine } from './engine'
import { SkillStore } from './skills'
import { existsSync } from 'node:fs'
import { Backups } from './backup'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(process.env.HZC_DATA_DIR ?? join(process.cwd(), 'data'))
const port = Number(process.env.PORT ?? 8787)
// Desktop shell keeps this on loopback; for WebUI/Docker set HZC_HOST=0.0.0.0 AND HZC_TOKEN.
const host = process.env.HZC_HOST ?? '127.0.0.1'
const accessToken = process.env.HZC_TOKEN || undefined

if (host !== '127.0.0.1' && host !== 'localhost') {
  if (!accessToken) {
    console.error('[hzc] refusing to listen on a non-loopback address without HZC_TOKEN set')
    process.exit(1)
  }
  // reachable by others: a short or copied-from-the-example token is as good as none
  if (accessToken.length < 16 || /^change-me/i.test(accessToken)) {
    console.error('[hzc] HZC_TOKEN is too weak for a non-loopback address: use at least 16 random characters (e.g. `openssl rand -hex 24`), not the example value')
    process.exit(1)
  }
}

// the desktop app hands over the keychain-unsealed master key; keep it out of the environment afterwards
const masterKey = process.env.HZC_MASTER_KEY || undefined
delete process.env.HZC_MASTER_KEY
// redundancy: a damaged database is set aside and the newest good backup takes its place; then a
// consistent backup is written now (if the last one is stale) and every HZC_BACKUP_HOURS (default 6)
const dbFile = join(dataDir, 'hzc.sqlite')
// (invalid values fall back to the defaults inside Backups)
const backups = new Backups(dataDir, {
  keep: process.env.HZC_BACKUP_KEEP ? Number(process.env.HZC_BACKUP_KEEP) : undefined,
  intervalMs: process.env.HZC_BACKUP_HOURS ? Number(process.env.HZC_BACKUP_HOURS) * 3600_000 : undefined,
})
const recovery = backups.recoverIfDamaged(dbFile)
const store = new Store(dbFile, new SecretBox(join(dataDir, 'master.key'), masterKey))
const stopBackups = backups.schedule(store)
const webDir = process.env.HZC_WEB_DIR ?? resolve(here, '../../web/dist')
const assets = new AssetStore(dataDir, store)
// built-in skills sit next to the bundle (dist/skills) or, in dev, at apps/server/skills
const builtinSkills = process.env.HZC_SKILLS_DIR ?? [resolve(here, 'skills'), resolve(here, '../skills')].find((d) => existsSync(d))
const skills = new SkillStore(builtinSkills, dataDir)
// HZC_MAX_PARALLEL: how many model calls may run at once (1–8, default 4; 1 = one node at a time)
const engine = new Engine(store, assets, { skills, maxParallel: process.env.HZC_MAX_PARALLEL ? Number(process.env.HZC_MAX_PARALLEL) : undefined })
// security settings for WebUI deployments (see docs/03-guide/projects-and-desktop.md)
const allowedHosts = (process.env.HZC_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)
const app = await buildApp({ store, assets, engine, skills, webDir, accessToken, allowedHosts, backups, recovery, hsts: process.env.HZC_HSTS === '1', trustProxy: process.env.HZC_TRUST_PROXY === '1' })

await app.listen({ port, host })
console.log(`[hzc] Haizhu Infinity Canvas listening on http://${host}:${port}  (data: ${dataDir})`)

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
  const closeStore = () => { try { store.close() } catch { /* already closed */ } }
  const force = setTimeout(() => { console.error('[hzc] shutdown took too long; exiting'); closeStore(); process.exit(code || 1) }, 10_000)
  force.unref()
  stopBackups()
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
