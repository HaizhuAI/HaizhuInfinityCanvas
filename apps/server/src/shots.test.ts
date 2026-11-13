import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { AgentAccess } from './agent'
import { SkillStore } from './skills'

/* rc.20 拆镜头: a video's shots → keyframes, clips and the soundtrack as nodes beside it */

const has = (cmd: string) => { try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true } catch { return false } }

describe.skipIf(!has('ffmpeg'))('splitting a video into its shots', { timeout: 90_000 }, () => {
  let dir: string, store: Store, assets: AssetStore, app: FastifyInstance, access: AgentAccess
  let videoId = ''
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'hzc-shots-'))
    const video = join(dir, 'three.mp4')
    // three 2 s shots of very different pictures, with a tone under all of them
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=2:r=25', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=2:r=25', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2:r=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video])
    store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
    assets = new AssetStore(dir, store)
    access = new AgentAccess(dir)
    const skills = new SkillStore(join(dir, 'no-builtin'), dir)
    app = await buildApp({ store, assets, engine: new Engine(store, assets, { pollDelays: [5], skills }), skills, agentAccess: access, localFiles: true })
    videoId = assets.put(readFileSync(video), 'video/mp4', 'three.mp4').id
  })
  afterAll(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

  it('from the app: three shots become keyframes, clips and a soundtrack in groups beside the video', async () => {
    const p = store.createProject('拆', { version: 1, nodes: [{ id: 'v', type: 'video', position: { x: 100, y: 200 }, data: { label: '参考片', assetId: videoId, mime: 'video/mp4' } }], edges: [] })
    const res = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/split-shots`, payload: { nodeId: 'v' } })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toMatchObject({ shots: 3, clips: 3, audio: true })
    const g = store.getProject(p.id)!.graph
    const of = (t: string) => g.nodes.filter((n) => n.type === t)
    expect(of('group').map((n) => n.data.label)).toEqual(['关键帧 · 参考片', '镜头片段 · 参考片', '原音轨 · 参考片'])
    expect(g.nodes[0]!.type).toBe('group')
    expect(of('image').map((n) => n.data.label)).toEqual(['S01 · 00:00.0–00:02.0', 'S02 · 00:02.0–00:04.0', 'S03 · 00:04.0–00:06.0'])
    expect(of('video')).toHaveLength(1 + 3)
    expect(of('audio')).toHaveLength(1)
    // beside the source, and every file is a real asset of the right kind
    expect(Math.min(...of('image').map((n) => n.position.x))).toBeGreaterThan(100)
    for (const n of [...of('image'), ...of('video').filter((x) => x.id !== 'v'), ...of('audio')]) expect(assets.get(String(n.data.assetId))?.mime).toBe(n.data.mime)
    // a clip is just its shot (about 2 s)
    const clip = assets.get(String(of('video').find((n) => n.id !== 'v')!.data.assetId))!
    const len = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clip.file]).toString())
    expect(len).toBeGreaterThan(1.5); expect(len).toBeLessThan(2.6)
    // a node without a video is refused with a reason
    const bad = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/split-shots`, payload: { nodeId: of('image')[0]!.id } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toMatch(/没有视频/)
  })

  it('over MCP, keyframes only', async () => {
    access.enable()
    const p = store.createProject('mcp', { version: 1, nodes: [{ id: 'v', type: 'video', position: { x: 0, y: 0 }, data: { assetId: videoId, mime: 'video/mp4' } }], edges: [] })
    const r = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${access.token()}` }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'split_shots', arguments: { project_id: p.id, node_id: 'v', clips: false, audio: false } } } })
    const out = JSON.parse(r.json().result.content[0].text)
    expect(out).toMatchObject({ clips: 0, audio: false })
    expect(out.shots).toHaveLength(3)
    const g = store.getProject(p.id)!.graph
    expect(g.nodes.filter((n) => n.type === 'image')).toHaveLength(3)
    expect(g.nodes.filter((n) => n.type === 'video')).toHaveLength(1)
  })
})
