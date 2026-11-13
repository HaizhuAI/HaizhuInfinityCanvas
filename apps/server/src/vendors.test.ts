import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateProfileInput, type ModelProfile, type ModelProfileInput, type ProjectGraph, type RunEvent } from '@hzc/core'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { testConnection } from './conntest'
import { Store } from './db'
import { Engine } from './engine'
import type { GenRequest } from './generation'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'
import { ark, dashscope, deepMerge, kling, minimax, runway, siliconflow, zhipu } from './vendors'

const BUILTIN_SKILLS = fileURLToPath(new URL('../skills', import.meta.url))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==', 'base64')
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
const MP3 = Buffer.from('494433040000000000', 'hex')
const KEY = 'vendor_test_key_98765'
const FIRST = 'data:image/png;base64,AAAA'
const LAST = 'data:image/png;base64,BBBB'

/* ------------------------------------------------------------------ request shapes (no network) */

const profile = (adapter: string, model: string, defaults: Record<string, unknown> = {}) =>
  ({ id: 'p', name: model, kind: 'video', adapter, endpoint: '', secretRef: '', model, defaults, createdAt: '', updatedAt: '' }) as unknown as ModelProfile
const req = (r: Partial<GenRequest>): GenRequest => ({ want: 'video', prompt: '海边的橘猫', negative: '', images: [], extra: {}, ...r })
const shape = (provider: { input?: (p: ModelProfile, r: GenRequest) => Record<string, unknown> }, p: ModelProfile, r: GenRequest) => provider.input!(p, r) as { path: string; body: any }

