import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ModelProfileInput, ProjectGraph, RunEvent } from '@hzc/core'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { extractMediaUrls } from './generation'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'
import { fileURLToPath } from 'node:url'

const BUILTIN_SKILLS = fileURLToPath(new URL('../skills', import.meta.url))

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex') // tiny ftyp box
const KEY = 'r8_test_key_123456'
const MP3 = Buffer.from('494433040000000000', 'hex') // "ID3" header

// ------------------------------------------------ one mock server playing OpenAI-images, Replicate, fal and a CDN
let mock: FastifyInstance
let M = ''
const hits: { method: string; url: string; auth?: string; body?: any }[] = []
let replicateMode: 'ok' | 'never-done' | 'html-output' = 'ok'
let polls = 0
let falFail = false

beforeAll(async () => {
  mock = Fastify({ bodyLimit: 50 * 1024 * 1024 })
  mock.addHook('onRequest', async (req) => { hits.push({ method: req.method, url: req.url, auth: req.headers.authorization }) })
  mock.addHook('preHandler', async (req) => { hits.at(-1)!.body = req.body })
  // CDN
  mock.get('/files/out.png', async (_r, reply) => reply.header('content-type', 'image/png').send(PNG))
  mock.get('/files/out.mp4', async (_r, reply) => reply.header('content-type', 'video/mp4').send(MP4))
  mock.get('/files/page.html', async (_r, reply) => reply.header('content-type', 'text/html').send('<html></html>'))
  // OpenAI-compatible images
  mock.post('/v1/images/generations', async () => ({ data: [{ b64_json: PNG.toString('base64') }] }))
  // gpt-image style edits: multipart, kept raw so the test can read the parts
  mock.addContentTypeParser(/^multipart\/form-data/, { parseAs: 'buffer' }, (_r, body, done) => done(null, body))
  mock.post('/v1/images/edits', async () => ({ data: [{ b64_json: PNG.toString('base64') }] }))
  // OpenAI-compatible speech
  mock.post('/v1/audio/speech', async (req, reply) => {
    const b = req.body as { input?: string }
    if (b.input === 'FAIL') return reply.code(401).send({ error: `invalid key ${KEY}` })
    if (b.input === 'JSON') return reply.header('content-type', 'application/json').send({ ok: true })
    return reply.header('content-type', 'audio/mpeg').send(MP3)
  })
  // Replicate
  mock.post('/rep/v1/models/:owner/:name/predictions', async () => ({ id: 'p1', status: 'starting' }))
  mock.get('/rep/v1/predictions/p1', async () => {
    polls++
    if (replicateMode === 'never-done' || polls < 2) return { id: 'p1', status: 'processing' }
    return { id: 'p1', status: 'succeeded', output: [replicateMode === 'html-output' ? `${M}/files/page.html` : `${M}/files/out.png`] }
  })
  mock.post('/rep/v1/predictions/p1/cancel', async () => ({ id: 'p1', status: 'canceled' }))
  // fal queue
  let falPolls = 0
  mock.post('/fal/fal-ai/kling-video', async () => {
    falPolls = 0
    return { request_id: 'r1', status_url: `${M}/fal/fal-ai/kling-video/requests/r1/status`, response_url: `${M}/fal/fal-ai/kling-video/requests/r1`, cancel_url: `${M}/fal/fal-ai/kling-video/requests/r1/cancel` }
  })
  mock.get('/fal/fal-ai/kling-video/requests/r1/status', async () => {
    falPolls++
    return falPolls === 1 ? { status: 'IN_QUEUE', queue_position: 2 } : falPolls === 2 ? { status: 'IN_PROGRESS' } : { status: 'COMPLETED' }
  })
  mock.get('/fal/fal-ai/kling-video/requests/r1', async (_r, reply) =>
    falFail ? reply.code(422).send({ detail: [{ msg: 'prompt too long' }] }) : { video: { url: `${M}/files/out.mp4` } })
  await mock.listen({ port: 0, host: '127.0.0.1' })
  M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}`
})
afterAll(async () => { await mock.close() })

// ------------------------------------------------ app under test
let dir: string, store: Store, assets: AssetStore, engine: Engine, app: FastifyInstance
beforeEach(async () => {
  hits.length = 0; polls = 0; replicateMode = 'ok'; falFail = false
  dir = mkdtempSync(join(tmpdir(), 'hzc-gen-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  assets = new AssetStore(dir, store)
  engine = new Engine(store, assets, { pollDelays: [5], skills: new SkillStore(BUILTIN_SKILLS, dir) })
  app = await buildApp({ store, assets, engine, skills: new SkillStore(BUILTIN_SKILLS, dir) })
})
afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

const prof = (p: Partial<ModelProfileInput> & Pick<ModelProfileInput, 'kind' | 'adapter' | 'endpoint' | 'model'>) =>
  store.createProfile({ name: p.model, apiKey: KEY, defaults: {}, ...p })

async function run(projectId: string, body: object = {}) {
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/run`, payload: body })
  const events = await engine.wait(res.json().runId)
  const last = new Map<string, any>()
  const progress: string[] = []
  for (const e of events) if (e.kind === 'node') { last.set(e.nodeId, e.state); if (e.state.progress) progress.push(e.state.progress) }
  return { last, progress, end: events.at(-1) as Extract<RunEvent, { kind: 'run-end' }> }
}

