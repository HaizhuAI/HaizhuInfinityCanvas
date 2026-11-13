import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectGraph, RunEvent } from '@hzc/core'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'
import { AgentAccess } from './agent'

/* rc.19 短剧工坊: shuohao-skills projects on the canvas, the short-drama director skill, negative params */

const BUILTIN = fileURLToPath(new URL('../skills', import.meta.url))
const FIX = fileURLToPath(new URL('../../../e2e/fixtures/shuohao-dukou/', import.meta.url))
const fixture = (k: string) => JSON.parse(readFileSync(join(FIX, `${k}.json`), 'utf8'))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

let mock: FastifyInstance
let M = ''
const chats: any[] = []
const imagePrompts: string[] = []
let chatReply = ''
beforeAll(async () => {
  mock = Fastify({ bodyLimit: 50 * 1024 * 1024 })
  mock.post('/v1/chat/completions', async (req) => { chats.push(req.body); return { choices: [{ message: { content: chatReply } }] } })
  mock.post('/v1/images/generations', async (req) => { imagePrompts.push((req.body as { prompt: string }).prompt); return { data: [{ b64_json: PNG.toString('base64') }] } })
  await mock.listen({ port: 0, host: '127.0.0.1' })
  M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}/v1`
})
afterAll(async () => { await mock.close() })

let dir: string, store: Store, assets: AssetStore, engine: Engine, app: FastifyInstance, skills: SkillStore, access: AgentAccess
beforeEach(async () => {
  chats.length = 0; imagePrompts.length = 0
  dir = mkdtempSync(join(tmpdir(), 'hzc-drama-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  assets = new AssetStore(dir, store)
  skills = new SkillStore(BUILTIN, dir)
  engine = new Engine(store, assets, { pollDelays: [5], skills })
  access = new AgentAccess(dir)
  app = await buildApp({ store, assets, engine, skills, agentAccess: access, localFiles: true })
})
afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

const run = async (graph: ProjectGraph) => {
  const p = store.createProject('t', graph)
  const res = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/run`, payload: {} })
  const events: RunEvent[] = await engine.wait(res.json().runId)
  const last = new Map<string, any>()
  for (const e of events) if (e.kind === 'node') last.set(e.nodeId, e.state)
  return last
}