describe('provider request shapes', () => {
  it('deepMerge: nested objects merge, later layers win, prototype keys are ignored', () => {
    expect(deepMerge({ a: { x: 1, y: 2 }, b: [1] }, { a: { y: 3 }, b: [2] })).toEqual({ a: { x: 1, y: 3 }, b: [2] })
    const evil = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(deepMerge({}, evil)).toEqual({})
  })

  it('Seedance: text + first / last frame roles, ratio and duration as fields, advanced params on top', () => {
    const n = shape(ark, profile('ark', 'doubao-seedance-1-0-pro-250528', { watermark: false }), req({ first: FIRST, last: LAST, aspect: '16:9', duration: 5, negative: '文字', extra: { seed: 7 } }))
    expect(n.path).toBe('/contents/generations/tasks')
    expect(n.body).toEqual({
      watermark: false, model: 'doubao-seedance-1-0-pro-250528', ratio: '16:9', duration: 5, seed: 7,
      content: [
        { type: 'text', text: '海边的橘猫\n\nAvoid: 文字' },
        { type: 'image_url', image_url: { url: FIRST }, role: 'first_frame' },
        { type: 'image_url', image_url: { url: LAST }, role: 'last_frame' },
      ],
    })
    expect(() => shape(ark, profile('ark', 'm'), req({ last: LAST }))).toThrow(/首帧/)
    expect(() => shape(ark, profile('ark', 'm'), req({ want: 'image' }))).toThrow(/openai-compat/)
  })

  it('Wan: 2.7 text-to-video uses ratio; 2.7 image-to-video a media list; older models img_url; kf2v its own path', () => {
    const t2v = shape(dashscope, profile('dashscope', 'wan2.7-t2v'), req({ aspect: '9:16', duration: 10, negative: '模糊' }))
    expect(t2v.path).toBe('/api/v1/services/aigc/video-generation/video-synthesis')
    expect(t2v.body).toEqual({ model: 'wan2.7-t2v', input: { prompt: '海边的橘猫', negative_prompt: '模糊' }, parameters: { duration: 10, ratio: '9:16' } })
    const i2v = shape(dashscope, profile('dashscope', 'wan2.7-i2v-2026-04-25'), req({ first: FIRST, last: LAST, aspect: '16:9' }))
    expect(i2v.body.input.media).toEqual([{ type: 'first_frame', url: FIRST }, { type: 'last_frame', url: LAST }])
    expect(i2v.body.parameters.ratio).toBeUndefined() // follows the image
    const old = shape(dashscope, profile('dashscope', 'wan2.6-i2v'), req({ first: FIRST }))
    expect(old.body.input.img_url).toBe(FIRST)
    expect(() => shape(dashscope, profile('dashscope', 'wan2.6-i2v'), req({ first: FIRST, last: LAST }))).toThrow(/只支持首帧/)
    const kf = shape(dashscope, profile('dashscope', 'wan2.2-kf2v-flash'), req({ first: FIRST, last: LAST, duration: 10 }))
    expect(kf.path).toBe('/api/v1/services/aigc/image2video/video-synthesis')
    expect(kf.body.input).toMatchObject({ first_frame_url: FIRST, last_frame_url: LAST })
    expect(kf.body.parameters).toEqual({}) // fixed 5 s
    // advanced params merge into the nested objects instead of replacing them
    const seeded = shape(dashscope, profile('dashscope', 'wan2.7-t2v'), req({ duration: 5, extra: { parameters: { seed: 42 } } }))
    expect(seeded.body.parameters).toEqual({ duration: 5, seed: 42 })
  })

  it('Wan images: 2.6 messages + size within the pixel range; 2.5 and earlier prompt + size', () => {
    const n = shape(dashscope, profile('dashscope', 'wan2.6-t2i'), req({ want: 'image', aspect: '16:9' }))
    expect(n.path).toBe('/api/v1/services/aigc/image-generation/generation')
    expect(n.body.input.messages[0]).toEqual({ role: 'user', content: [{ text: '海边的橘猫' }] })
    const [w, h] = String(n.body.parameters.size).split('*').map(Number)
    expect(w! * h!).toBeGreaterThanOrEqual(1280 * 1280)
    expect(w! * h!).toBeLessThanOrEqual(1440 * 1440)
    const legacy = shape(dashscope, profile('dashscope', 'wan2.2-t2i-flash'), req({ want: 'image', aspect: '1:1' }))
    expect(legacy).toMatchObject({ path: '/api/v1/services/aigc/text2image/image-synthesis', body: { input: { prompt: '海边的橘猫' }, parameters: { n: 1, size: '1024*1024' } } })
    expect(() => shape(dashscope, profile('dashscope', 'wan2.6-t2i'), req({ want: 'image', images: [FIRST] }))).toThrow(/参考图/)
  })

  it('Kling: model in the path, plain base64 images, settings; images with model_name', () => {
    const t2v = shape(kling, profile('kling', 'kling-2.5-turbo'), req({ aspect: '9:16', duration: 10 }))
    expect(t2v).toEqual({ path: '/text-to-video/kling-2.5-turbo', body: { prompt: '海边的橘猫', settings: { duration: 10, aspect_ratio: '9:16' } } })
    const i2v = shape(kling, profile('kling', 'kling-2.5-turbo'), req({ first: FIRST, last: LAST }))
    expect(i2v.path).toBe('/image-to-video/kling-2.5-turbo')
    expect(i2v.body.contents).toEqual([{ type: 'prompt', text: '海边的橘猫' }, { type: 'first_frame', url: 'AAAA' }, { type: 'last_frame', url: 'BBBB' }])
    const img = shape(kling, profile('kling', 'kling-v3'), req({ want: 'image', images: [FIRST], negative: '文字', aspect: '4:3' }))
    expect(img).toEqual({ path: '/v1/images/generations', body: { model_name: 'kling-v3', prompt: '海边的橘猫', image: 'AAAA', aspect_ratio: '4:3', n: 1 } })
    expect(() => shape(kling, profile('kling', 'kling-v3'), req({ want: 'image', images: [FIRST, LAST] }))).toThrow(/1 张/)
  })

  it('MiniMax: Hailuo v1 with 6 / 10 s and frame images; H3 on v2 with a content list', () => {
    const v1 = shape(minimax, profile('minimax', 'MiniMax-Hailuo-02'), req({ first: FIRST, duration: 5 }))
    expect(v1).toEqual({ path: '/v1/video_generation', body: { model: 'MiniMax-Hailuo-02', prompt: '海边的橘猫', first_frame_image: FIRST, duration: 6 } })
    expect(shape(minimax, profile('minimax', 'MiniMax-Hailuo-2.3'), req({ duration: 10 })).body.duration).toBe(10)
    const v2 = shape(minimax, profile('minimax', 'MiniMax-H3'), req({ aspect: '21:9' }))
    expect(v2).toEqual({ path: '/v2/video_generation', body: { resolution: '768P', model: 'MiniMax-H3', content: [{ type: 'text', text: '海边的橘猫' }], duration: 6, ratio: '21:9' } })
    expect(shape(minimax, profile('minimax', 'MiniMax-H3'), req({ first: FIRST })).body.ratio).toBe('adaptive')
  })

  it('Runway: pixel ratios, first / last promptImage, text-only goes to text_to_video, big data URIs refused', () => {
    const i2v = shape(runway, profile('runway', 'gen4.5'), req({ first: FIRST, last: LAST, aspect: '9:16' }))
    expect(i2v).toEqual({ path: '/v1/image_to_video', body: { model: 'gen4.5', promptText: '海边的橘猫', promptImage: [{ uri: FIRST, position: 'first' }, { uri: LAST, position: 'last' }], ratio: '720:1280', duration: 5 } })
    expect(shape(runway, profile('runway', 'gen4.5'), req({})).path).toBe('/v1/text_to_video')
    const img = shape(runway, profile('runway', 'gen4_image'), req({ want: 'image', images: [FIRST], aspect: '1:1' }))
    expect(img.body).toEqual({ model: 'gen4_image', promptText: '海边的橘猫', ratio: '1024:1024', referenceImages: [{ uri: FIRST }] })
    const speech = shape(runway, profile('runway', 'eleven_multilingual_v2'), req({ want: 'audio', voice: 'Rachel' }))
    expect(speech.body).toEqual({ model: 'eleven_multilingual_v2', promptText: '海边的橘猫', voice: { type: 'runway-preset', presetId: 'Rachel' } })
    const huge = `data:image/png;base64,${'A'.repeat(5_000_001)}`
    expect(() => shape(runway, profile('runway', 'gen4.5'), req({ first: huge }))).toThrow(/3\.3 MB/)
  })

  it('CogVideoX: first + last frame as a two-image list; size only for text-to-video', () => {
    expect(shape(zhipu, profile('zhipu', 'cogvideox-3'), req({ first: FIRST, last: LAST, aspect: '16:9', duration: 10 })).body)
      .toEqual({ model: 'cogvideox-3', prompt: '海边的橘猫', image_url: [FIRST, LAST], duration: 10 })
    expect(shape(zhipu, profile('zhipu', 'cogvideox-flash'), req({ aspect: '16:9', duration: 10 })).body)
      .toEqual({ model: 'cogvideox-flash', prompt: '海边的橘猫', size: '1920x1080' }) // only cogvideox-3 takes a duration
  })

  it('SiliconFlow video: images with roles', () => {
    expect(shape(siliconflow, profile('siliconflow', 'MiniMaxAI/MiniMax-H3'), req({ first: FIRST, aspect: '16:9', duration: 5 })).body).toEqual({
      model: 'MiniMaxAI/MiniMax-H3', prompt: '海边的橘猫', duration: 5, ratio: '16:9', images: [{ url: FIRST, role: 'first_frame' }],
    })
  })

  it('profiles: a provider-native adapter only accepts the kinds it serves', () => {
    const base = { name: 'x', endpoint: '', model: 'm' }
    expect(validateProfileInput({ ...base, kind: 'llm', adapter: 'kling' })).toMatchObject({ ok: false, error: expect.stringContaining('image, video') })
    expect(validateProfileInput({ ...base, kind: 'tts', adapter: 'elevenlabs' }).ok).toBe(true)
    expect(validateProfileInput({ ...base, kind: 'video', adapter: 'ark' }).ok).toBe(true)
  })
})

