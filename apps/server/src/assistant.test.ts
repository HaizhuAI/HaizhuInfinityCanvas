import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'
import { parseAssistant } from './assistant'

const BUILTIN = fileURLToPath(new URL('../skills', import.meta.url))

describe('canvas assistant', () => {
  let mock: FastifyInstance, M = '', dir = '', app: FastifyInstance, store: Store, llmId = ''
  let next: unknown = ''
  let status = 200
  const seen: any[] = []
  beforeAll(async () => {
    mock = Fastify()
    mock.post('/v1/chat/completions', async (req, reply) => {
      seen.push(req.body)
      if (status !== 200) return reply.code(status).send({ error: 'quota' })
      return { choices: [{ message: { content: typeof next === 'string' ? next : JSON.stringify(next) } }] }
    })
    await mock.listen({ port: 0, host: '127.0.0.1' })
    M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}/v1`
    dir = mkdtempSync(join(tmpdir(), 'hzc-asst-'))
    store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
    const assets = new AssetStore(dir, store)
    const skills = new SkillStore(BUILTIN, dir)
    app = await buildApp({ store, assets, engine: new Engine(store, assets, { skills }), skills })
    llmId = store.createProfile({ name: '编剧', kind: 'llm', adapter: 'openai-compat', endpoint: M, model: 'm', defaults: {}, apiKey: 'sk-a' }).id
  })
  afterAll(async () => { await app.close(); store.close(); await mock.close(); rmSync(dir, { recursive: true, force: true }) })
  const ask = (body: object) => app.inject({ method: 'POST', url: '/api/assistant', payload: { profileId: llmId, ...body } })

  it('turns a request into a validated plan and tells the model about the nodes and the canvas', async () => {
    next = {
      reply: '先出首帧，再生成视频。',
      plan: {
        nodes: [
          { key: 'a', type: 'text', label: '画面', text: '雨夜霓虹街头的机械猫' },
          { key: 'b', type: 'image-gen', label: '首帧', params: { aspect_ratio: '16:9', seed: 7, bogus: 'x' } },
          { key: 'c', type: 'video-gen', text: '镜头缓慢推近', params: { duration: 45, aspect_ratio: '16:9' } },
          { key: 'z', type: 'teleporter' },
        ],
        edges: [
          { from: 'a', fromPort: 'out', to: 'b', toPort: 'prompt' },
          { from: 'b', fromPort: 'out', to: 'c', toPort: 'first' },
          { from: 'c', fromPort: 'out', to: 'a', toPort: 'in' },      // text has no inputs
          { from: 'a', fromPort: 'out', to: 'c', toPort: 'first' },   // text -> image port
          { from: 'a', fromPort: 'out', to: 'ghost', toPort: 'in' },
        ],
      },
    }
    const r = await ask({ message: '帮我做一条 5 秒的短视频', canvas: { nodes: [{ id: 'old1', type: 'image', label: '产品图' }], edges: [] } })
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.reply).toBe('先出首帧，再生成视频。')
    expect(body.plan.nodes.map((n: any) => n.type)).toEqual(['text', 'image-gen', 'video-gen'])
    expect(body.plan.nodes[1].params).toEqual({ aspect_ratio: '16:9' })      // unknown params dropped
    expect(body.plan.nodes[2].params).toEqual({ aspect_ratio: '16:9' })      // 45 s is longer than any model takes
    expect(body.plan.edges).toEqual([{ from: 'a', fromPort: 'out', to: 'b', toPort: 'prompt' }, { from: 'b', fromPort: 'out', to: 'c', toPort: 'first' }])
    expect(body.warnings.join('\n')).toMatch(/teleporter/)
    expect(body.warnings.filter((w: string) => /忽略了一条/.test(w))).toHaveLength(3)
    const sent = seen.at(-1)
    expect(sent.messages[0].role).toBe('system')
    expect(sent.messages[0].content).toMatch(/image-gen｜图片生成/)
    expect(sent.messages[0].content).toMatch(/director-short-film/)
    expect(sent.messages[1].content).toMatch(/@old1｜image｜产品图/)
  })

  it('connects to nodes already on the canvas and keeps one wire per single input', async () => {
    next = { reply: '用你的产品图做参考。', plan: { nodes: [{ key: 'g', type: 'image-gen', text: '海边日落' }], edges: [
      { from: '@old1', fromPort: 'out', to: 'g', toPort: 'ref' },
      { from: '@txt', fromPort: 'out', to: 'g', toPort: 'prompt' },
      { from: '@txt2', fromPort: 'out', to: 'g', toPort: 'prompt' },   // prompt takes one wire
    ] } }
    const canvas = { nodes: [{ id: 'old1', type: 'image' }, { id: 'txt', type: 'text' }, { id: 'txt2', type: 'text' }], edges: [] }
    const body = (await ask({ message: '换到海边', canvas, history: [{ role: 'user', content: '之前的话' }, { role: 'assistant', content: '好' }] })).json()
    expect(body.plan.edges).toEqual([{ from: '@old1', fromPort: 'out', to: 'g', toPort: 'ref' }, { from: '@txt', fromPort: 'out', to: 'g', toPort: 'prompt' }])
    expect(body.warnings.join()).toMatch(/只接受一条连线/)
    expect(seen.at(-1).messages[1].content).toMatch(/此前的对话：\n用户：之前的话\n助手：好/)
  })

  it('answers plainly when there is no plan, and reports bad requests and provider errors', async () => {
    next = '你想做竖屏还是横屏？'
    expect((await ask({ message: '做个视频' })).json()).toEqual({ reply: '你想做竖屏还是横屏？', plan: null, warnings: [] })
    next = { reply: '这是一个问答。', plan: null }
    expect((await ask({ message: '图生视频是什么' })).json()).toMatchObject({ reply: '这是一个问答。', plan: null })
    expect((await app.inject({ method: 'POST', url: '/api/assistant', payload: { message: 'x' } })).statusCode).toBe(400)
    expect((await ask({ message: '   ' })).statusCode).toBe(400)
    status = 429
    const err = await ask({ message: '做个视频' })
    status = 200
    expect(err.statusCode).toBe(502)
    expect(err.json().error).toMatch(/429/)
  })

  it('caps the plan size and drops invalid director skills', () => {
    const many = { plan: { nodes: Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, type: 'text' })), edges: [] } }
    expect(parseAssistant(JSON.stringify(many), undefined, []).plan!.nodes).toHaveLength(16)
    const dir = parseAssistant(JSON.stringify({ plan: { nodes: [{ type: 'director', params: { skill: 'evil', shots: 99 } }], edges: [] } }), undefined, ['director-short-film'])
    expect(dir.plan!.nodes[0]!.params).toEqual({})
  })
})
