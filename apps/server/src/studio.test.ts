import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ModelProfileInput, ProjectGraph, RunEvent } from '@hzc/core'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { guessKind, SkillStore } from './skills'

/* rc.14 「创作台」: prompt optimisation, variations, picking one, frames from a video */

const BUILTIN = fileURLToPath(new URL('../skills', import.meta.url))
const has = (cmd: string) => { try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true } catch { return false } }
const HAS_FFMPEG = has('ffmpeg')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==', 'base64')
const KEY = 'studio_test_key_123'

let mock: FastifyInstance
let M = ''
const chats: any[] = []
let chatReply = '镜头缓慢推近，橘猫抬头看向海面。'
let chatStatus = 200
let images = 0
let failImageNo = 0 // the n-th image request fails (0 = none)

beforeAll(async () => {
  mock = Fastify({ bodyLimit: 50 * 1024 * 1024 })
  mock.post('/v1/chat/completions', async (req, reply) => {
    chats.push(req.body)
    if (chatStatus !== 200) return reply.code(chatStatus).send({ error: { message: 'quota exceeded' } })
    return { choices: [{ message: { content: chatReply } }] }
  })
  mock.post('/v1/images/generations', async (_req, reply) => {
    images++
    if (images === failImageNo) return reply.code(400).send({ error: { message: 'content policy' } })
    // a different picture each call, so every variant is its own file
    const bytes = Buffer.concat([PNG, Buffer.from([images])])
    return { data: [{ b64_json: bytes.toString('base64') }] }
  })
  await mock.listen({ port: 0, host: '127.0.0.1' })
  M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}/v1`
})
afterAll(async () => { await mock.close() })

let dir: string, store: Store, assets: AssetStore, engine: Engine, app: FastifyInstance, skills: SkillStore
beforeEach(async () => {
  chats.length = 0; chatReply = '镜头缓慢推近，橘猫抬头看向海面。'; chatStatus = 200; images = 0; failImageNo = 0
  dir = mkdtempSync(join(tmpdir(), 'hzc-studio-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  assets = new AssetStore(dir, store)
  skills = new SkillStore(BUILTIN, dir)
  engine = new Engine(store, assets, { pollDelays: [5], skills })
  app = await buildApp({ store, assets, engine, skills })
})
afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

const prof = (p: Partial<ModelProfileInput> & Pick<ModelProfileInput, 'kind' | 'adapter' | 'model'>) =>
  store.createProfile({ name: p.model, apiKey: KEY, endpoint: M, defaults: {}, ...p })
const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload })

async function run(projectId: string, body: object = {}) {
  const res = await post(`/api/projects/${projectId}/run`, body)
  const events = await engine.wait(res.json().runId)
  const last = new Map<string, any>()
  for (const e of events) if (e.kind === 'node') last.set(e.nodeId, e.state)
  return { last, end: events.at(-1) as Extract<RunEvent, { kind: 'run-end' }> }
}

const imageGraph = (profileId: string, params: Record<string, unknown> = {}): ProjectGraph => ({
  version: 1,
  nodes: [{ id: 'g', type: 'image-gen', position: { x: 0, y: 0 }, data: { profileId, text: '海边的橘猫', params } }],
  edges: [],
})

describe('optimise prompt', () => {
  it('rewrites with the target model family rules and cleans the answer', async () => {
    const llm = prof({ kind: 'llm', adapter: 'openai-compat', model: 'writer' })
    const video = prof({ kind: 'video', adapter: 'ark', endpoint: 'https://ark.example/api/v3', model: 'doubao-seedance-1-0-pro-250528' })
    chatReply = '```\n提示词：橘猫抬头，镜头缓慢推近。\n```'
    const r = await post('/api/prompt/optimize', { profileId: llm.id, prompt: '橘猫在海边', target: { profileId: video.id }, fromImage: true })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ prompt: '橘猫抬头，镜头缓慢推近。', family: 'seedance', familyLabel: 'Seedance' })
    const sent = chats[0]
    expect(sent.model).toBe('writer')
    const system = sent.messages.find((m: any) => m.role === 'system').content as string
    expect(system).toContain('Seedance')
    expect(system).toContain('只写画面接下来的运动') // a first frame is connected
    expect(sent.messages.at(-1).content).toBe('橘猫在海边')
  })

  it('different families get different rules; English-first families default to English', async () => {
    const llm = prof({ kind: 'llm', adapter: 'openai-compat', model: 'writer' })
    await post('/api/prompt/optimize', { profileId: llm.id, prompt: 'a cat', target: { kind: 'video', adapter: 'minimax', model: 'MiniMax-Hailuo-02' } })
    await post('/api/prompt/optimize', { profileId: llm.id, prompt: '一只猫', target: { kind: 'image', adapter: 'replicate', model: 'black-forest-labs/flux-dev' } })
    const [hailuo, flux] = chats.map((c) => c.messages[0].content as string)
    expect(hailuo).toContain('[Push in]')
    expect(flux).toContain('FLUX 不支持负面提示词')
    expect(flux).toContain('用英文写')
  })

  it('an imported prompt skill replaces the built-in rules', async () => {
    const llm = prof({ kind: 'llm', adapter: 'openai-compat', model: 'writer' })
    skills.import('---\nname: my-video-prompts\ndescription: 我的视频提示词写法\n---\n\n总是先写光线，再写主体。', { kind: 'prompt' })
    expect(skills.list().find((s) => s.name === 'my-video-prompts')?.kind).toBe('prompt')
    const r = await post('/api/prompt/optimize', { profileId: llm.id, prompt: '橘猫', target: { kind: 'video' }, skill: 'my-video-prompts' })
    expect(r.json().skill).toBeTruthy()
    const system = chats[0].messages[0].content as string
    expect(system).toContain('总是先写光线')
    expect(system).not.toContain('通用视频')
    expect((await post('/api/prompt/optimize', { profileId: llm.id, prompt: '橘猫', target: { kind: 'video' }, skill: 'nope' })).statusCode).toBe(404)
  })

  it('a vision model also sees the first frame', async () => {
    const vlm = prof({ kind: 'vlm', adapter: 'openai-compat', model: 'seer' })
    const a = assets.put(PNG, 'image/png')
    await post('/api/prompt/optimize', { profileId: vlm.id, prompt: '让它动起来', target: { kind: 'video' }, fromImage: true, imageIds: [a.id] })
    const user = chats[0].messages.at(-1).content as any[]
    expect(user.some((p) => p.type === 'image_url' && String(p.image_url.url).startsWith('data:image/png;base64,'))).toBe(true)
  })

  it('explains bad requests and provider failures', async () => {
    const llm = prof({ kind: 'llm', adapter: 'openai-compat', model: 'writer' })
    const img = prof({ kind: 'image', adapter: 'openai-compat', model: 'gpt-image-1' })
    expect((await post('/api/prompt/optimize', { prompt: 'x', target: { kind: 'video' } })).json().error).toMatch(/文本模型/)
    expect((await post('/api/prompt/optimize', { profileId: img.id, prompt: 'x', target: { kind: 'video' } })).statusCode).toBe(400)
    expect((await post('/api/prompt/optimize', { profileId: llm.id, prompt: '  ', target: { kind: 'video' } })).json().error).toMatch(/先写/)
    expect((await post('/api/prompt/optimize', { profileId: llm.id, prompt: 'x', target: { kind: 'tts' } })).statusCode).toBe(400)
    chatStatus = 429
    const r = await post('/api/prompt/optimize', { profileId: llm.id, prompt: 'x', target: { kind: 'image' } })
    expect(r.statusCode).toBe(502)
    expect(r.body).not.toContain(KEY)
  })
})

describe('variations', () => {
  it('count = 3 makes three separate calls; the estimate multiplies the price', async () => {
    const pr = prof({ kind: 'image', adapter: 'openai-compat', model: 'gpt-image-1', cost: { amount: 0.25, currency: 'CNY' } })
    const p = store.createProject('t', imageGraph(pr.id, { count: 3 }))
    const est = (await post(`/api/projects/${p.id}/estimate`, {})).json()
    expect(est.items[0]).toMatchObject({ count: 3, cost: { amount: 0.75, currency: 'CNY' } })
    expect(est.totals).toEqual({ CNY: 0.75 })
    const { last, end } = await run(p.id)
    expect(end.status).toBe('done')
    expect(images).toBe(3)
    const out = last.get('g').outputs.out
    expect(out).toHaveLength(3)
    expect(new Set(out.map((v: any) => v.assetId)).size).toBe(3)
  })

  it('keeps the variants that succeeded when one fails', async () => {
    failImageNo = 2
    const pr = prof({ kind: 'image', adapter: 'openai-compat', model: 'gpt-image-1' })
    const { last, end } = await run(store.createProject('t', imageGraph(pr.id, { count: 3 })).id)
    expect(end.status).toBe('done')
    expect(last.get('g').outputs.out).toHaveLength(2)
  })

  it('picking one keeps only it as the current result (and as a new version); downstream gets just it', async () => {
    const pr = prof({ kind: 'image', adapter: 'openai-compat', model: 'gpt-image-1' })
    const p = store.createProject('t', imageGraph(pr.id, { count: 2 }))
    const first = await run(p.id)
    const both = first.last.get('g').outputs.out
    expect((await post(`/api/projects/${p.id}/nodes/g/pick`, { index: 5 })).statusCode).toBe(400)
    const r = await post(`/api/projects/${p.id}/nodes/g/pick`, { index: 1 })
    expect(r.statusCode).toBe(200)
    expect(r.json().outputs.out).toEqual([both[1]])
    expect(r.json().versions).toBe(2)
    // still the same inputs: the next run reuses the picked result instead of generating again
    const again = await run(p.id)
    expect(images).toBe(2)
    expect(again.last.get('g').outputs.out).toEqual([both[1]])
  })
})

describe('skills', () => {
  it('guesses the prompt kind', () => {
    expect(guessKind({ name: 'seedance-prompts', description: 'write better video prompts' })).toBe('prompt')
    expect(guessKind({ name: 'x', description: '视频提示词写法' })).toBe('prompt')
    expect(guessKind({ name: 'image-prompt-reverse', description: 'reverse-engineer prompts' })).toBe('image-reverse')
  })
})

describe.skipIf(!HAS_FFMPEG)('frames from a video (FFmpeg)', { timeout: 60_000 }, () => {
  it('takes the last frame or the frame at a time as a new image', async () => {
    const file = join(dir, 'clip.mp4')
    // 2 s: red for the first second, blue for the last — the last frame must be blue
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=1:r=25', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1:r=25',
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-pix_fmt', 'yuv420p', file])
    const video = assets.put(readFileSync(file), 'video/mp4', 'clip.mp4')
    const last = await post(`/api/assets/${video.id}/frame`, { at: 'last' })
    expect(last.statusCode).toBe(201)
    expect(last.json()).toMatchObject({ mime: 'image/jpeg', id: expect.any(String) })
    const lastPx = await pixel(assets.get(last.json().id)!.file)
    expect(lastPx.b).toBeGreaterThan(150); expect(lastPx.r).toBeLessThan(80)
    const early = await post(`/api/assets/${video.id}/frame`, { at: 0.2 })
    const earlyPx = await pixel(assets.get(early.json().id)!.file)
    expect(earlyPx.r).toBeGreaterThan(150); expect(earlyPx.b).toBeLessThan(80)
    expect((await post(`/api/assets/${video.id}/frame`, { at: -1 })).statusCode).toBe(400)
    const img = assets.put(PNG, 'image/png')
    expect((await post(`/api/assets/${img.id}/frame`, {})).statusCode).toBe(400)
  })
})

/** the average colour of an image, decoded by FFmpeg */
async function pixel(file: string) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', 'scale=1:1:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  return { r: raw[0]!, g: raw[1]!, b: raw[2]! }
}

describe('storyboard table (rc.15)', () => {
  const storyboard = JSON.stringify({ title: '海边', shots: [
    { title: '开场', visual: '海边的灯塔', camera: '远景', dialogue: '', duration: 4, image_prompt: '灯塔', video_prompt: '推近' },
    { title: '猫', visual: '橘猫看海', camera: '中景', dialogue: '喵', duration: 5, image_prompt: '橘猫', video_prompt: '抬头' },
  ] })
  const directorGraph = (profileId: string): ProjectGraph => ({ version: 1, nodes: [{ id: 'd', type: 'director', position: { x: 0, y: 0 }, data: { profileId, text: '一个海边的小故事', params: { shots: 2 } } }], edges: [] })
  const put = (projectId: string, nodeId: string, payload: object) => app.inject({ method: 'PUT', url: `/api/projects/${projectId}/nodes/${nodeId}/storyboard`, payload })

  it('an edited storyboard becomes a new version and what the node gives downstream; the next run reuses it', async () => {
    const llm = prof({ kind: 'llm', adapter: 'openai-compat', model: 'writer' })
    chatReply = storyboard
    const p = store.createProject('t', directorGraph(llm.id))
    expect((await put(p.id, 'd', { shots: [{ title: 'x' }] })).statusCode).toBe(409) // nothing to edit before the first run
    await run(p.id)
    expect(chats).toHaveLength(1)
    const r = await put(p.id, 'd', { title: '海边（改）', shots: [
      { title: '猫', visual: '橘猫看海', duration: 99, imagePrompt: '橘猫，夕阳', videoPrompt: '慢慢抬头', keyframe: { assetId: '00000000-0000-0000-0000-000000000000', mime: 'image/png' } },
      { title: '', visual: '新加的镜头' },
    ] })
    expect(r.statusCode).toBe(200)
    const sb = r.json().outputs.out[0]
    expect(sb.title).toBe('海边（改）')
    expect(sb.shots.map((s: any) => [s.index, s.title, s.duration])).toEqual([[1, '猫', 60], [2, '镜头 2', 5]])
    expect(sb.shots[0].keyframe).toBeUndefined() // a keyframe the storyboard never had is dropped
    expect(r.json().versions).toBe(2)
    const again = await run(p.id)
    expect(chats).toHaveLength(1) // reused, not regenerated
    expect(again.last.get('d').outputs.out[0].shots[1].visual).toBe('新加的镜头')
  })

  it('refuses empty storyboards and nodes without one', async () => {
    const llm = prof({ kind: 'llm', adapter: 'openai-compat', model: 'writer' })
    chatReply = storyboard
    const p = store.createProject('t', { ...directorGraph(llm.id), nodes: [...directorGraph(llm.id).nodes, { id: 't', type: 'text', position: { x: 0, y: 300 }, data: { text: 'x' } }] })
    await run(p.id)
    expect((await put(p.id, 'd', { shots: [] })).json().error).toMatch(/至少/)
    expect((await put(p.id, 't', { shots: [{ title: 'a' }] })).statusCode).toBe(400)
    expect((await put(p.id, 'nope', { shots: [{ title: 'a' }] })).statusCode).toBe(400)
  })
})