/* ------------------------------------------------------------------ full runs against a mock of each provider */

let mock: FastifyInstance
let M = ''
const hits: { method: string; url: string; headers: Record<string, unknown>; body?: any }[] = []
let polls: Record<string, number> = {}
const poll = (k: string) => (polls[k] = (polls[k] ?? 0) + 1)

beforeAll(async () => {
  mock = Fastify({ bodyLimit: 50 * 1024 * 1024 })
  mock.addHook('onRequest', async (r) => { hits.push({ method: r.method, url: r.url, headers: r.headers }) })
  mock.addHook('preHandler', async (r) => { hits.at(-1)!.body = r.body })
  mock.get('/files/out.png', async (_r, reply) => reply.header('content-type', 'image/png').send(PNG))
  mock.get('/files/out.mp4', async (_r, reply) => reply.header('content-type', 'video/mp4').send(MP4))
  mock.get('/files/watermarked.mp4', async (_r, reply) => reply.code(500).send('should not be fetched'))

  // 火山方舟
  mock.post('/ark/contents/generations/tasks', async () => ({ id: 'cgt-1' }))
  mock.get('/ark/contents/generations/tasks/cgt-1', async () => {
    const n = poll('ark')
    return n === 1 ? { id: 'cgt-1', status: 'queued' } : n === 2 ? { id: 'cgt-1', status: 'running' } : { id: 'cgt-1', status: 'succeeded', content: { video_url: `${M}/files/out.mp4` } }
  })
  // 百炼
  mock.post('/ds/api/v1/services/aigc/video-generation/video-synthesis', async (r, reply) =>
    r.headers['x-dashscope-async'] === 'enable' ? { output: { task_id: 'w1', task_status: 'PENDING' } } : reply.code(400).send({ code: 'InvalidParameter', message: 'current user api does not support synchronous calls' }))
  mock.post('/ds/api/v1/services/aigc/image-generation/generation', async () => ({ output: { task_id: 'w2', task_status: 'PENDING' } }))
  mock.get('/ds/api/v1/tasks/w1', async () => (poll('ds') < 2 ? { output: { task_status: 'RUNNING' } } : { output: { task_status: 'SUCCEEDED', video_url: `${M}/files/out.mp4` } }))
  mock.get('/ds/api/v1/tasks/w2', async () => ({ output: { task_status: 'SUCCEEDED', choices: [{ message: { content: [{ image: `${M}/files/out.png` }] } }] } }))
  mock.post('/ds3/api/v1/services/aigc/video-generation/video-synthesis', async () => ({ output: { task_id: 'w3', task_status: 'PENDING' } }))
  mock.get('/ds3/api/v1/tasks/w3', async () => ({ output: { task_status: 'FAILED', code: 'DataInspectionFailed', message: 'Input data may contain inappropriate content.' } }))
  // 可灵
  mock.post('/kl/text-to-video/kling-2.5-turbo', async () => ({ code: 0, message: 'SUCCEED', data: { id: 'k1', status: 'submitted' } }))
  mock.get('/kl/tasks', async (r) => {
    const id = (r.query as { task_ids?: string }).task_ids
    return { code: 0, data: [{ id, status: 'succeeded', outputs: [{ type: 'video', url: `${M}/files/out.mp4`, watermark_url: `${M}/files/watermarked.mp4` }] }] }
  })
  mock.post('/kl/v1/images/generations', async () => ({ code: 0, data: { task_id: 'ki', task_status: 'submitted' } }))
  mock.get('/kl/v1/images/generations/ki', async () => ({ code: 0, data: { task_id: 'ki', task_status: 'succeed', task_result: { images: [{ index: 0, url: `${M}/files/out.png` }] } } }))
  // MiniMax
  mock.post('/mm/v1/video_generation', async () => ({ task_id: 'm1', base_resp: { status_code: 0, status_msg: 'success' } }))
  mock.get('/mm/v1/query/video_generation', async () => (poll('mm') < 2
    ? { task_id: 'm1', status: 'Processing', base_resp: { status_code: 0 } }
    : { task_id: 'm1', status: 'Success', file_id: '176844028768320', base_resp: { status_code: 0 } }))
  mock.get('/mm/v1/files/retrieve', async (r) => ({ file: { file_id: (r.query as { file_id: string }).file_id, download_url: `${M}/files/out.mp4` }, base_resp: { status_code: 0 } }))
  mock.post('/mm/v1/t2a_v2', async (r) => ((r.body as { text: string }).text === 'BADKEY'
    ? { base_resp: { status_code: 1004, status_msg: 'login fail' } }
    : { data: { audio: MP3.toString('hex'), status: 2 }, base_resp: { status_code: 0, status_msg: 'success' } }))
  // Runway
  mock.post('/rw/v1/image_to_video', async () => ({ id: 'rw-1' }))
  mock.get('/rw/v1/tasks/rw-1', async () => (poll('rw') < 2 ? { id: 'rw-1', status: 'RUNNING', progress: 0.5 } : { id: 'rw-1', status: 'SUCCEEDED', output: [`${M}/files/out.mp4`] }))
  mock.get('/rw/v1/tasks/:id', async (r, reply) => (r.headers.authorization === `Bearer ${KEY}` ? reply.code(404).send({ error: 'not found' }) : reply.code(401).send({ error: 'bad key' })))
  // 智谱
  mock.post('/zp/videos/generations', async () => ({ id: 'z1', model: 'cogvideox-3', task_status: 'PROCESSING' }))
  mock.get('/zp/async-result/z1', async () => ({ task_status: 'SUCCESS', video_result: [{ url: `${M}/files/out.mp4`, cover_image_url: `${M}/files/out.png` }] }))
  // 硅基流动
  mock.post('/sf/video/submit', async () => ({ requestId: 's1' }))
  mock.post('/sf/video/status', async (r) => ((r.body as { requestId: string }).requestId === 's1' ? { status: 'Succeed', results: { videos: [{ url: `${M}/files/out.mp4` }] } } : { status: 'Failed', reason: 'unknown request' }))
  mock.post('/sf/images/generations', async () => ({ images: [{ url: `${M}/files/out.png` }], timings: { inference: 1 }, seed: 1 }))
  // ElevenLabs
  mock.post('/el/v1/text-to-speech/:voice', async (r, reply) => (r.headers['xi-api-key'] === KEY
    ? reply.header('content-type', 'audio/mpeg').send(MP3)
    : reply.code(401).send({ detail: { status: 'invalid_api_key' } })))
  mock.get('/el/v1/models', async (r, reply) => (r.headers['xi-api-key'] === KEY
    ? [{ model_id: 'eleven_multilingual_v2', can_do_text_to_speech: true }, { model_id: 'eleven_english_sts_v2', can_do_text_to_speech: false }]
    : reply.code(401).send({})))
  await mock.listen({ port: 0, host: '127.0.0.1' })
  M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}`
})
afterAll(async () => { await mock.close() })

let dir: string, store: Store, assets: AssetStore, engine: Engine, app: FastifyInstance
beforeEach(async () => {
  hits.length = 0; polls = {}
  dir = mkdtempSync(join(tmpdir(), 'hzc-vendor-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  assets = new AssetStore(dir, store)
  engine = new Engine(store, assets, { pollDelays: [5], skills: new SkillStore(BUILTIN_SKILLS, dir) })
  app = await buildApp({ store, assets, engine, skills: new SkillStore(BUILTIN_SKILLS, dir) })
})
afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

const prof = (p: Partial<ModelProfileInput> & Pick<ModelProfileInput, 'kind' | 'adapter' | 'endpoint' | 'model'>) =>
  store.createProfile({ name: p.model, apiKey: KEY, defaults: {}, ...p })

async function run(projectId: string) {
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/run`, payload: {} })
  const events = await engine.wait(res.json().runId)
  const last = new Map<string, any>()
  const progress: string[] = []
  for (const e of events) if (e.kind === 'node') { last.set(e.nodeId, e.state); if (e.state.progress) progress.push(e.state.progress) }
  return { last, progress, end: events.at(-1) as Extract<RunEvent, { kind: 'run-end' }> }
}