function graph(genType: 'image-gen' | 'video-gen', profileId: string, extra: Partial<ProjectGraph> = {}, params: Record<string, unknown> = {}): ProjectGraph {
  return {
    version: 1,
    nodes: [
      { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: '一只在海边弹吉他的橘猫' } },
      { id: 'g', type: genType, position: { x: 400, y: 0 }, data: { profileId, params } },
      ...(extra.nodes ?? []),
    ],
    edges: [{ id: 'e1', source: 't', sourceHandle: 'out', target: 'g', targetHandle: 'prompt' }, ...(extra.edges ?? [])],
  }
}

const assetBytes = async (id: string) => Buffer.from((await app.inject({ url: `/api/assets/${id}` })).rawPayload)

describe('image generation', () => {
  it('openai-compat: /images/generations with aspect-derived size, b64 result stored as an asset', async () => {
    const p = store.createProject('t', graph('image-gen', prof({ kind: 'image', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'gpt-image-1' }).id, {}, { aspect_ratio: '16:9' }))
    const { last, end } = await run(p.id)
    expect(end.status).toBe('done')
    const out = last.get('g').outputs.out
    expect(out[0]).toMatchObject({ type: 'image', mime: 'image/png' })
    expect((await assetBytes(out[0].assetId)).equals(PNG)).toBe(true)
    const req = hits.find((h) => h.url === '/v1/images/generations')!
    expect(req.auth).toBe(`Bearer ${KEY}`)
    expect(req.body).toMatchObject({ model: 'gpt-image-1', prompt: '一只在海边弹吉他的橘猫', size: '1536x1024', n: 1 })
  })

  it('the 负面词 port: replicate gets negative_prompt, the openai images API gets it in words', async () => {
    const neg = { nodes: [{ id: 'n', type: 'text', position: { x: 0, y: 200 }, data: { text: 'watermark, blurry' } }], edges: [{ id: 'en', source: 'n', sourceHandle: 'out', target: 'g', targetHandle: 'negative' }] }
    const rp = prof({ kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'black-forest-labs/flux-dev' })
    expect((await run(store.createProject('r', graph('image-gen', rp.id, neg)).id)).end.status).toBe('done')
    expect(hits.find((h) => h.method === 'POST' && h.url.endsWith('/predictions'))!.body.input).toMatchObject({ prompt: '一只在海边弹吉他的橘猫', negative_prompt: 'watermark, blurry' })
    const op = prof({ kind: 'image', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'gpt-image-1' })
    expect((await run(store.createProject('o', graph('image-gen', op.id, neg)).id)).end.status).toBe('done')
    expect(hits.find((h) => h.url === '/v1/images/generations')!.body.prompt).toBe('一只在海边弹吉他的橘猫\n\nAvoid: watermark, blurry')
  })

  it('openai-compat takes reference pictures (rc.20): gpt-image uploads them to /images/edits, Seedream sends them as `image`', async () => {
    const { id: assetId } = assets.put(PNG, 'image/png')
    const withRef = (model: string) => store.createProject('t', graph('image-gen', prof({ kind: 'image', adapter: 'openai-compat', endpoint: `${M}/v1`, model }).id, {
      nodes: [{ id: 'i', type: 'image', position: { x: 0, y: 300 }, data: { assetId, mime: 'image/png' } }],
      edges: [{ id: 'e2', source: 'i', sourceHandle: 'out', target: 'g', targetHandle: 'ref' }],
    }))
    expect((await run(withRef('gpt-image-1').id)).end.status).toBe('done')
    const edit = hits.find((h) => h.url === '/v1/images/edits')!
    const form = (edit.body as Buffer).toString('latin1')
    expect(form).toContain('name="model"\r\n\r\ngpt-image-1')
    expect(form).toMatch(/name="image"; filename="ref-1\.png"/)
    expect(form).toContain('content-type: image/png'.replace('content-type', 'Content-Type'))
    hits.length = 0
    expect((await run(withRef('doubao-seedream-5-0-260128').id)).end.status).toBe('done')
    const gen = hits.find((h) => h.url === '/v1/images/generations')!
    expect(String(gen.body.image)).toMatch(/^data:image\/png;base64,/)
  })

  it('replicate: submits to the official-model endpoint, polls, downloads; ref image sent as data URI', async () => {
    const { id: assetId } = assets.put(PNG, 'image/png')
    const pr = prof({ kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'black-forest-labs/flux-kontext-pro', defaults: { output_format: 'png', _fields: { image: 'input_image' } } })
    const p = store.createProject('t', graph('image-gen', pr.id, {
      nodes: [{ id: 'i', type: 'image', position: { x: 0, y: 300 }, data: { assetId, mime: 'image/png' } }],
      edges: [{ id: 'e2', source: 'i', sourceHandle: 'out', target: 'g', targetHandle: 'ref' }],
    }, { aspect_ratio: '1:1', extra: '{"seed": 7}' }))
    const { last, end, progress } = await run(p.id)
    expect(end.status).toBe('done')
    expect(last.get('g').outputs.out[0].mime).toBe('image/png')
    const submit = hits.find((h) => h.method === 'POST' && h.url.endsWith('/predictions'))!
    expect(submit.url).toBe('/rep/v1/models/black-forest-labs/flux-kontext-pro/predictions')
    expect(submit.auth).toBe(`Bearer ${KEY}`)
    expect(submit.body.input).toMatchObject({ prompt: '一只在海边弹吉他的橘猫', aspect_ratio: '1:1', output_format: 'png', seed: 7 })
    expect(submit.body.input._fields).toBeUndefined() // adapter config never sent to the provider
    expect(String(submit.body.input.input_image).startsWith('data:image/png;base64,')).toBe(true)
    expect(progress.some((x) => /提交任务|生成中|排队中/.test(x))).toBe(true)
  })

  it('replicate: a timed-out job is resumed on the next run instead of being submitted again', async () => {
    replicateMode = 'never-done'
    const pr = prof({ kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'owner/model', defaults: { _timeoutSec: -1 } })
    const p = store.createProject('t', graph('image-gen', pr.id))
    const first = await run(p.id)
    expect(first.last.get('g').error).toMatch(/不会重复提交/)
    replicateMode = 'ok'; polls = 5
    const second = await run(p.id)
    expect(second.end.status).toBe('done')
    expect(hits.filter((h) => h.method === 'POST' && h.url.endsWith('/predictions'))).toHaveLength(1)
    expect(second.progress).toContain('恢复进行中的任务…')
  })

  it('replicate: stopping the run cancels the remote prediction', async () => {
    replicateMode = 'never-done'
    const p = store.createProject('t', graph('image-gen', prof({ kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'owner/model' }).id))
    const res = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/run`, payload: {} })
    const runId = res.json().runId
    for (let i = 0; i < 50 && !hits.some((h) => h.url === '/rep/v1/predictions/p1'); i++) await new Promise((r) => setTimeout(r, 20))
    await app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel` })
    const events = await engine.wait(runId)
    expect((events.at(-1) as any).status).toBe('cancelled')
    expect(hits.some((h) => h.method === 'POST' && h.url === '/rep/v1/predictions/p1/cancel')).toBe(true)
  })

  it('rejects provider output of the wrong media type', async () => {
    replicateMode = 'html-output'
    const p = store.createProject('t', graph('image-gen', prof({ kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'o/m' }).id))
    const { last } = await run(p.id)
    expect(last.get('g').error).toMatch(/期望得到图片/)
  })

  it('requires a key for replicate', async () => {
    const pr = store.createProfile({ name: 'nokey', kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'o/m', defaults: {} })
    const { last } = await run(store.createProject('t', graph('image-gen', pr.id)).id)
    expect(last.get('g').error).toMatch(/API Token/)
  })
})

