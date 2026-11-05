import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectGraph, RunEvent } from '@hzc/core'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'
import { fileURLToPath } from 'node:url'

const BUILTIN_SKILLS = fileURLToPath(new URL('../skills', import.meta.url))

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const KEY = 'sk-test-0123456789abcdef'

// ---------------- mock OpenAI-compatible provider
interface Seen { auth?: string; body: any }
let mock: FastifyInstance
let mockUrl = ''
let seen: Seen[] = []
let mode: 'ok' | 'fail-echo-key' | 'slow' = 'ok'

beforeAll(async () => {
  mock = Fastify({ bodyLimit: 50 * 1024 * 1024 })
  mock.post('/v1/chat/completions', async (req, reply) => {
    seen.push({ auth: req.headers.authorization, body: req.body })
    if (mode === 'fail-echo-key') return reply.code(500).send({ error: `bad key ${KEY}` })
    if (mode === 'slow') await new Promise((r) => setTimeout(r, 1500))
    const b = req.body as { messages: { content: unknown }[] }
    const user = b.messages[b.messages.length - 1]!.content
    const hasImage = Array.isArray(user) && user.some((p: any) => p.type === 'image_url')
    return { choices: [{ message: { content: hasImage ? '  一只橘猫坐在窗台上，柔和侧光  ' : `ECHO:${String(user)}` } }] }
  })
  await mock.listen({ port: 0, host: '127.0.0.1' })
  const addr = mock.server.address() as { port: number }
  mockUrl = `http://127.0.0.1:${addr.port}/v1`
})
afterAll(async () => { await mock.close() })

// ---------------- app under test
let dir: string, store: Store, assets: AssetStore, engine: Engine, app: FastifyInstance

