import { describe, expect, it, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Backups, checkDatabaseFile } from './backup'
import { Store } from './db'
import { SecretBox } from './secrets'
import { AssetStore } from './assets'
import { Engine } from './engine'
import { SkillStore } from './skills'
import { buildApp } from './app'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'hzc-backup-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const open = (dir: string) => new Store(join(dir, 'hzc.sqlite'), new SecretBox(join(dir, 'master.key')))

describe('database backups', () => {
  it('writes consistent, checkable copies and keeps only the newest', () => {
    const dir = tmp()
    const store = open(dir)
    store.createProject('first')
    const backups = new Backups(dir, { keep: 3 })
    const made = [backups.create(store)]
    for (let i = 0; i < 4; i++) { store.createProject(`p${i}`); made.push(backups.create(store)) }
    const list = backups.list()
    expect(list).toHaveLength(3)
    expect(list.map((b) => b.name)).toEqual(made.slice(-3).map((b) => b.name).reverse())
    for (const b of list) expect(checkDatabaseFile(join(backups.dir, b.name))).toEqual({ state: 'ok' })
    // no temporary files left behind
    expect(readdirSync(backups.dir).filter((n) => !n.endsWith('.sqlite'))).toEqual([])
    // the newest copy has every project
    const copy = new Store(join(backups.dir, list[0]!.name), new SecretBox(join(dir, 'master.key')))
    expect(copy.listProjects().map((p) => p.name).sort()).toEqual(['first', 'p0', 'p1', 'p2', 'p3'])
    copy.close(); store.close()
  })

  it('ignores invalid settings instead of pruning everything or backing up non-stop', () => {
    for (const keep of [NaN, 0, -3, 2.5]) expect(new Backups('/x', { keep }).keep).toBe(14)
    expect(new Backups('/x', { keep: 3 }).keep).toBe(3)
    for (const intervalMs of [NaN, 0, -1, Infinity]) expect(new Backups('/x', { intervalMs }).intervalMs).toBe(6 * 3600_000)
    expect(new Backups('/x', { intervalMs: 1000 }).intervalMs).toBe(15 * 60_000)
  })

  it('backs up at startup only when the newest backup is stale', () => {
    const dir = tmp()
    const store = open(dir)
    const backups = new Backups(dir, { intervalMs: 3600_000 })
    const stop1 = backups.schedule(store, () => undefined)
    expect(backups.list()).toHaveLength(1)
    const stop2 = backups.schedule(store, () => undefined)
    expect(backups.list()).toHaveLength(1) // fresh enough: no second copy
    stop1(); stop2(); store.close()
  })

  it('restores the newest good backup when the database is damaged, keeping the damaged file', () => {
    const dir = tmp()
    const file = join(dir, 'hzc.sqlite')
    let store = open(dir)
    store.createProject('safe')
    const backups = new Backups(dir)
    const good = backups.create(store)
    store.close()
    // an even newer backup that is itself broken must be skipped
    writeFileSync(join(backups.dir, 'hzc-29990101T000000Z.sqlite'), Buffer.alloc(4096, 1))
    // damage the live file: overwrite its header
    const bytes = readFileSync(file)
    bytes.fill(0x5a, 0, 100)
    writeFileSync(file, bytes)
    expect(checkDatabaseFile(file).state).toBe('damaged')

    const note = backups.recoverIfDamaged(file)
    expect(note?.restoredFrom).toBe(good.name)
    expect(note?.keptAs).toMatch(/^hzc\.sqlite\.damaged-/)
    expect(existsSync(join(dir, note!.keptAs!))).toBe(true)
    store = open(dir)
    expect(store.listProjects().map((p) => p.name)).toEqual(['safe'])
    store.close()
  })

  it('treats an emptied database file as damaged', () => {
    const dir = tmp()
    const store = open(dir)
    store.createProject('kept')
    const backups = new Backups(dir)
    backups.create(store)
    store.close()
    writeFileSync(join(dir, 'hzc.sqlite'), '')
    rmSync(join(dir, 'hzc.sqlite-wal'), { force: true })
    expect(backups.recoverIfDamaged(join(dir, 'hzc.sqlite'))?.restoredFrom).toBeTruthy()
    const again = open(dir)
    expect(again.listProjects().map((p) => p.name)).toEqual(['kept'])
    again.close()
  })

  it('leaves a healthy database alone and starts empty (file kept) when no backup is usable', () => {
    const dir = tmp()
    const store = open(dir)
    store.close()
    const backups = new Backups(dir)
    expect(backups.recoverIfDamaged(join(dir, 'hzc.sqlite'))).toBeUndefined()
    expect(backups.recoverIfDamaged(join(dir, 'missing.sqlite'))).toBeUndefined()
    writeFileSync(join(dir, 'hzc.sqlite'), Buffer.alloc(8192, 9))
    const note = backups.recoverIfDamaged(join(dir, 'hzc.sqlite'))
    expect(note?.restoredFrom).toBeUndefined()
    expect(note?.keptAs).toBeTruthy()
    expect(existsSync(join(dir, 'hzc.sqlite'))).toBe(false) // the server will create a fresh one
  })

  it('lists and creates backups over the API and reports them in /api/system', async () => {
    const dir = tmp()
    const store = open(dir)
    const assets = new AssetStore(dir, store)
    const backups = new Backups(dir)
    const recovery = { at: new Date().toISOString(), problem: 'test', restoredFrom: 'hzc-x.sqlite', keptAs: 'hzc.sqlite.damaged-x' }
    const app = await buildApp({ store, assets, engine: new Engine(store, assets), skills: new SkillStore(undefined, dir), backups, recovery })
    try {
      expect((await app.inject({ url: '/api/backups' })).json()).toEqual([])
      const made = await app.inject({ method: 'POST', url: '/api/backups' })
      expect(made.statusCode).toBe(201)
      expect((await app.inject({ url: '/api/backups' })).json()).toHaveLength(1)
      const sys = (await app.inject({ url: '/api/system' })).json()
      expect(sys.backups.count).toBe(1)
      expect(sys.backups.latest).toBe(made.json().createdAt)
      expect(sys.recovery.restoredFrom).toBe('hzc-x.sqlite')
    } finally { await app.close(); store.close() }
  })
})

describe('crash-safe files', () => {
  it('rewrites an asset file that an earlier crash left half-written', () => {
    const dir = tmp()
    const store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
    const assets = new AssetStore(dir, store)
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2000, 3)])
    const sha = createHash('sha256').update(png).digest('hex')
    const file = join(dir, 'assets', `${sha}.png`)
    writeFileSync(file, png.subarray(0, 100)) // the truncated leftover
    const { id } = assets.put(png, 'image/png')
    expect(statSync(file).size).toBe(png.length)
    expect(readFileSync(assets.get(id)!.file).equals(png)).toBe(true)
    expect(readdirSync(join(dir, 'assets')).filter((n) => n.endsWith('.tmp'))).toEqual([])
    store.close()
  })
})
