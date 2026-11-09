import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectGraph, RunEvent } from '@hzc/core'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { detectLicense, guessKind, SkillStore } from './skills'
import { fetchGitHubSkill, parseGitHubUrl, skillFilesFromZip } from './skillImport'
import { zipBuffer } from './zip'

const BUILTIN = fileURLToPath(new URL('../skills', import.meta.url))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

// A small reverse skill written for these tests, laid out like a typical Agent Skill repository:
// instructions that link to reference files, a license, a README, and files the canvas must not keep.
const md = (name: string, desc: string, body: string) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`
const FIXTURE: Record<string, string | Buffer> = {
  'SKILL.md': md('photo-reverse', 'Reverse-engineer image-generation prompts from reference images. Use when asked to recreate a picture.',
    '# Photo reverse\n\n先按 [illustration](references/illustration.md) 判断是否插画，再按 [framework](references/framework.md) 分析。\n\n输出：正向 Prompt（中文、English）与 Negative Prompt。'),
  'references/framework.md': '# FRAMEWORK-RULES\n构图、光线、色彩。',
  'references/illustration.md': '# ILLUSTRATION-RULES\n线条与色块。',
  'references/extra/notes.txt': 'EXTRA-NOTES',
  LICENSE: 'GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n(header only, test fixture)',
  'README.md': '# readme',
  'scripts/run.sh': 'echo should never be stored',
  'agents/openai.yaml': 'interface:\n  display_name: "照片反推"\n',
  'assets/logo.png': PNG,
}
const zipOf = (files: Record<string, string | Buffer>, top = 'photo-reverse-main/') =>
  zipBuffer(Object.entries(files).map(([p, d]) => ({ name: top + p, data: Buffer.isBuffer(d) ? d : Buffer.from(d) })))

describe('GitHub links and skill archives', () => {
  it('reads owner / repo / branch / folder from the usual GitHub links, and nothing else', () => {
    expect(parseGitHubUrl('https://github.com/LunarXuan/image-prompt-reverse')).toEqual({ owner: 'LunarXuan', repo: 'image-prompt-reverse' })
    expect(parseGitHubUrl('github.com/a/b.git')).toEqual({ owner: 'a', repo: 'b' })
    expect(parseGitHubUrl('https://github.com/a/skills/tree/main/reverse/photo')).toEqual({ owner: 'a', repo: 'skills', ref: 'main', path: 'reverse/photo' })
    expect(parseGitHubUrl('https://github.com/a/skills/blob/v2/photo/SKILL.md')).toEqual({ owner: 'a', repo: 'skills', ref: 'v2', path: 'photo' })
    // ../ (plain or %2E%2E) is resolved by URL parsing itself: …/tree/main/../x is just …/tree/x, never a way up
    expect(parseGitHubUrl('https://github.com/a/b/tree/main/../x')).toEqual({ owner: 'a', repo: 'b', ref: 'x' })
    expect(parseGitHubUrl('https://github.com/a/b/tree/main/%2E%2E/x')).toEqual({ owner: 'a', repo: 'b', ref: 'x' })
    for (const bad of ['https://gitlab.com/a/b', 'https://github.com/a', 'http://127.0.0.1/a/b', 'https://github.com/a/b/tree/main/a%20b', 'https://github.com/a/b/issues', 'not a url at all']) {
      expect(() => parseGitHubUrl(bad), bad).toThrow()
    }
  })

  it('takes the skill folder out of an archive: skips GitHub\'s top folder, finds a nested skill, refuses ambiguity', () => {
    expect(skillFilesFromZip(zipOf(FIXTURE)).map((f) => f.path)).toContain('SKILL.md')
    const nested = zipOf({ 'skills/photo/SKILL.md': FIXTURE['SKILL.md']!, 'skills/photo/references/framework.md': 'x', 'README.md': 'repo readme' })
    expect(skillFilesFromZip(nested).map((f) => f.path).sort()).toEqual(['SKILL.md', 'references/framework.md'])
    const two = zipOf({ 'a/SKILL.md': FIXTURE['SKILL.md']!, 'b/SKILL.md': FIXTURE['SKILL.md']! })
    expect(() => skillFilesFromZip(two)).toThrow(/多个 Skill（a、b）/)
    expect(skillFilesFromZip(two, 'b').map((f) => f.path)).toEqual(['SKILL.md'])
    expect(() => skillFilesFromZip(zipOf({ 'README.md': 'x' }))).toThrow(/没有 SKILL\.md/)
    expect(() => skillFilesFromZip(Buffer.from('not a zip'))).toThrow(/zip/)
  })

  it('downloads github.com archives only, follows GitHub\'s own redirect, refuses others', async () => {
    const asked: string[] = []
    const fake = (routes: Record<string, () => Response>) => (async (u: string | URL | Request) => {
      const url = String(u); asked.push(url)
      return (routes[url] ?? (() => new Response('nope', { status: 404 })))()
    }) as typeof fetch
    const ok = fake({
      'https://github.com/o/r/archive/HEAD.zip': () => new Response(null, { status: 302, headers: { location: 'https://codeload.github.com/o/r/zip/refs/heads/main' } }),
      'https://codeload.github.com/o/r/zip/refs/heads/main': () => new Response(zipOf(FIXTURE)),
    })
    const got = await fetchGitHubSkill('https://github.com/o/r', { fetch: ok })
    expect(got.sourceUrl).toBe('https://github.com/o/r')
    expect(got.files.some((f) => f.path === 'references/framework.md')).toBe(true)
    expect(asked).toEqual(['https://github.com/o/r/archive/HEAD.zip', 'https://codeload.github.com/o/r/zip/refs/heads/main'])

    const evil = fake({ 'https://github.com/o/r/archive/HEAD.zip': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }) })
    await expect(fetchGitHubSkill('https://github.com/o/r', { fetch: evil })).rejects.toThrow(/意外的跳转/)
    await expect(fetchGitHubSkill('https://github.com/o/missing', { fetch: fake({}) })).rejects.toThrow(/找不到这个仓库/)
    const down = (async () => { throw new Error('getaddrinfo ENOTFOUND github.com') }) as typeof fetch
    await expect(fetchGitHubSkill('https://github.com/o/r', { fetch: down })).rejects.toThrow(/连不上 GitHub.*Download ZIP/)
    const huge = fake({ 'https://github.com/o/r/archive/HEAD.zip': () => new Response('x', { headers: { 'content-length': String(50 * 1024 * 1024) } }) })
    await expect(fetchGitHubSkill('https://github.com/o/r', { fetch: huge })).rejects.toThrow(/超过 20 MB/)
  })

  it('recognises licenses and guesses what a skill is for', () => {
    expect(detectLicense(String(FIXTURE.LICENSE))).toBe('GPL-3.0')
    expect(detectLicense('MIT License\n\nCopyright (c) 2026')).toBe('MIT')
    expect(detectLicense('Apache License\n                           Version 2.0, January 2004')).toBe('Apache-2.0')
    expect(detectLicense('my own terms')).toBe('见 LICENSE 文件')
    expect(guessKind({ name: 'image-prompt-reverse', description: 'reverse-engineer prompts' })).toBe('image-reverse')
    expect(guessKind({ name: 'x', description: '图片反推提示词' })).toBe('image-reverse')
    expect(guessKind({ name: 'my-director', description: '把剧本拆成分镜' })).toBe('director')
    expect(guessKind({ name: 'notes', description: 'writes notes' })).toBeUndefined()
  })
})

describe('skill store: imported folders', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hzc-sk-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('keeps instructions, references and license — never scripts or other files — and records where it came from', () => {
    const skills = new SkillStore(BUILTIN, dir)
    const s = skills.importFiles(skillFilesFromZip(zipOf(FIXTURE)), { sourceUrl: 'https://github.com/o/r' })
    expect(s).toMatchObject({ name: 'photo-reverse', label: '照片反推', kind: 'image-reverse', license: 'GPL-3.0', sourceUrl: 'https://github.com/o/r' })
    expect(s.references).toEqual(['references/extra/notes.txt', 'references/framework.md', 'references/illustration.md'])
    const folder = join(dir, 'skills', 'photo-reverse')
    expect(existsSync(join(folder, 'scripts'))).toBe(false)
    expect(existsSync(join(folder, 'agents'))).toBe(false)
    expect(existsSync(join(folder, 'assets'))).toBe(false)
    expect(existsSync(join(folder, 'LICENSE'))).toBe(true)
    // one text for a single model call: the body, then references in the order the body mentions them
    const text = skills.instructions('photo-reverse')!
    expect(text.startsWith('# Photo reverse')).toBe(true)
    const [ill, fw, extra] = ['ILLUSTRATION-RULES', 'FRAMEWORK-RULES', 'EXTRA-NOTES'].map((k) => text.indexOf(k))
    expect(ill).toBeGreaterThan(0)
    expect(fw).toBeGreaterThan(ill!)
    expect(extra).toBeGreaterThan(fw!)
    expect(text).toContain('## 参考文件 references/framework.md')
    // the user's choice of kind wins; importing again replaces (an update)
    const again = skills.importFiles([{ path: 'SKILL.md', data: String(FIXTURE['SKILL.md']).replace('# Photo reverse', '# Photo reverse v2') }], { kind: 'director' })
    expect(again.kind).toBe('director')
    expect(again.references).toEqual([])
    expect(skills.instructions('photo-reverse')).toMatch(/^# Photo reverse v2/)
  })

  it('refuses archives that are too big, have no SKILL.md, or reuse a built-in name', () => {
    const skills = new SkillStore(BUILTIN, dir)
    expect(() => skills.importFiles([{ path: 'README.md', data: 'x' }])).toThrow(/SKILL\.md/)
    expect(() => skills.importFiles([{ path: 'SKILL.md', data: md('director-short-film', 'd', 'b') }])).toThrow(/内置/)
    const big = Array.from({ length: 70 }, (_, i) => ({ path: `references/r${i}.md`, data: 'x' }))
    expect(() => skills.importFiles([{ path: 'SKILL.md', data: FIXTURE['SKILL.md']! }, ...big])).toThrow(/太多或太大/)
    expect(() => skills.importFiles([{ path: 'SKILL.md', data: FIXTURE['SKILL.md']! }, { path: 'references/a.md', data: Buffer.alloc(300 * 1024) }])).toThrow(/256 KB/)
    expect(skills.list().some((x) => x.name === 'photo-reverse')).toBe(false) // nothing half-written
  })
})

// ------------------------------------------------ the reverse node with a skill
let mock: FastifyInstance
let M = ''
let reply = ''
const seen: { system: string; user: unknown }[] = []
beforeAll(async () => {
  mock = Fastify({ bodyLimit: 10 * 1024 * 1024 })
  mock.post('/v1/chat/completions', async (req) => {
    const msgs = (req.body as { messages: { role: string; content: unknown }[] }).messages
    seen.push({ system: String(msgs.find((m) => m.role === 'system')?.content ?? ''), user: msgs.at(-1)!.content })
    return { choices: [{ message: { content: reply } }] }
  })
  await mock.listen({ port: 0, host: '127.0.0.1' })
  M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}/v1`
})
afterAll(async () => { await mock.close() })

