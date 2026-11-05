import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectGraph, RunEvent } from '@hzc/core'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { detectScenes, ffmpegInfo, probe, segmentsFromCuts } from './media'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'

const BUILTIN = fileURLToPath(new URL('../skills', import.meta.url))
const HAS_FFMPEG = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()

describe('segmentsFromCuts (pure)', () => {
  it('turns cuts into segments, drops slivers, merges down to maxShots', () => {
    expect(segmentsFromCuts([2, 4], 6, 8)).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 6 }])
    expect(segmentsFromCuts([2, 2.1, 4], 6, 8)).toEqual([{ start: 0, end: 2.1 }, { start: 2.1, end: 4 }, { start: 4, end: 6 }])
    const merged = segmentsFromCuts([1, 2, 3, 4, 5], 6, 3)
    expect(merged).toHaveLength(3)
    expect(merged[0]!.start).toBe(0); expect(merged.at(-1)!.end).toBe(6)
  })
  it('splits a long single take evenly', () => {
    const s = segmentsFromCuts([], 30, 8)
    expect(s).toHaveLength(6)
    expect(s[5]!.end).toBe(30)
  })
})

describe.skipIf(!HAS_FFMPEG)('FFmpeg + video prompt reverse', () => {
  let dir: string, video: string
  let mock: FastifyInstance, M = ''
  const seen: any[] = []
  let reply = ''

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'hzc-media-'))
    video = join(dir, 'three.mp4')
    // three 1.5 s shots of very different colour -> two unambiguous cuts
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=1.5:r=25', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=1.5:r=25', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1.5:r=25',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]', '-map', '[v]', '-c:v', 'libx264', video])
    mock = Fastify({ bodyLimit: 50 * 1024 * 1024 })
    mock.post('/v1/chat/completions', async (req) => { seen.push(req.body); return { choices: [{ message: { content: reply } }] } })
    await mock.listen({ port: 0, host: '127.0.0.1' })
    M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}/v1`
  })
  afterAll(async () => { await mock.close(); rmSync(dir, { recursive: true, force: true }) })

  it('detects FFmpeg, probes and finds the cuts', async () => {
    const info = await ffmpegInfo(true)
    expect(info.ok).toBe(true)
    const p = await probe(video)
    expect(p.duration).toBeCloseTo(4.5, 0)
    expect(p.width).toBe(320)
    const cuts = await detectScenes(video, 0.3)
    expect(cuts).toHaveLength(2)
    expect(cuts[0]).toBeCloseTo(1.5, 0); expect(cuts[1]).toBeCloseTo(3, 0)
  })

  describe('video-reverse node', () => {
    let data: string, store: Store, assets: AssetStore, engine: Engine, app: FastifyInstance
    beforeEach(async () => {
      seen.length = 0
      data = mkdtempSync(join(tmpdir(), 'hzc-vr-'))
      store = new Store(':memory:', new SecretBox(join(data, 'master.key')))
      assets = new AssetStore(data, store)
      const skills = new SkillStore(BUILTIN, data)
      engine = new Engine(store, assets, { skills })
      app = await buildApp({ store, assets, engine, skills })
    })
    afterEach(async () => { await app.close(); store.close(); rmSync(data, { recursive: true, force: true }) })

    async function run(graph: ProjectGraph) {
      const p = store.createProject('t', graph)
      const res = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/run`, payload: {} })
      const events = await engine.wait(res.json().runId)
      const last = new Map<string, any>()
      const progress: string[] = []
      for (const e of events) if (e.kind === 'node') { last.set(e.nodeId, e.state); if (e.state.progress) progress.push(e.state.progress) }
      return { last, progress, end: events.at(-1) as Extract<RunEvent, { kind: 'run-end' }> }
    }
    const graph = (assetId: string, profileId: string, params: Record<string, unknown> = {}): ProjectGraph => ({
      version: 1,
      nodes: [
        { id: 'v', type: 'video', position: { x: 0, y: 0 }, data: { assetId, mime: 'video/mp4' } },
        { id: 'r', type: 'video-reverse', position: { x: 400, y: 0 }, data: { profileId, params } },
      ],
      edges: [{ id: 'e', source: 'v', sourceHandle: 'out', target: 'r', targetHandle: 'video' }],
    })

    it('sends one keyframe per shot and returns a storyboard timed by the video', async () => {
      reply = '```json\n' + JSON.stringify({ title: '三色', shots: [
        { title: '黑场', visual: '纯黑画面', camera: '固定', image_prompt: 'pure black frame', video_prompt: '静止' },
        { title: '白场', visual: '纯白画面', camera: '固定', image_prompt: 'pure white frame', video_prompt: '静止', duration: 99 },
        // the model forgets the third shot: the node must still produce three
      ] }) + '\n```'
      const { id } = assets.put(readFileSync(video), 'video/mp4', 'three.mp4')
      const prof = store.createProfile({ name: 'vlm', kind: 'vlm', adapter: 'openai-compat', endpoint: M, model: 'vl', defaults: {} })
      const { last, end, progress } = await run(graph(id, prof.id, { lang: 'en' }))
      expect(end.status).toBe('done')
      const sb = last.get('r').outputs.out[0]
      expect(sb).toMatchObject({ type: 'storyboard', title: '三色' })
      expect(sb.shots).toHaveLength(3)
      expect(sb.shots.map((s: any) => s.duration)).toEqual([2, 2, 2]) // 1.5 s rounded; the model's 99 is ignored
      expect(sb.shots[2].visual).toMatch(/未描述/)
      expect(sb.shots[1].start).toBeCloseTo(1.5, 0)
      for (const s of sb.shots) expect((await app.inject({ url: `/api/assets/${s.keyframe.assetId}` })).headers['content-type']).toBe('image/jpeg')
      const content = seen[0].messages.at(-1).content
      expect(content.filter((c: any) => c.type === 'image_url')).toHaveLength(3)
      expect(content[0].text).toMatch(/3 张关键帧/)
      expect(content[0].text).toMatch(/英文书写/)
      expect(last.get('r').outputs.text[0].text).toContain('pure white frame')
      expect(progress).toEqual(expect.arrayContaining(['分析镜头切换…', '视觉模型解读镜头…']))
    })

    it('honours maxShots', async () => {
      reply = JSON.stringify({ shots: [{ visual: 'a' }, { visual: 'b' }] })
      const { id } = assets.put(readFileSync(video), 'video/mp4', 'three.mp4')
      const prof = store.createProfile({ name: 'vlm', kind: 'vlm', adapter: 'openai-compat', endpoint: M, model: 'vl', defaults: {} })
      const { last } = await run(graph(id, prof.id, { maxShots: 2 }))
      expect(last.get('r').outputs.out[0].shots).toHaveLength(2)
      expect(seen[0].messages.at(-1).content.filter((c: any) => c.type === 'image_url')).toHaveLength(2)
    })

    it('explains how to install FFmpeg when it is missing', async () => {
      const prev = process.env.HZC_FFMPEG
      process.env.HZC_FFMPEG = join(dir, 'no-such-ffmpeg')
      try {
        await ffmpegInfo(true)
        const { id } = assets.put(readFileSync(video), 'video/mp4', 'three.mp4')
        const prof = store.createProfile({ name: 'vlm', kind: 'vlm', adapter: 'openai-compat', endpoint: M, model: 'vl', defaults: {} })
        const { last } = await run(graph(id, prof.id))
        expect(last.get('r').error).toMatch(/未找到 FFmpeg/)
        expect((await app.inject({ url: '/api/system' })).json().ffmpeg.ok).toBe(false)
      } finally {
        if (prev === undefined) delete process.env.HZC_FFMPEG; else process.env.HZC_FFMPEG = prev
        await ffmpegInfo(true)
      }
    })
  })
})