describe('video generation (fal queue)', () => {
  it('submits with Key auth, reports queue position, fetches result, stores the mp4; first frame as image_url', async () => {
    const { id: assetId } = assets.put(PNG, 'image/png')
    const pr = prof({ kind: 'video', adapter: 'fal', endpoint: `${M}/fal`, model: 'fal-ai/kling-video' })
    const p = store.createProject('t', graph('video-gen', pr.id, {
      nodes: [{ id: 'f', type: 'image', position: { x: 0, y: 300 }, data: { assetId, mime: 'image/png' } }],
      edges: [{ id: 'e2', source: 'f', sourceHandle: 'out', target: 'g', targetHandle: 'first' }],
    }, { duration: 5, aspect_ratio: '16:9' }))
    const { last, end, progress } = await run(p.id)
    expect(end.status).toBe('done')
    const v = last.get('g').outputs.out[0]
    expect(v).toMatchObject({ type: 'video', mime: 'video/mp4' })
    expect((await assetBytes(v.assetId)).equals(MP4)).toBe(true)
    const submit = hits.find((h) => h.method === 'POST' && h.url === '/fal/fal-ai/kling-video')!
    expect(submit.auth).toBe(`Key ${KEY}`)
    expect(submit.body).toMatchObject({ prompt: '一只在海边弹吉他的橘猫', duration: 5, aspect_ratio: '16:9' })
    expect(String(submit.body.image_url).startsWith('data:image/png;base64,')).toBe(true)
    expect(progress).toContain('排队中（第 3 位）')
  })

  it('treats COMPLETED with an error result as a failure', async () => {
    falFail = true
    const p = store.createProject('t', graph('video-gen', prof({ kind: 'video', adapter: 'fal', endpoint: `${M}/fal`, model: 'fal-ai/kling-video' }).id))
    const { last } = await run(p.id)
    expect(last.get('g').error).toMatch(/422/)
  })

  it('explains that video needs an async adapter', async () => {
    const p = store.createProject('t', graph('video-gen', prof({ kind: 'video', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'x' }).id))
    const { last } = await run(p.id)
    expect(last.get('g').error).toMatch(/replicate 或 fal/)
  })
})