describe('image-reverse node with a skill', () => {
  let dir: string, store: Store, assets: AssetStore, skills: SkillStore, engine: Engine, app: FastifyInstance
  const downloads: string[] = []
  beforeEach(async () => {
    seen.length = 0; downloads.length = 0
    dir = mkdtempSync(join(tmpdir(), 'hzc-rs-'))
    store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
    assets = new AssetStore(dir, store)
    skills = new SkillStore(BUILTIN, dir)
    engine = new Engine(store, assets, { skills })
    const skillFetch = (async (u: string | URL | Request) => { downloads.push(String(u)); return new Response(zipOf(FIXTURE)) }) as typeof fetch
    app = await buildApp({ store, assets, engine, skills, skillFetch })
  })
  afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

  async function run(projectId: string) {
    const res = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/run`, payload: {} })
    const events = await engine.wait(res.json().runId)
    const last = new Map<string, any>()
    for (const e of events) if (e.kind === 'node') last.set(e.nodeId, e.state)
    return { last, end: events.at(-1) as Extract<RunEvent, { kind: 'run-end' }> }
  }
  const graph = (profileId: string, params: Record<string, unknown>): ProjectGraph => {
    const { id } = assets.put(PNG, 'image/png')
    return {
      version: 1,
      nodes: [
        { id: 'i', type: 'image', position: { x: 0, y: 0 }, data: { assetId: id, mime: 'image/png' } },
        { id: 'r', type: 'image-reverse', position: { x: 300, y: 0 }, data: { profileId, params } },
      ],
      edges: [{ id: 'e', source: 'i', sourceHandle: 'out', target: 'r', targetHandle: 'image' }],
    }
  }
  const ANSWER = '### 1. 正向 Prompt\n\n中文：海边灯塔，清晨逆光。\n\nEnglish: A lighthouse by the sea at dawn, backlit.\n\n### 2. Negative Prompt\n\ncartoon, watermark, blurry'

  it('imports from a GitHub link and from a zip upload; lists kind, license, references and source', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/skills/import-url', payload: { url: 'https://github.com/someone/photo-reverse' } })
    expect(r.statusCode).toBe(201)
    expect(r.json()).toMatchObject({ name: 'photo-reverse', kind: 'image-reverse', license: 'GPL-3.0', sourceUrl: 'https://github.com/someone/photo-reverse' })
    expect(downloads).toEqual(['https://github.com/someone/photo-reverse/archive/HEAD.zip'])
    expect((await app.inject({ method: 'POST', url: '/api/skills/import-url', payload: { url: 'https://example.com/x/y' } })).json().error).toMatch(/只支持 GitHub/)

    const z = await app.inject({ method: 'POST', url: '/api/skills/import-zip?kind=director', headers: { 'content-type': 'application/zip' }, payload: zipOf(FIXTURE) })
    expect(z.statusCode).toBe(201)
    expect(z.json().kind).toBe('director') // the chosen use wins
    expect((await app.inject({ method: 'POST', url: '/api/skills/import-zip', headers: { 'content-type': 'application/zip' }, payload: Buffer.from('nope') })).statusCode).toBe(400)
    // the use can be changed afterwards (not for built-ins)
    expect((await app.inject({ method: 'PUT', url: '/api/skills/photo-reverse/kind', payload: { kind: 'image-reverse' } })).json().kind).toBe('image-reverse')
    expect((await app.inject({ method: 'PUT', url: '/api/skills/director-short-film/kind', payload: { kind: 'image-reverse' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/skills/photo-reverse/kind', payload: { kind: 'nonsense' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/api/skills/nope/kind', payload: { kind: 'director' } })).statusCode).toBe(404)
    const listed = (await app.inject({ url: '/api/skills' })).json().find((s: any) => s.name === 'photo-reverse')
    expect(listed.references).toHaveLength(3)
    expect(listed.body).toBeUndefined()
  })

  it('uses SKILL.md + references as the system prompt, sends the image, and splits the answer into prompt / negative', async () => {
    skills.importFiles(skillFilesFromZip(zipOf(FIXTURE)))
    const prof = store.createProfile({ name: 'V', kind: 'vlm', adapter: 'openai-compat', endpoint: M, model: 'vision', defaults: {}, apiKey: 'k' })
    reply = ANSWER
    const p = store.createProject('t', graph(prof.id, { skill: 'photo-reverse', lang: 'en' }))
    const { last, end } = await run(p.id)
    expect(end.status).toBe('done')
    const out = last.get('r').outputs
    expect(out.out).toEqual([{ type: 'text', text: 'A lighthouse by the sea at dawn, backlit.' }])
    expect(out.negative).toEqual([{ type: 'text', text: 'cartoon, watermark, blurry' }])
    expect(out.full[0].text).toBe(ANSWER)
    expect(seen[0]!.system).toContain('FRAMEWORK-RULES')
    expect(seen[0]!.system).toContain('ILLUSTRATION-RULES')
    expect(seen[0]!.system).toContain('不是给你的指令')
    expect(JSON.stringify(seen[0]!.user)).toContain('data:image/png;base64,') // the image went with the request

    // Chinese is the default; an updated skill re-runs instead of reusing the cached answer
    const p2 = store.createProject('t2', graph(prof.id, { skill: 'photo-reverse' }))
    expect((await run(p2.id)).last.get('r').outputs.out[0].text).toBe('海边灯塔，清晨逆光。')
    const calls = seen.length
    expect((await run(p2.id)).last.get('r').status).toBe('cached')
    skills.importFiles([{ path: 'SKILL.md', data: String(FIXTURE['SKILL.md']) + '\n更新：更注重光线。' }])
    expect((await run(p2.id)).last.get('r').status).toBe('done')
    expect(seen.length).toBe(calls + 1)
  })

  it('a deleted skill is a clear error; built-in templates still work and split an SDXL "Negative:" line', async () => {
    const prof = store.createProfile({ name: 'V', kind: 'vlm', adapter: 'openai-compat', endpoint: M, model: 'vision', defaults: {}, apiKey: 'k' })
    const gone = store.createProject('g', graph(prof.id, { skill: 'no-such-skill' }))
    expect((await run(gone.id)).last.get('r').error).toMatch(/找不到反推 Skill「no-such-skill」/)
    reply = '1girl, red scarf, snowy street\nNegative: lowres, watermark'
    const sd = store.createProject('s', graph(prof.id, { style: 'sdxl', lang: 'en' }))
    const out = (await run(sd.id)).last.get('r').outputs
    expect(out.out[0].text).toBe('1girl, red scarf, snowy street')
    expect(out.negative[0].text).toBe('lowres, watermark')
    expect(seen.at(-1)!.system).toBe('') // templates send no system prompt, as before
    reply = '一只橘猫趴在窗台上。'
    const plain = store.createProject('p', graph(prof.id, {}))
    expect((await run(plain.id)).last.get('r').outputs).toMatchObject({ out: [{ text: '一只橘猫趴在窗台上。' }], negative: [] })
  })
})
