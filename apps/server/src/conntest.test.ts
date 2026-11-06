import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'
import { testConnection } from './conntest'

describe('test connection', () => {
  let mock: FastifyInstance, M = '', dir = '', app: FastifyInstance, store: Store
  const seen: { url: string; auth?: string; method: string }[] = []
  beforeAll(async () => {
    mock = Fastify()
    mock.addHook('onRequest', async (req) => { seen.push({ url: req.url, auth: req.headers.authorization, method: req.method }) })
    mock.get('/v1/models', async (req, reply) => req.headers.authorization === 'Bearer good'
      ? { data: [{ id: 'zeta' }, { id: 'alpha' }] }
      : reply.code(401).send({ error: { message: 'bad key good' } }))
    mock.get('/api/tags', async () => ({ models: [{ name: 'qwen2.5vl:7b' }] }))
    mock.get('/rep/account', async (req, reply) => req.headers.authorization === 'Bearer r8' ? { username: 'artist' } : reply.code(401).send({}))
    mock.get('/moved/models', async (_req, reply) => reply.redirect('/v1/models'))
    await mock.listen({ port: 0, host: '127.0.0.1' })
    M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}`
    dir = mkdtempSync(join(tmpdir(), 'hzc-conn-'))
    store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
    const assets = new AssetStore(dir, store)
    const skills = new SkillStore(undefined, dir)
    app = await buildApp({ store, assets, engine: new Engine(store, assets, { skills }), skills })
  })
  afterAll(async () => { await app.close(); store.close(); await mock.close(); rmSync(dir, { recursive: true, force: true }) })

  it('lists models from an OpenAI-compatible endpoint with only a GET', async () => {
    seen.length = 0
    expect(await testConnection('openai-compat', `${M}/v1/`, 'good')).toEqual({ status: 'ok', message: expect.stringContaining('2 个'), models: ['alpha', 'zeta'] })
    expect(seen.every((r) => r.method === 'GET')).toBe(true)
  })
  it('explains bad keys, wrong paths, refused connections and redirects in plain words', async () => {
    const bad = await testConnection('openai-compat', `${M}/v1`, 'wrong')
    expect(bad).toMatchObject({ status: 'error', message: expect.stringContaining('API Key 无效') })
    expect((await testConnection('openai-compat', `${M}/nope`, 'good')).message).toMatch(/接口地址可能不对/)
    const gone = Fastify(); await gone.listen({ port: 0, host: '127.0.0.1' })
    const freed = (gone.server.address() as { port: number }).port; await gone.close()
    expect((await testConnection('openai-compat', `http://127.0.0.1:${freed}/v1`, 'good')).message).toMatch(/连接被拒绝/)
    expect((await testConnection('openai-compat', `${M}/moved`, 'good')).message).toMatch(/跳转/)
    expect((await testConnection('openai-compat', 'api.example.com', 'k')).message).toMatch(/http/)
  })
  it('supports Ollama and Replicate, and skips fal (no free endpoint)', async () => {
    expect(await testConnection('ollama', M)).toMatchObject({ status: 'ok', models: ['qwen2.5vl:7b'] })
    expect(await testConnection('replicate', `${M}/rep`, 'r8')).toMatchObject({ status: 'ok', message: expect.stringContaining('artist') })
    expect(await testConnection('fal', '', 'k')).toMatchObject({ status: 'skipped' })
  })
  it('uses the stored key of a saved profile, never returning it', async () => {
    const p = store.createProfile({ name: 'x', kind: 'llm', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'alpha', defaults: {}, apiKey: 'good' })
    const r = await app.inject({ method: 'POST', url: '/api/profiles/test', payload: { adapter: 'openai-compat', endpoint: `${M}/v1`, profileId: p.id } })
    expect(r.json()).toMatchObject({ status: 'ok', models: ['alpha', 'zeta'] })
    expect(r.body).not.toContain('good"')
    expect((await app.inject({ method: 'POST', url: '/api/profiles/test', payload: { adapter: 'nope' } })).statusCode).toBe(400)
  })
})