describe('text to speech', () => {
  const ttsGraph = (profileId: string, text = '你好，欢迎来到海边。', params: Record<string, unknown> = {}): ProjectGraph => ({
    version: 1,
    nodes: [
      { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text } },
      { id: 's', type: 'tts', position: { x: 400, y: 0 }, data: { profileId, params } },
    ],
    edges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 's', targetHandle: 'in' }],
  })

  it('openai-compat: /audio/speech with voice + speed, stores the mp3', async () => {
    const pr = prof({ kind: 'tts', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'tts-1', defaults: { response_format: 'mp3' } })
    const p = store.createProject('t', ttsGraph(pr.id, '你好，欢迎来到海边。', { voice: 'nova', speed: 1.2 }))
    const { last, end } = await run(p.id)
    expect(end.status).toBe('done')
    const a = last.get('s').outputs.out[0]
    expect(a).toMatchObject({ type: 'audio', mime: 'audio/mpeg' })
    expect((await assetBytes(a.assetId)).equals(MP3)).toBe(true)
    const req = hits.find((h) => h.url === '/v1/audio/speech')!
    expect(req.auth).toBe(`Bearer ${KEY}`)
    expect(req.body).toMatchObject({ model: 'tts-1', input: '你好，欢迎来到海边。', voice: 'nova', speed: 1.2, response_format: 'mp3' })
  })

  it('openai-compat: errors are reported with the key redacted; non-audio replies are rejected', async () => {
    const pr = prof({ kind: 'tts', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'tts-1' })
    const bad = await run(store.createProject('t', ttsGraph(pr.id, 'FAIL')).id)
    expect(bad.last.get('s').error).toContain('401')
    expect(bad.last.get('s').error).not.toContain(KEY)
    const json = await run(store.createProject('t', ttsGraph(pr.id, 'JSON')).id)
    expect(json.last.get('s').error).toMatch(/非音频/)
  })

  it('needs text', async () => {
    const pr = prof({ kind: 'tts', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'tts-1' })
    const { last } = await run(store.createProject('t', ttsGraph(pr.id, '')).id)
    expect(last.get('s').error).toMatch(/没有要朗读的文本/)
  })

  it('replicate: sends the text as "text" and the voice param', async () => {
    replicateMode = 'ok'
    const pr = prof({ kind: 'tts', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'owner/tts' })
    const p = store.createProject('t', ttsGraph(pr.id, '台词', { voice: 'zh_female' }))
    const { last } = await run(p.id)
    // the mock returns a png url for every prediction, so the type check must reject it as non-audio
    expect(last.get('s').error).toMatch(/期望得到音频/)
    const submit = hits.find((h) => h.method === 'POST' && h.url.endsWith('/predictions'))!
    expect(submit.body.input).toMatchObject({ text: '台词', voice: 'zh_female' })
    expect(submit.body.input.prompt).toBeUndefined()
  })
})