beforeEach(async () => {
  seen = []; mode = 'ok'
  dir = mkdtempSync(join(tmpdir(), 'hzc-eng-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  assets = new AssetStore(dir, store)
  engine = new Engine(store, assets, { skills: new SkillStore(BUILTIN_SKILLS, dir) })
  app = await buildApp({ store, assets, engine, skills: new SkillStore(BUILTIN_SKILLS, dir) })
})
afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

function profile(kind: 'llm' | 'vlm') {
  return store.createProfile({ name: kind, kind, adapter: 'openai-compat', endpoint: mockUrl, model: `m-${kind}`, defaults: { temperature: 0.2 }, apiKey: KEY })
}

function project(graph: ProjectGraph) { return store.createProject('t', graph) }

async function run(projectId: string, body: object = {}) {
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/run`, payload: body })
  expect(res.statusCode).toBe(202)
  const events = await engine.wait(res.json().runId)
  const last = new Map<string, any>()
  for (const e of events) if (e.kind === 'node') last.set(e.nodeId, e.state)
  return { events, last, end: events.at(-1) as Extract<RunEvent, { kind: 'run-end' }> }
}

const textLlmPreview = (profileId?: string): ProjectGraph => ({
  version: 1,
  nodes: [
    { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: '写一句海边的诗' } },
    { id: 'l', type: 'llm', position: { x: 300, y: 0 }, data: { profileId } },
    { id: 'p', type: 'preview', position: { x: 600, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 't', sourceHandle: 'out', target: 'l', targetHandle: 'in' },
    { id: 'e2', source: 'l', sourceHandle: 'out', target: 'p', targetHandle: 'in' },
  ],
})

describe('engine + openai-compat provider', () => {
  it('runs text -> llm -> preview and sends a correct request', async () => {
    const p = project(textLlmPreview(profile('llm').id))
    const { last, end } = await run(p.id)
    expect(end.status).toBe('done')
    expect(last.get('l').status).toBe('done')
    expect(last.get('l').outputs.out[0].text).toBe('ECHO:写一句海边的诗')
    expect(last.get('p').outputs.in[0].text).toBe('ECHO:写一句海边的诗')
    expect(seen).toHaveLength(1)
    expect(seen[0]!.auth).toBe(`Bearer ${KEY}`)
    expect(seen[0]!.body.model).toBe('m-llm')
    expect(seen[0]!.body.temperature).toBe(0.2)
    expect(seen[0]!.body.stream).toBe(false)
  })

  it('caches unchanged nodes and re-runs when input changes', async () => {
    const prof = profile('llm')
    const p = project(textLlmPreview(prof.id))
    await run(p.id)
    const second = await run(p.id)
    expect(second.last.get('l').status).toBe('cached')
    expect(seen).toHaveLength(1)
    // force bypasses the cache for targets
    await run(p.id, { nodeIds: ['l'], force: true })
    expect(seen).toHaveLength(2)
    // editing upstream text invalidates
    const g = textLlmPreview(prof.id); g.nodes[0]!.data.text = '换一句'
    store.saveProject(p.id, { graph: g })
    const third = await run(p.id)
    expect(third.last.get('l').status).toBe('done')
    expect(seen).toHaveLength(3)
  })

  it('runs only the requested node and its ancestors', async () => {
    const p = project(textLlmPreview(profile('llm').id))
    const { events } = await run(p.id, { nodeIds: ['l'] })
    const start = events[0] as Extract<RunEvent, { kind: 'run-start' }>
    expect(start.nodeIds).toEqual(['t', 'l'])
  })

  it('reports a clear error for an unbound model and skips downstream', async () => {
    const p = project(textLlmPreview(undefined))
    const { last, end } = await run(p.id)
    expect(end.status).toBe('error')
    expect(last.get('l')).toMatchObject({ status: 'error', error: '未绑定模型档案' })
    expect(last.get('p').status).toBe('skipped')
    expect(seen).toHaveLength(0)
  })

  it('redacts the API key from provider error messages', async () => {
    mode = 'fail-echo-key'
    const p = project(textLlmPreview(profile('llm').id))
    const { last } = await run(p.id)
    expect(last.get('l').status).toBe('error')
    expect(last.get('l').error).toContain('500')
    expect(last.get('l').error).not.toContain(KEY)
  })

  it('rejects a profile of the wrong kind', async () => {
    const p = project(textLlmPreview(profile('vlm').id))
    const { last } = await run(p.id)
    expect(last.get('l').error).toMatch(/需要「llm」/)
  })

  it('cancels a running provider call', async () => {
    mode = 'slow'
    const p = project(textLlmPreview(profile('llm').id))
    const res = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/run`, payload: {} })
    const runId = res.json().runId
    await new Promise((r) => setTimeout(r, 200))
    expect((await app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel` })).statusCode).toBe(202)
    const events = await engine.wait(runId)
    const end = events.at(-1) as Extract<RunEvent, { kind: 'run-end' }>
    expect(end.status).toBe('cancelled')
    const states = events.filter((e) => e.kind === 'node' && e.nodeId === 'l') as Extract<RunEvent, { kind: 'node' }>[]
    expect(states.at(-1)!.state.status).toBe('cancelled')
  })

  it('says unimplemented nodes arrive in a later beta', async () => {
    const p = project({ version: 1, nodes: [{ id: 'g', type: 'video-reverse', position: { x: 0, y: 0 }, data: {} }], edges: [] })
    const { last } = await run(p.id)
    expect(last.get('g').error).toMatch(/beta\.5/)
  })
})

describe('assets + image prompt reverse', () => {
  async function upload(bytes: Buffer, mime: string) {
    return app.inject({ method: 'POST', url: '/api/assets', headers: { 'content-type': mime, 'x-file-name': encodeURIComponent('猫.png') }, payload: bytes })
  }

  it('uploads, serves and validates assets', async () => {
    const up = await upload(PNG_1x1, 'image/png')
    expect(up.statusCode).toBe(201)
    const { id } = up.json()
    const get = await app.inject({ url: `/api/assets/${id}` })
    expect(get.statusCode).toBe(200)
    expect(get.headers['content-type']).toBe('image/png')
    expect(get.headers['x-content-type-options']).toBe('nosniff')
    expect(Buffer.from(get.rawPayload).equals(PNG_1x1)).toBe(true)
    expect((await upload(Buffer.from('not a png'), 'image/png')).statusCode).toBe(415)
    expect((await upload(PNG_1x1, 'application/x-msdownload')).statusCode).toBeGreaterThanOrEqual(400)
    expect((await app.inject({ url: '/api/assets/..%2F..%2Fmaster.key' })).statusCode).toBe(404)
  })

  it('reverse-engineers a prompt from an image via the VLM profile', async () => {
    const { id } = (await upload(PNG_1x1, 'image/png')).json()
    const prof = profile('vlm')
    const p = project({
      version: 1,
      nodes: [
        { id: 'i', type: 'image', position: { x: 0, y: 0 }, data: { assetId: id, mime: 'image/png' } },
        { id: 'r', type: 'image-reverse', position: { x: 300, y: 0 }, data: { profileId: prof.id, params: { style: 'midjourney', lang: 'en' } } },
      ],
      edges: [{ id: 'e', source: 'i', sourceHandle: 'out', target: 'r', targetHandle: 'image' }],
    })
    const { last, end } = await run(p.id)
    expect(end.status).toBe('done')
    expect(last.get('r').outputs.out[0].text).toBe('一只橘猫坐在窗台上，柔和侧光') // trimmed
    const content = seen[0]!.body.messages.at(-1).content
    expect(content[0].text).toMatch(/Midjourney/)
    expect(content[1].image_url.url.startsWith('data:image/png;base64,')).toBe(true)
    // outputs are persisted for the UI to restore after reload
    const outs = (await app.inject({ url: `/api/projects/${p.id}/outputs` })).json()
    expect(outs.find((o: any) => o.nodeId === 'r').outputs.out[0].text).toBe('一只橘猫坐在窗台上，柔和侧光')
  })

  it('errors when an image node has no upload', async () => {
    const p = project({ version: 1, nodes: [{ id: 'i', type: 'image', position: { x: 0, y: 0 }, data: {} }], edges: [] })
    const { last } = await run(p.id)
    expect(last.get('i').error).toBe('还没有上传素材')
  })
})

describe('SSE events endpoint', () => {
  it('streams (and replays) events until run-end', async () => {
    const p = project(textLlmPreview(profile('llm').id))
    await app.listen({ port: 0, host: '127.0.0.1' })
    const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
    const { runId } = await (await fetch(`${base}/api/projects/${p.id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
    await engine.wait(runId)
    const text = await (await fetch(`${base}/api/runs/${runId}/events`)).text()
    const events = text.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)))
    expect(events[0].kind).toBe('run-start')
    expect(events.at(-1)).toMatchObject({ kind: 'run-end', status: 'done' })
  })
})