function graph(type: 'image-gen' | 'video-gen' | 'tts', profileId: string, params: Record<string, unknown> = {}, first = false): ProjectGraph {
  const nodes: ProjectGraph['nodes'] = [
    { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: '一只在海边弹吉他的橘猫' } },
    { id: 'g', type, position: { x: 400, y: 0 }, data: { profileId, params } },
  ]
  const edges: ProjectGraph['edges'] = [{ id: 'e1', source: 't', sourceHandle: 'out', target: 'g', targetHandle: type === 'tts' ? 'in' : 'prompt' }]
  if (first) {
    const { id: assetId } = assets.put(PNG, 'image/png')
    nodes.push({ id: 'f', type: 'image', position: { x: 0, y: 300 }, data: { assetId, mime: 'image/png' } })
    edges.push({ id: 'e2', source: 'f', sourceHandle: 'out', target: 'g', targetHandle: 'first' })
  }
  return { version: 1, nodes, edges }
}

const assetBytes = async (id: string) => Buffer.from((await app.inject({ url: `/api/assets/${id}` })).rawPayload)
const sent = (method: string, path: string) => hits.find((h) => h.method === method && h.url.split('?')[0] === path)

describe('provider-native runs', () => {
  it('火山方舟 Seedance: submit, queued → running → succeeded, video stored', async () => {
    const pr = prof({ kind: 'video', adapter: 'ark', endpoint: `${M}/ark`, model: 'doubao-seedance-1-0-pro-250528' })
    const { last, end, progress } = await run(store.createProject('t', graph('video-gen', pr.id, { aspect_ratio: '16:9', duration: 5 }, true)).id)
    expect(end.status).toBe('done')
    const v = last.get('g').outputs.out[0]
    expect((await assetBytes(v.assetId)).equals(MP4)).toBe(true)
    const submit = sent('POST', '/ark/contents/generations/tasks')!
    expect(submit.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(submit.body.content[1]).toMatchObject({ type: 'image_url', role: 'first_frame' })
    expect(String(submit.body.content[1].image_url.url)).toMatch(/^data:image\/png;base64,/)
    expect(progress.some((p) => p.startsWith('排队中'))).toBe(true)
  })

  it('阿里云百炼 Wan: async header, task polling; images read from choices', async () => {
    const v = prof({ kind: 'video', adapter: 'dashscope', endpoint: `${M}/ds`, model: 'wan2.7-t2v' })
    const a = await run(store.createProject('t', graph('video-gen', v.id, { aspect_ratio: '9:16' })).id)
    expect(a.end.status).toBe('done')
    expect(sent('POST', '/ds/api/v1/services/aigc/video-generation/video-synthesis')!.body.parameters.ratio).toBe('9:16')
    const i = prof({ kind: 'image', adapter: 'dashscope', endpoint: `${M}/ds`, model: 'wan2.6-t2i' })
    const b = await run(store.createProject('t', graph('image-gen', i.id)).id)
    expect(b.end.status).toBe('done')
    expect((await assetBytes(b.last.get('g').outputs.out[0].assetId)).equals(PNG)).toBe(true)
  })

  it('可灵: video downloads the clean video (not the watermarked copy); images from task_result', async () => {
    const v = prof({ kind: 'video', adapter: 'kling', endpoint: `${M}/kl`, model: 'kling-2.5-turbo' })
    const a = await run(store.createProject('t', graph('video-gen', v.id, { duration: 5 })).id)
    expect(a.end.status).toBe('done')
    expect(a.last.get('g').outputs.out).toHaveLength(1)
    expect(hits.some((h) => h.url === '/files/watermarked.mp4')).toBe(false)
    expect(sent('GET', '/kl/tasks')!.url).toBe('/kl/tasks?task_ids=k1')
    const i = prof({ kind: 'image', adapter: 'kling', endpoint: `${M}/kl`, model: 'kling-v3' })
    const b = await run(store.createProject('t', graph('image-gen', i.id)).id)
    expect(b.end.status).toBe('done')
    expect(sent('POST', '/kl/v1/images/generations')!.body).toMatchObject({ model_name: 'kling-v3', n: 1 })
  })

  it('MiniMax: query until Success, then fetch the file link; speech decodes the hex audio', async () => {
    const v = prof({ kind: 'video', adapter: 'minimax', endpoint: `${M}/mm`, model: 'MiniMax-Hailuo-2.3' })
    const a = await run(store.createProject('t', graph('video-gen', v.id)).id)
    expect(a.end.status).toBe('done')
    expect(sent('GET', '/mm/v1/files/retrieve')!.url).toContain('file_id=176844028768320')
    const s = prof({ kind: 'tts', adapter: 'minimax', endpoint: `${M}/mm`, model: 'speech-2.8-hd' })
    const b = await run(store.createProject('t', graph('tts', s.id, { voice: 'male-qn-qingse', speed: 1.25 })).id)
    expect(b.end.status).toBe('done')
    const audio = b.last.get('g').outputs.out[0]
    expect(audio.mime).toBe('audio/mpeg')
    expect((await assetBytes(audio.assetId)).equals(MP3)).toBe(true)
    expect(sent('POST', '/mm/v1/t2a_v2')!.body).toMatchObject({ model: 'speech-2.8-hd', text: '一只在海边弹吉他的橘猫', output_format: 'hex', voice_setting: { voice_id: 'male-qn-qingse', speed: 1.25 }, audio_setting: { format: 'mp3' } })
  })

  it('MiniMax: an error in base_resp is reported, not mistaken for audio', async () => {
    const s = prof({ kind: 'tts', adapter: 'minimax', endpoint: `${M}/mm`, model: 'speech-2.8-hd' })
    const p = store.createProject('t', { version: 1, nodes: [{ id: 'g', type: 'tts', position: { x: 0, y: 0 }, data: { profileId: s.id, text: 'BADKEY' } }], edges: [] })
    const { last } = await run(p.id)
    expect(last.get('g').error).toMatch(/1004/)
  })

  it('Runway: version header on every call, progress shown as a percentage', async () => {
    const v = prof({ kind: 'video', adapter: 'runway', endpoint: `${M}/rw`, model: 'gen4.5' })
    const { end, progress } = await run(store.createProject('t', graph('video-gen', v.id, { aspect_ratio: '16:9', duration: 5 }, true)).id)
    expect(end.status).toBe('done')
    const calls = hits.filter((h) => h.url.startsWith('/rw/'))
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.every((h) => h.headers['x-runway-version'] === '2024-11-06')).toBe(true)
    expect(progress).toContain('生成中 · 50%')
  })

  it('智谱 CogVideoX and 硅基流动 video: submit and read the result lists', async () => {
    const z = prof({ kind: 'video', adapter: 'zhipu', endpoint: `${M}/zp`, model: 'cogvideox-3' })
    const a = await run(store.createProject('t', graph('video-gen', z.id)).id)
    expect(a.end.status).toBe('done')
    expect(a.last.get('g').outputs.out).toHaveLength(1) // the cover image is not a second result
    const s = prof({ kind: 'video', adapter: 'siliconflow', endpoint: `${M}/sf`, model: 'MiniMaxAI/MiniMax-H3' })
    const b = await run(store.createProject('t', graph('video-gen', s.id)).id)
    expect(b.end.status).toBe('done')
    expect(sent('POST', '/sf/video/status')!.body).toEqual({ requestId: 's1' })
  })

  it('硅基流动 images through openai-compat: image_size is sent and images[] is read', async () => {
    const i = prof({ kind: 'image', adapter: 'openai-compat', endpoint: `${M}/sf`, model: 'Kwai-Kolors/Kolors', defaults: { _sizeField: 'image_size' } })
    const { end } = await run(store.createProject('t', graph('image-gen', i.id)).id)
    expect(end.status).toBe('done')
    const body = sent('POST', '/sf/images/generations')!.body
    expect(body.image_size).toBe('1024x1024')
    expect(body.size).toBeUndefined()
    expect(body._sizeField).toBeUndefined()
  })

  it('ElevenLabs: xi-api-key header, voice in the path, the audio stored', async () => {
    const s = prof({ kind: 'tts', adapter: 'elevenlabs', endpoint: `${M}/el`, model: 'eleven_multilingual_v2' })
    const { last, end } = await run(store.createProject('t', graph('tts', s.id, { voice: 'myVoice123', speed: 2 })).id)
    expect(end.status).toBe('done')
    expect(last.get('g').outputs.out[0].mime).toBe('audio/mpeg')
    const call = hits.find((h) => h.url.startsWith('/el/v1/text-to-speech/'))!
    expect(call.url).toBe('/el/v1/text-to-speech/myVoice123?output_format=mp3_44100_128')
    expect(call.headers.authorization).toBeUndefined()
    expect(call.body).toEqual({ text: '一只在海边弹吉他的橘猫', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 1.2 } })
  })

  it('a failed task reports the provider message', async () => {
    const v = prof({ kind: 'video', adapter: 'dashscope', endpoint: `${M}/ds3`, model: 'wan2.7-t2v' })
    const { last, end } = await run(store.createProject('t', graph('video-gen', v.id)).id)
    expect(end.status).not.toBe('done')
    expect(last.get('g').error).toContain('Input data may contain inappropriate content.')
  })

  it('wrong inputs are explained before anything is sent', async () => {
    const v = prof({ kind: 'video', adapter: 'dashscope', endpoint: `${M}/ds`, model: 'wan2.6-i2v' })
    const g = graph('video-gen', v.id, {}, true)
    const { id: assetId } = assets.put(PNG, 'image/png')
    g.nodes.push({ id: 'l', type: 'image', position: { x: 0, y: 600 }, data: { assetId, mime: 'image/png' } })
    g.edges.push({ id: 'e3', source: 'l', sourceHandle: 'out', target: 'g', targetHandle: 'last' })
    const { last } = await run(store.createProject('t', g).id)
    expect(last.get('g').error).toMatch(/只支持首帧/)
    expect(hits.some((h) => h.url.startsWith('/ds/'))).toBe(false)
  })
})

