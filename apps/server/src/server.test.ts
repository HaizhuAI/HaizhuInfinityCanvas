import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { Store } from './db'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'
import { fileURLToPath } from 'node:url'

const BUILTIN_SKILLS = fileURLToPath(new URL('../skills', import.meta.url))
import { AssetStore } from './assets'
import { Engine } from './engine'

let dir: string
let store: Store
let app: FastifyInstance
let engine: Engine

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hzc-test-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  const assets = new AssetStore(dir, store)
  engine = new Engine(store, assets)
  app = await buildApp({ store, assets, engine, skills: new SkillStore(BUILTIN_SKILLS, dir) })
})
afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

const profile = { name: 'Kling', kind: 'video', adapter: 'replicate', endpoint: 'https://api.replicate.com', model: 'kling', apiKey: 'sk-secret-123' }

describe('profiles API', () => {
  it('creates a profile and never returns the key', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/profiles', payload: profile })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.hasKey).toBe(true)
    expect(JSON.stringify(body)).not.toContain('sk-secret-123')
    expect(body.secretRef).toBeUndefined()
    const list = await app.inject({ url: '/api/profiles' })
    expect(JSON.stringify(list.json())).not.toContain('sk-secret-123')
    // server-side can still decrypt
    expect(store.getApiKey(body.id)).toBe('sk-secret-123')
  })

  it('stores the key encrypted at rest', async () => {
    const { id } = (await app.inject({ method: 'POST', url: '/api/profiles', payload: profile })).json()
    // @ts-expect-error reach into the private db to inspect raw storage
    const raw = store.db.prepare('SELECT secret FROM profiles WHERE id = ?').get(id).secret as string
    expect(raw).not.toContain('sk-secret-123')
  })

  it('keeps the key when updating without apiKey, clears on empty string', async () => {
    const { id } = (await app.inject({ method: 'POST', url: '/api/profiles', payload: profile })).json()
    const { apiKey: _k, ...noKey } = profile
    await app.inject({ method: 'PUT', url: `/api/profiles/${id}`, payload: { ...noKey, name: 'Kling 2' } })
    expect(store.getApiKey(id)).toBe('sk-secret-123')
    await app.inject({ method: 'PUT', url: `/api/profiles/${id}`, payload: { ...noKey, apiKey: '' } })
    expect(store.getApiKey(id)).toBeUndefined()
  })

  it('validates input and handles 404/delete', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/profiles', payload: { ...profile, kind: 'nope' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/profiles/missing', payload: profile })).statusCode).toBe(404)
    const { id } = (await app.inject({ method: 'POST', url: '/api/profiles', payload: profile })).json()
    expect((await app.inject({ method: 'DELETE', url: `/api/profiles/${id}` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `/api/profiles/${id}` })).statusCode).toBe(404)
  })
})

describe('projects API', () => {
  it('round-trips a graph and rejects invalid ones', async () => {
    const graph = { version: 1, nodes: [{ id: 'n1', type: 'text', position: { x: 1, y: 2 }, data: { text: 'hi' } }], edges: [] }
    const created = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'demo', graph } })
    expect(created.statusCode).toBe(201)
    const { id } = created.json()
    expect((await app.inject({ url: `/api/projects/${id}` })).json().graph).toEqual(graph)
    expect((await app.inject({ method: 'PUT', url: `/api/projects/${id}`, payload: { graph: { nope: true } } })).statusCode).toBe(400)
    expect((await app.inject({ url: '/api/projects' })).json()).toHaveLength(1)
  })
})

describe('access token', () => {
  it('blocks /api without token when configured, allows health', async () => {
    const assets = new AssetStore(dir, store)
    const guarded = await buildApp({ store, assets, engine: new Engine(store, assets), skills: new SkillStore(BUILTIN_SKILLS, dir), accessToken: 't0k' })
    expect((await guarded.inject({ url: '/api/profiles' })).statusCode).toBe(401)
    expect((await guarded.inject({ url: '/api/profiles', headers: { 'x-hzc-token': 't0k' } })).statusCode).toBe(200)
    expect((await guarded.inject({ url: '/api/health' })).statusCode).toBe(200)
    await guarded.close()
  })
})

describe('master key', () => {
  it('uses an injected key without writing a key file, and explains keys it cannot decrypt', async () => {
    const { randomBytes } = await import('node:crypto')
    const { existsSync } = await import('node:fs')
    const { SecretError } = await import('./secrets')
    const d = mkdtempSync(join(tmpdir(), 'hzc-key-'))
    try {
      const db = join(d, 'hzc.sqlite')
      const s1 = new Store(db, new SecretBox(join(d, 'master.key'), randomBytes(32).toString('hex')))
      const p = s1.createProfile({ name: 'x', kind: 'llm', adapter: 'openai-compat', endpoint: 'http://127.0.0.1:9/v1', model: 'm', defaults: {}, apiKey: 'sk-1' })
      expect(s1.getApiKey(p.id)).toBe('sk-1')
      s1.close()
      expect(existsSync(join(d, 'master.key'))).toBe(false)
      const s2 = new Store(db, new SecretBox(join(d, 'master.key'), randomBytes(32).toString('hex')))
      expect(() => s2.getApiKey(p.id)).toThrow(SecretError)
      expect(() => s2.getApiKey(p.id)).toThrow(/重新填写/)
      s2.close()
      expect(() => new SecretBox(join(d, 'k'), 'abc')).toThrow(/64 hex/)
    } finally { rmSync(d, { recursive: true, force: true }) }
  })
})

