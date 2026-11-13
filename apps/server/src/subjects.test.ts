import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GraphNode, ModelProfileInput, ProjectGraph, RunEvent } from '@hzc/core'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'

/* rc.15: subjects (@name) and reference images for video */

const BUILTIN = fileURLToPath(new URL('../skills', import.meta.url))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==', 'base64')
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
const KEY = 'subject_test_key_1'

let mock: FastifyInstance
let M = ''
const hits: { method: string; url: string; body?: any }[] = []
beforeAll(async () => {
  mock = Fastify({ bodyLimit: 50 * 1024 * 1024 })
  mock.addHook('onRequest', async (r) => { hits.push({ method: r.method, url: r.url }) })
  mock.addHook('preHandler', async (r) => { hits.at(-1)!.body = r.body })
  mock.get('/files/out.png', async (_r, reply) => reply.header('content-type', 'image/png').send(PNG))
  mock.get('/files/out.mp4', async (_r, reply) => reply.header('content-type', 'video/mp4').send(MP4))
  mock.post('/v1/images/generations', async () => ({ data: [{ b64_json: PNG.toString('base64') }] }))
  mock.post('/rep/v1/models/:owner/:name/predictions', async () => ({ id: 'p1', status: 'starting' }))
  mock.get('/rep/v1/predictions/p1', async () => ({ id: 'p1', status: 'succeeded', output: [`${M}/files/out.png`] }))
  mock.post('/ark/contents/generations/tasks', async () => ({ id: 'cgt-9' }))
  mock.get('/ark/contents/generations/tasks/cgt-9', async () => ({ id: 'cgt-9', status: 'succeeded', content: { video_url: `${M}/files/out.mp4` } }))
  await mock.listen({ port: 0, host: '127.0.0.1' })
  M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}`
})
afterAll(async () => { await mock.close() })

let dir: string, store: Store, assets: AssetStore, engine: Engine, app: FastifyInstance
beforeEach(async () => {
  hits.length = 0
  dir = mkdtempSync(join(tmpdir(), 'hzc-subject-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  assets = new AssetStore(dir, store)
  engine = new Engine(store, assets, { pollDelays: [5], skills: new SkillStore(BUILTIN, dir) })
  app = await buildApp({ store, assets, engine, skills: new SkillStore(BUILTIN, dir) })
})
afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

const prof = (p: Partial<ModelProfileInput> & Pick<ModelProfileInput, 'kind' | 'adapter' | 'endpoint' | 'model'>) =>
  store.createProfile({ name: p.model, apiKey: KEY, defaults: {}, ...p })

async function run(projectId: string) {
  const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/run`, payload: {} })
  const events = await engine.wait(res.json().runId)
  const last = new Map<string, any>()
  for (const e of events) if (e.kind === 'node') last.set(e.nodeId, e.state)
  return { last, end: events.at(-1) as Extract<RunEvent, { kind: 'run-end' }> }
}

function subjectNode(description = '橘色短毛猫，绿眼睛，戴红色项圈'): GraphNode {
  const a = assets.put(PNG, 'image/png')
  return { id: 's', type: 'subject', position: { x: 0, y: 0 }, data: { text: description, params: { name: '小橘', kind: 'character', images: [{ assetId: a.id, mime: a.mime }] } } }
}
const gen = (type: 'image-gen' | 'video-gen', profileId: string, text: string): GraphNode => ({ id: 'g', type, position: { x: 400, y: 0 }, data: { profileId, text } })
const submits = () => hits.filter((h) => h.method === 'POST' && !h.url.startsWith('/files'))

