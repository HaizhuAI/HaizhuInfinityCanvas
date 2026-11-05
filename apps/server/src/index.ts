import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app'
import { Store } from './db'
import { SecretBox } from './secrets'
import { AssetStore } from './assets'
import { Engine } from './engine'
import { SkillStore } from './skills'
import { existsSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(process.env.HZC_DATA_DIR ?? join(process.cwd(), 'data'))
const port = Number(process.env.PORT ?? 8787)
// Desktop shell keeps this on loopback; for WebUI/Docker set HZC_HOST=0.0.0.0 AND HZC_TOKEN.
const host = process.env.HZC_HOST ?? '127.0.0.1'
const accessToken = process.env.HZC_TOKEN || undefined

if (host !== '127.0.0.1' && host !== 'localhost' && !accessToken) {
  console.error('[hzc] refusing to listen on a non-loopback address without HZC_TOKEN set')
  process.exit(1)
}

// the desktop app hands over the keychain-unsealed master key; keep it out of the environment afterwards
const masterKey = process.env.HZC_MASTER_KEY || undefined
delete process.env.HZC_MASTER_KEY
const store = new Store(join(dataDir, 'hzc.sqlite'), new SecretBox(join(dataDir, 'master.key'), masterKey))
const webDir = process.env.HZC_WEB_DIR ?? resolve(here, '../../web/dist')
const assets = new AssetStore(dataDir, store)
// built-in skills sit next to the bundle (dist/skills) or, in dev, at apps/server/skills
const builtinSkills = process.env.HZC_SKILLS_DIR ?? [resolve(here, 'skills'), resolve(here, '../skills')].find((d) => existsSync(d))
const skills = new SkillStore(builtinSkills, dataDir)
const engine = new Engine(store, assets, { skills })
const app = await buildApp({ store, assets, engine, skills, webDir, accessToken })

await app.listen({ port, host })
console.log(`[hzc] Haizhu Infinity Canvas listening on http://${host}:${port}  (data: ${dataDir})`)

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => { await app.close(); store.close(); process.exit(0) })
}
