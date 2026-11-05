import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectGraph, RunEvent } from '@hzc/core'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { parseSkill, SkillStore } from './skills'

const BUILTIN = fileURLToPath(new URL('../skills', import.meta.url))
const skillMd = (name: string, desc = 'Does a thing. Use when testing.', body = '# Body\n\nDo it well.') => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`

// ------------------------------------------------ mock LLM
let mock: FastifyInstance
let M = ''
let replies: string[] = []
const seen: { system: string; user: string }[] = []
beforeAll(async () => {
  mock = Fastify()
  mock.post('/v1/chat/completions', async (req) => {
    const msgs = (req.body as { messages: { role: string; content: string }[] }).messages
    seen.push({ system: msgs.find((m) => m.role === 'system')?.content ?? '', user: msgs.at(-1)!.content })
    return { choices: [{ message: { content: replies.shift() ?? 'no more replies' } }] }
  })
  await mock.listen({ port: 0, host: '127.0.0.1' })
  M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}/v1`
})
afterAll(async () => { await mock.close() })

let dir: string, store: Store, skills: SkillStore, engine: Engine, app: FastifyInstance
beforeEach(async () => {
  replies = []; seen.length = 0
  dir = mkdtempSync(join(tmpdir(), 'hzc-dir-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  const assets = new AssetStore(dir, store)
  skills = new SkillStore(BUILTIN, dir)
  engine = new Engine(store, assets, { skills })
  app = await buildApp({ store, assets, engine, skills })
})
afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

describe('built-in skills', () => {
  it('every built-in SKILL.md is valid per the Agent Skills spec and matches its folder', () => {
    const dirs = readdirSync(BUILTIN)
    expect(dirs.length).toBeGreaterThanOrEqual(3)
    for (const d of dirs) {
      const s = parseSkill(readFileSync(join(BUILTIN, d, 'SKILL.md'), 'utf8'), 'builtin', d) // throws on any violation
      expect(s.metadata['hzc-kind']).toBe('director')
    }
    expect(skills.list().map((s) => s.name)).toEqual(expect.arrayContaining(['director-short-film', 'director-product-ad', 'storyboard-from-script']))
  })
})

describe('SKILL.md validation', () => {
  it('accepts folded descriptions and metadata', () => {
    const s = parseSkill('---\nname: my-skill\ndescription: >-\n  Two lines\n  folded.\nmetadata:\n  version: 1.0\n---\nBody', 'user')
    expect(s.description).toBe('Two lines folded.')
    expect(s.metadata.version).toBe('1')
  })
  it.each([
    ['Upper', 'uppercase'], ['-lead', 'leading hyphen'], ['trail-', 'trailing hyphen'], ['a--b', 'double hyphen'], ['a'.repeat(65), 'too long'], ['../etc', 'path'],
  ])('rejects name %s (%s)', (name) => {
    expect(() => parseSkill(skillMd(name), 'user')).toThrow(/name/)
  })
  it('rejects missing/oversized description, missing frontmatter, empty body and folder mismatch', () => {
    expect(() => parseSkill('---\nname: x\n---\nbody', 'user')).toThrow(/description/)
    expect(() => parseSkill(skillMd('x', 'y'.repeat(1025)), 'user')).toThrow(/description/)
    expect(() => parseSkill('# no frontmatter', 'user')).toThrow(/frontmatter/)
    expect(() => parseSkill(skillMd('x', 'd', ''), 'user')).toThrow(/正文/)
    expect(() => parseSkill(skillMd('x'), 'user', 'other-dir')).toThrow(/文件夹/)
  })
})

describe('skills API', () => {
  it('lists, imports, reads and deletes user skills; protects built-ins', async () => {
    const list = (await app.inject({ url: '/api/skills' })).json()
    expect(list.find((s: any) => s.name === 'director-short-film')).toMatchObject({ source: 'builtin', label: '短片导演' })
    expect(list[0].body).toBeUndefined() // list is metadata only

    const created = await app.inject({ method: 'POST', url: '/api/skills', payload: { content: skillMd('my-director', '我的导演风格。', '# 我的导演\n\n多用长镜头。') } })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ name: 'my-director', source: 'user' })
    expect((await app.inject({ url: '/api/skills/my-director' })).json().body).toContain('多用长镜头')

    expect((await app.inject({ method: 'POST', url: '/api/skills', payload: { content: skillMd('director-short-film') } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/skills', payload: { content: '# nope' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'DELETE', url: '/api/skills/director-short-film' })).statusCode).toBe(400)
    expect((await app.inject({ url: '/api/skills/..%2F..%2Fmaster.key' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/skills/my-director' })).statusCode).toBe(204)
    expect((await app.inject({ url: '/api/skills/my-director' })).statusCode).toBe(404)
  })
})

describe('director node', () => {
  const GOOD = JSON.stringify({
    title: '雨夜机械猫',
    shots: [
      { title: '开场', visual: '雨夜霓虹街道', camera: '远景，缓慢推进', dialogue: '', duration: 5, image_prompt: '雨夜霓虹街道，电影感', video_prompt: '雨滴落下，镜头缓慢推进' },
      { title: '相遇', visual: '机械猫抬头', camera: '特写', dialogue: '你也迷路了吗？', duration: 3, image_prompt: '机械猫特写，电影感', video_prompt: '猫缓缓抬头' },
    ],
  })
  function graph(profileId: string, params: Record<string, unknown> = {}): ProjectGraph {
    return {
      version: 1,
      nodes: [
        { id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: '雨夜里，一只机械猫在找回家的路' } },
        { id: 'd', type: 'director', position: { x: 400, y: 0 }, data: { profileId, params } },
      ],
      edges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 'd', targetHandle: 'in' }],
    }
  }
  const llm = () => store.createProfile({ name: 'llm', kind: 'llm', adapter: 'openai-compat', endpoint: M, model: 'm', defaults: {} })
  async function run(projectId: string) {
    const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/run`, payload: {} })
    const events = await engine.wait(res.json().runId)
    const last = new Map<string, any>()
    for (const e of events) if (e.kind === 'node') last.set(e.nodeId, e.state)
    return { last, end: events.at(-1) as Extract<RunEvent, { kind: 'run-end' }> }
  }

  it('sends skill + output contract as the system prompt and returns a normalised storyboard', async () => {
    replies = ['好的！\n```json\n' + GOOD + '\n```']
    const p = store.createProject('t', graph(llm().id, { skill: 'director-product-ad', shots: 2, aspect_ratio: '9:16', style: '赛博朋克', lang: 'en' }))
    const { last, end } = await run(p.id)
    expect(end.status).toBe('done')
    const sb = last.get('d').outputs.out[0]
    expect(sb).toMatchObject({ type: 'storyboard', title: '雨夜机械猫' })
    expect(sb.shots).toHaveLength(2)
    expect(sb.shots[1]).toMatchObject({ index: 2, dialogue: '你也迷路了吗？', imagePrompt: '机械猫特写，电影感' })
    expect(seen[0]!.system).toContain('产品广告导演')
    expect(seen[0]!.system).toContain('shots 恰好 2 个')
    expect(seen[0]!.system).toContain('9:16')
    expect(seen[0]!.system).toContain('赛博朋克')
    expect(seen[0]!.system).toContain('用英文书写')
    expect(seen[0]!.user).toContain('机械猫在找回家的路')
  })

  it('retries once when the reply is not valid JSON', async () => {
    replies = ['抱歉，我先想一想……', GOOD]
    const p = store.createProject('t', graph(llm().id))
    const { last } = await run(p.id)
    expect(last.get('d').status).toBe('done')
    expect(seen).toHaveLength(2)
    expect(seen[1]!.user).toContain('无法解析')
  })

  it('fails clearly after two unusable replies', async () => {
    replies = ['不行', '还是不行']
    const { last } = await run(store.createProject('t', graph(llm().id)).id)
    expect(last.get('d').error).toMatch(/两次都没有返回有效分镜/)
  })

  it('reports an unknown skill and re-runs when a user skill changes', async () => {
    const bad = await run(store.createProject('t', graph(llm().id, { skill: 'nope' })).id)
    expect(bad.last.get('d').error).toMatch(/找不到 Skill/)

    skills.import(skillMd('my-director', 'v1', '# v1'))
    const p = store.createProject('t', graph(llm().id, { skill: 'my-director' }))
    replies = [GOOD]; await run(p.id)
    replies = [GOOD]; expect((await run(p.id)).last.get('d').status).toBe('cached')
    skills.remove('my-director'); skills.import(skillMd('my-director', 'v2', '# v2 更多特写'))
    replies = [GOOD]; expect((await run(p.id)).last.get('d').status).toBe('done')
    expect(seen.at(-1)!.system).toContain('v2 更多特写')
  })
})