describe('projects manager', () => {
  it('lists node counts and covers, duplicates with results, deletes', async () => {
    const img = { id: 'i1', type: 'image', position: { x: 0, y: 0 }, data: { assetId: 'a-in', mime: 'image/png' } }
    const gen = { id: 'g1', type: 'image-gen', position: { x: 300, y: 0 }, data: {} }
    const p = store.createProject('海报', { version: 1, nodes: [img, gen], edges: [] })
    let row = (await app.inject({ method: 'GET', url: '/api/projects' })).json().find((x: any) => x.id === p.id)
    expect(row).toMatchObject({ nodeCount: 2, cover: { assetId: 'a-in', mime: 'image/png' } })   // input image until something is generated
    store.setNodeOutput(p.id, 'g1', 'k1', { out: [{ type: 'image', assetId: 'a-gen', mime: 'image/png' }] })
    row = (await app.inject({ method: 'GET', url: '/api/projects' })).json().find((x: any) => x.id === p.id)
    expect(row.cover).toEqual({ assetId: 'a-gen', mime: 'image/png' })                          // latest generated image wins

    const dup = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/duplicate`, payload: {} })
    expect(dup.statusCode).toBe(201)
    expect(dup.json().name).toBe('海报 副本')
    expect(store.getNodeOutput(dup.json().id, 'g1')).toMatchObject({ cacheKey: 'k1' })
    expect((await app.inject({ method: 'POST', url: `/api/projects/${p.id}/duplicate`, payload: { name: '海报 B' } })).json().name).toBe('海报 B')
    expect((await app.inject({ method: 'POST', url: '/api/projects/nope/duplicate', payload: {} })).statusCode).toBe(404)

    const running = engine.isRunning
    engine.isRunning = (id) => id === p.id
    const busy = await app.inject({ method: 'DELETE', url: `/api/projects/${p.id}` })
    engine.isRunning = running
    expect(busy.statusCode).toBe(409)                                                             // not while it runs
    expect(store.getProject(p.id)).toBeTruthy()
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${p.id}` })).statusCode).toBe(204)
    expect(store.getNodeOutput(p.id, 'g1')).toBeUndefined()
  })
})

describe('prompt library', () => {
  it('saves, de-duplicates, lists newest first and deletes prompts', async () => {
    const a = (await app.inject({ method: 'POST', url: '/api/prompts', payload: { text: '  电影感，浅景深，柔和逆光  ' } })).json()
    expect(a).toMatchObject({ title: '电影感，浅景深，柔和逆光', text: '电影感，浅景深，柔和逆光' })
    const again = (await app.inject({ method: 'POST', url: '/api/prompts', payload: { text: '电影感，浅景深，柔和逆光', title: '别名' } })).json()
    expect(again.id).toBe(a.id)
    await new Promise((r) => setTimeout(r, 5))
    await app.inject({ method: 'POST', url: '/api/prompts', payload: { text: '缓慢推近', title: '推镜头' } })
    const list = (await app.inject({ method: 'GET', url: '/api/prompts' })).json()
    expect(list.map((p: any) => p.title)).toEqual(['推镜头', '电影感，浅景深，柔和逆光'])
    expect((await app.inject({ method: 'POST', url: '/api/prompts', payload: { text: '   ' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'DELETE', url: `/api/prompts/${a.id}` })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `/api/prompts/${a.id}` })).statusCode).toBe(404)
  })
})

describe('web UI files', () => {
  it('serves precompressed assets cached for good, index.html revalidated, and falls back to the app for deep links', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { brotliCompressSync, gzipSync, brotliDecompressSync } = await import('node:zlib')
    const web = join(dir, 'web')
    mkdirSync(join(web, 'assets'), { recursive: true })
    const js = Buffer.from('console.log("' + 'x'.repeat(4000) + '")')
    writeFileSync(join(web, 'assets', 'index-abc123.js'), js)
    writeFileSync(join(web, 'assets', 'index-abc123.js.br'), brotliCompressSync(js))
    writeFileSync(join(web, 'assets', 'index-abc123.js.gz'), gzipSync(js))
    writeFileSync(join(web, 'index.html'), '<!doctype html><div id="root"></div>')
    const ui = await buildApp({ store, assets: new AssetStore(dir, store), engine, skills: new SkillStore(BUILTIN_SKILLS, dir), webDir: web })
    try {
      const br = await ui.inject({ url: '/assets/index-abc123.js', headers: { 'accept-encoding': 'gzip, deflate, br' } })
      expect(br.headers['content-encoding']).toBe('br')
      expect(br.headers['cache-control']).toBe('public, max-age=31536000, immutable')
      expect(br.headers.vary).toMatch(/accept-encoding/i)
      expect(brotliDecompressSync(br.rawPayload).equals(js)).toBe(true)
      expect((await ui.inject({ url: '/assets/index-abc123.js', headers: { 'accept-encoding': 'gzip' } })).headers['content-encoding']).toBe('gzip')
      const plain = await ui.inject({ url: '/assets/index-abc123.js' })
      expect(plain.headers['content-encoding']).toBeUndefined()
      expect(plain.rawPayload.equals(js)).toBe(true)
      for (const url of ['/', '/some/deep/link']) {
        const r = await ui.inject({ url })
        expect(r.statusCode).toBe(200)
        expect(r.headers['cache-control']).toBe('no-cache')   // a new version is picked up at once
        expect(r.body).toContain('id="root"')
      }
      const api = await ui.inject({ url: '/api/nope' })
      expect(api.statusCode).toBe(404)
      expect(api.json()).toEqual({ error: 'not found' })
    } finally { await ui.close() }
  })
})