describe('connection test for provider-native adapters', () => {
  it('Runway: 404 for a task that does not exist means the key works; 401 means it does not', async () => {
    expect(await testConnection('runway', `${M}/rw`, KEY)).toMatchObject({ status: 'ok' })
    expect(await testConnection('runway', `${M}/rw`, 'wrong')).toMatchObject({ status: 'error', message: expect.stringContaining('API Key 无效') })
    expect(await testConnection('runway', `${M}/rw`)).toMatchObject({ status: 'error', message: expect.stringContaining('需要 API Key') })
  })
  it('ElevenLabs lists speech models with xi-api-key', async () => {
    expect(await testConnection('elevenlabs', `${M}/el`, KEY)).toMatchObject({ status: 'ok', models: ['eleven_multilingual_v2'] })
    expect((await testConnection('elevenlabs', `${M}/el`, 'nope')).status).toBe('error')
  })
})

describe('per-model video capabilities (rc.20)', () => {
  it('Seedance 2.0: resolution and its own soundtrack go in the body; up to 9 reference pictures', () => {
    const refs = Array.from({ length: 12 }, (_, i) => `data:image/png;base64,R${i}`)
    const body = ark.input!(profile('ark', 'doubao-seedance-2-0-260128'), req({ duration: 15, resolution: '1080p', audio: true, images: refs })).body as Record<string, any>
    expect(body).toMatchObject({ duration: 15, resolution: '1080p', generate_audio: true })
    expect(body.content.filter((c: any) => c.role === 'reference_image')).toHaveLength(9)
    // an older model keeps 4; nothing set means nothing sent
    const old = ark.input!(profile('ark', 'doubao-seedance-1-0-lite-i2v'), req({ images: refs })).body as Record<string, any>
    expect(old.content.filter((c: any) => c.role === 'reference_image')).toHaveLength(4)
    expect(old).not.toHaveProperty('resolution')
    expect(old).not.toHaveProperty('generate_audio')
  })

  it('MiniMax H3: up to 30 seconds and a chosen resolution', () => {
    const body = minimax.input!(profile('minimax', 'MiniMax-H3'), req({ duration: 28, resolution: '2K' })).body as Record<string, any>
    expect(body).toMatchObject({ duration: 28, resolution: '2K' })
    expect((minimax.input!(profile('minimax', 'MiniMax-H3'), req({ duration: 45 })).body as Record<string, any>).duration).toBe(30)
    expect((minimax.input!(profile('minimax', 'MiniMax-H3'), req({})).body as Record<string, any>).resolution).toBe('768P')
  })
})