describe('importing a shuohao-skills project', () => {
  it('puts the whole project on a canvas, next to what is there, with the models bound', async () => {
    const img = store.createProfile({ name: '画图', kind: 'image', adapter: 'openai-compat', endpoint: M, model: 'gpt-image-1' })
    const vid = store.createProfile({ name: 'Seedance', kind: 'video', adapter: 'ark', endpoint: 'http://127.0.0.1:9/ark', model: 'doubao-seedance-2-5' })
    const p = store.createProject('渡口', { version: 1, nodes: [{ id: 'keep', type: 'text', position: { x: 100, y: 50 }, data: { text: '原有节点' } }], edges: [] })
    const files = Object.fromEntries(['outline', 'cast', 'art', 'script', 'storyboard'].map((k) => [k, fixture(k)]))
    const res = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/import-drama`, payload: { files } })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toMatchObject({ protocol: 'seedance', counts: { segments: 10, cuts: 34, groups: 10 } })
    const g = store.getProject(p.id)!.graph
    expect(g.nodes.find((n) => n.id === 'keep')).toBeDefined()
    expect(g.nodes[0]!.type).toBe('group')
    const imported = g.nodes.filter((n) => n.id !== 'keep' && n.type !== 'group')
    expect(Math.min(...imported.map((n) => n.position.x))).toBeGreaterThanOrEqual(700)
    expect(g.nodes.filter((n) => n.type === 'image-gen').every((n) => n.data.profileId === img.id)).toBe(true)
    expect(g.nodes.filter((n) => n.type === 'video-gen').every((n) => n.data.profileId === vid.id)).toBe(true)
    // a second import does not create the subjects again
    const again = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/import-drama`, payload: { files: [JSON.stringify(fixture('cast'))] } })
    expect(again.json().counts.subjects).toBe(0)
    // nothing usable is refused with a reason
    const bad = await app.inject({ method: 'POST', url: `/api/projects/${p.id}/import-drama`, payload: { files: [{ hello: 1 }] } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toMatch(/认不出这个文件/)
  })

  it('MiniMax H3 as the video model: the segments take the file’s H3 prompt; the MCP tool reads local files', async () => {
    store.createProfile({ name: 'H3', kind: 'video', adapter: 'minimax', endpoint: 'http://127.0.0.1:9/mm', model: 'MiniMax-H3' })
    access.enable()
    const p = store.createProject('x')
    const call = async (args: Record<string, unknown>) => {
      const r = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${access.token()}` }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'import_drama', arguments: args } } })
      return r.json().result
    }
    const ok = await call({ project_id: p.id, paths: ['storyboard', 'script', 'outline'].map((k) => join(FIX, `${k}.json`)) })
    expect(ok.isError).toBeUndefined()
    expect(JSON.parse(ok.content[0].text)).toMatchObject({ protocol: 'h3', segments: 10, imported: expect.arrayContaining(['storyboard', 'script', 'outline']) })
    const v = store.getProject(p.id)!.graph.nodes.find((n) => n.type === 'video-gen')!
    expect(v.data.text).toMatch(/^How the reference pictures align/)
    expect((await call({ project_id: p.id, paths: ['relative.json'] })).content[0].text).toMatch(/绝对路径/)
  })
})

describe('the short-drama director skill (adapted from shuohao-skills)', () => {
  it('is built in, ships its references and license, and allows 15-second segments', async () => {
    const s = skills.get('short-drama-storyboard')!
    expect(s).toMatchObject({ source: 'builtin', kind: 'director', label: '短剧分镜（shuohao）' })
    expect(s.references).toEqual(expect.arrayContaining(['references/shot-writing.md', 'references/seedance-prompt.md', 'references/h3-prompt.md']))
    const llm = store.createProfile({ name: '编剧', kind: 'llm', adapter: 'openai-compat', endpoint: M, model: 'w' })
    chatReply = JSON.stringify({ title: '渡口', shots: [{ title: '雾中上船', visual: '女子抱箱上船', camera: '全景 跟拍 / 近景 固定镜头', dialogue: '', duration: 14, image_prompt: '全景，@沈知微 抱着旧皮箱跑上栈桥', video_prompt: '【镜头1】\n运镜：跟拍\n画面：一名年轻女子抱箱快步上船\n台词：{}\n【约束】\n1. 保持无字幕，避免生成任何文字或字幕' }] })
    const last = await run({ version: 1, nodes: [
      { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: '雾天渡口，一个抱着旧皮箱的姑娘最后一个上船。' } },
      { id: 'd', type: 'director', position: { x: 400, y: 0 }, data: { profileId: llm.id, params: { skill: 'short-drama-storyboard', shots: 1 } } },
    ], edges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 'd', targetHandle: 'in' }] })
    expect(last.get('d').status).toBe('done')
    const system = chats[0].messages[0].content as string
    expect(system).toContain('短剧分镜')
    expect(system).toContain('## 参考文件 references/seedance-prompt.md')
    expect(system).toContain('duration 是 2 到 15 之间的整数')
    expect(last.get('d').outputs.out[0].shots[0]).toMatchObject({ duration: 14, imagePrompt: expect.stringContaining('@沈知微') })
  })
})

describe('negative prompt as a node parameter', () => {
  it('is used when nothing is wired into the negative port', async () => {
    const img = store.createProfile({ name: '画图', kind: 'image', adapter: 'openai-compat', endpoint: M, model: 'gpt-image-1' })
    await run({ version: 1, nodes: [
      { id: 'g', type: 'image-gen', position: { x: 0, y: 0 }, data: { profileId: img.id, text: 'a cat', params: { negative: 'text, watermark' } } },
    ], edges: [] })
    expect(imagePrompts).toEqual(['a cat\n\nAvoid: text, watermark'])
  })
})