describe('cost estimate', () => {
  it('counts generative calls and per-call prices, and drops cached ones after a successful run', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: 'img', kind: 'image', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'gpt-image-1', apiKey: KEY, cost: { amount: 0.3, currency: 'cny' } } })
    expect(created.json().cost).toEqual({ amount: 0.3, currency: 'CNY' }) // normalised at the API boundary
    const pr = created.json()
    const p = store.createProject('t', graph('image-gen', pr.id))
    const est = (await app.inject({ method: 'POST', url: `/api/projects/${p.id}/estimate`, payload: {} })).json()
    expect(est.items).toHaveLength(1)
    expect(est.items[0]).toMatchObject({ nodeId: 'g', generative: true, cached: false, cost: { amount: 0.3, currency: 'CNY' } })
    expect(est.totals).toEqual({ CNY: 0.3 })
    await run(p.id)
    const after = (await app.inject({ method: 'POST', url: `/api/projects/${p.id}/estimate`, payload: {} })).json()
    expect(after.items[0].cached).toBe(true)
    expect(after.totals).toEqual({})
    const forced = (await app.inject({ method: 'POST', url: `/api/projects/${p.id}/estimate`, payload: { nodeIds: ['g'], force: true } })).json()
    expect(forced.items[0].cached).toBe(false)
  })

  it('validates profile cost', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/profiles', payload: { name: 'x', kind: 'image', adapter: 'fal', endpoint: '', model: 'm', cost: { amount: -1, currency: 'USD' } } })
    expect(bad.statusCode).toBe(400)
  })
})

describe('extractMediaUrls', () => {
  it('finds urls in common provider output shapes', () => {
    expect(extractMediaUrls('https://a/x.png')).toEqual(['https://a/x.png'])
    expect(extractMediaUrls({ images: [{ url: 'https://a/1.png' }, { url: 'https://a/2.png' }], seed: 1 })).toEqual(['https://a/1.png', 'https://a/2.png'])
    expect(extractMediaUrls({ video: { url: 'https://a/v.mp4' } })).toEqual(['https://a/v.mp4'])
    expect(extractMediaUrls({ text: 'hello' })).toEqual([])
  })
})