describe('subjects (@name)', () => {
  it('an image prompt mentioning @小橘 gets the description and the picture as a reference', async () => {
    const pr = prof({ kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'owner/img' })
    const p = store.createProject('t', { version: 1, nodes: [subjectNode(), gen('image-gen', pr.id, '@小橘 坐在海边的礁石上')], edges: [] })
    const { end } = await run(p.id)
    expect(end.status).toBe('done')
    const input = submits()[0]!.body.input
    expect(input.prompt).toBe('小橘 坐在海边的礁石上\n\n设定：\n- 小橘（人物）：橘色短毛猫，绿眼睛，戴红色项圈')
    expect(String(input.image)).toMatch(/^data:image\/png;base64,/)
  })

  it('a model without reference images still gets the description (no error)', async () => {
    const pr = prof({ kind: 'image', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'dall-e-3' })
    const p = store.createProject('t', { version: 1, nodes: [subjectNode(), gen('image-gen', pr.id, '@小橘 在睡觉')], edges: [] })
    const { end } = await run(p.id)
    expect(end.status).toBe('done')
    expect(submits()[0]!.body.prompt).toContain('橘色短毛猫')
  })

  it('editing the subject re-runs what mentions it; other edits elsewhere do not', async () => {
    const pr = prof({ kind: 'image', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'dall-e-3' })
    const graph: ProjectGraph = { version: 1, nodes: [subjectNode(), gen('image-gen', pr.id, '@小橘 在睡觉')], edges: [] }
    const p = store.createProject('t', graph)
    await run(p.id)
    await run(p.id)
    expect(submits()).toHaveLength(1) // cached
    graph.nodes[0]!.data.text = '黑白相间的奶牛猫'
    store.saveProject(p.id, { graph })
    await run(p.id)
    expect(submits()).toHaveLength(2)
    expect(submits()[1]!.body.prompt).toContain('奶牛猫')
  })

  it('the subject node itself outputs its pictures (wire it into 参考图)', async () => {
    const p = store.createProject('t', { version: 1, nodes: [subjectNode()], edges: [] })
    const { last } = await run(p.id)
    expect(last.get('s').outputs.out).toHaveLength(1)
  })
})

describe('video reference images', () => {
  it('Seedance: wired references and subject pictures go in as reference_image', async () => {
    const pr = prof({ kind: 'video', adapter: 'ark', endpoint: `${M}/ark`, model: 'doubao-seedance-2-5' })
    const ref = assets.put(Buffer.concat([PNG, Buffer.from([7])]), 'image/png')
    const p = store.createProject('t', {
      version: 1,
      nodes: [subjectNode(), { id: 'r', type: 'image', position: { x: 0, y: 300 }, data: { assetId: ref.id, mime: 'image/png' } }, gen('video-gen', pr.id, '@小橘 跑向镜头')],
      edges: [{ id: 'e', source: 'r', sourceHandle: 'out', target: 'g', targetHandle: 'ref' }],
    })
    const { end } = await run(p.id)
    expect(end.status).toBe('done')
    const content = submits()[0]!.body.content as any[]
    expect(content.filter((c) => c.role === 'reference_image')).toHaveLength(2)
    expect(content[0].text).toContain('小橘 跑向镜头')
  })

  it('Replicate / fal video: references need _fields.ref; with it they are sent', async () => {
    const a = prof({ kind: 'video', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'owner/vid' })
    const ref = assets.put(PNG, 'image/png')
    const graph = (profileId: string): ProjectGraph => ({
      version: 1,
      nodes: [{ id: 'r', type: 'image', position: { x: 0, y: 0 }, data: { assetId: ref.id, mime: 'image/png' } }, gen('video-gen', profileId, '海浪')],
      edges: [{ id: 'e', source: 'r', sourceHandle: 'out', target: 'g', targetHandle: 'ref' }],
    })
    const bad = await run(store.createProject('t', graph(a.id)).id)
    expect(bad.last.get('g').error).toMatch(/_fields/)
    expect(submits()).toHaveLength(0) // nothing sent
    const b = prof({ kind: 'video', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'owner/vid2', defaults: { _fields: { ref: 'reference_images' } } })
    await run(store.createProject('t', graph(b.id)).id)
    expect(submits()[0]!.body.input.reference_images).toHaveLength(1)
  })

  it('a model without video references says so when one is wired', async () => {
    const pr = prof({ kind: 'video', adapter: 'kling', endpoint: `${M}/kl`, model: 'kling-2.5-turbo' })
    const ref = assets.put(PNG, 'image/png')
    const p = store.createProject('t', {
      version: 1,
      nodes: [{ id: 'r', type: 'image', position: { x: 0, y: 0 }, data: { assetId: ref.id, mime: 'image/png' } }, gen('video-gen', pr.id, '海浪')],
      edges: [{ id: 'e', source: 'r', sourceHandle: 'out', target: 'g', targetHandle: 'ref' }],
    })
    const { last } = await run(p.id)
    expect(last.get('g').error).toMatch(/不接受参考图/)
  })
})
