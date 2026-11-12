import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'
import { AccountStore } from './accounts'
import { Workspaces } from './workspaces'
import { AgentAccess, hubFor, type ChangeEvent } from './agent'

/* rc.16: agents on the canvas over MCP (Claude Code etc.) */

const BUILTIN = fileURLToPath(new URL('../skills', import.meta.url))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==', 'base64')

let mock: FastifyInstance
let M = ''
let images = 0
const prompts: string[] = []
beforeAll(async () => {
  mock = Fastify({ bodyLimit: 50 * 1024 * 1024 })
  mock.post('/v1/images/generations', async (req) => {
    images++
    prompts.push((req.body as { prompt: string }).prompt)
    return { data: [{ b64_json: Buffer.concat([PNG, Buffer.from([images])]).toString('base64') }] }
  })
  await mock.listen({ port: 0, host: '127.0.0.1' })
  M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}/v1`
})
afterAll(async () => { await mock.close() })

let dir: string, store: Store, assets: AssetStore, engine: Engine, app: FastifyInstance, access: AgentAccess
beforeEach(async () => {
  images = 0; prompts.length = 0
  dir = mkdtempSync(join(tmpdir(), 'hzc-mcp-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  assets = new AssetStore(dir, store)
  const skills = new SkillStore(BUILTIN, dir)
  engine = new Engine(store, assets, { pollDelays: [5], skills })
  access = new AgentAccess(dir)
  app = await buildApp({ store, assets, engine, skills, agentAccess: access, localFiles: true })
})
afterEach(async () => { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })

let seq = 0
const rpc = async (method: string, params: unknown, key = access.token(), headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/mcp', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers }, payload: { jsonrpc: '2.0', id: ++seq, method, params } })
/** call a tool; returns its parsed JSON answer (or the raw result for errors / images) */
async function tool(name: string, args: Record<string, unknown> = {}) {
  const res = await rpc('tools/call', { name, arguments: args })
  expect(res.statusCode, res.body).toBe(200)
  const r = res.json().result as { content: { type: string; text?: string }[]; isError?: boolean }
  if (r.isError) return { error: r.content[0]!.text! } as Record<string, any>
  return r.content.length === 1 && r.content[0]!.type === 'text' ? JSON.parse(r.content[0]!.text!) : r
}

describe('MCP access', () => {
  it('is off until allowed in the settings; then needs the key', async () => {
    let res = await rpc('initialize', {}, 'hzc_whatever_key_that_is_long_enough')
    expect(res.statusCode).toBe(401)
    expect(res.json().error.message).toMatch(/Agent access is off/)
    const on = await app.inject({ method: 'POST', url: '/api/agent-access', payload: { action: 'enable' } })
    expect(on.json()).toMatchObject({ mode: 'local', enabled: true, localFiles: true })
    const key = on.json().token as string
    expect(key).toMatch(/^hzc_/)
    expect((await rpc('initialize', {}, 'hzc_wrong_wrong_wrong_wrong_wrong')).statusCode).toBe(401)
    res = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } }, key)
    expect(res.statusCode).toBe(200)
    expect(res.json().result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'haizhu-infinity-canvas' }, capabilities: { tools: {} } })
    expect(res.json().result.instructions).toMatch(/confirm_cost/)
    // an unknown protocol version gets ours; a notification gets 202 and no body
    expect((await rpc('initialize', { protocolVersion: '1999-01-01' }, key)).json().result.protocolVersion).toBe('2025-11-25')
    const note = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${key}` }, payload: { jsonrpc: '2.0', method: 'notifications/initialized' } })
    expect(note.statusCode).toBe(202)
    expect(note.body).toBe('')
    // a new key replaces the old one; turning it off locks agents out again
    const rotated = (await app.inject({ method: 'POST', url: '/api/agent-access', payload: { action: 'rotate' } })).json().token
    expect(rotated).not.toBe(key)
    expect((await rpc('ping', {}, key)).statusCode).toBe(401)
    expect((await rpc('ping', {}, rotated)).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: '/api/agent-access' })).statusCode).toBe(204)
    expect((await rpc('ping', {}, rotated)).statusCode).toBe(401)
  })

  it('refuses web pages from other sites, unknown protocol versions; GET has no stream', async () => {
    access.enable()
    expect((await rpc('ping', {}, access.token(), { origin: 'https://evil.example' })).statusCode).toBe(403)
    expect((await rpc('ping', {}, access.token(), { 'mcp-protocol-version': '2099-01-01' })).statusCode).toBe(400)
    expect((await app.inject({ method: 'GET', url: '/mcp' })).statusCode).toBe(405)
    expect((await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })).statusCode).toBe(404)
    const list = await rpc('tools/list', {})
    const names = list.json().result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(expect.arrayContaining(['list_projects', 'get_canvas', 'add_nodes', 'run', 'wait_for_run', 'get_results', 'view_asset', 'prompt_guide']))
    expect((await rpc('nope', {})).json().error.code).toBe(-32601)
  })
})

describe('MCP tools', () => {
  beforeEach(() => { access.enable() })

  it('builds a workflow, asks before paid generation, runs it and reads the result', async () => {
    const img = store.createProfile({ name: '画图', kind: 'image', adapter: 'openai-compat', endpoint: M, model: 'gpt-image-1', apiKey: 'k', cost: { amount: 0.3, currency: 'CNY' } })
    const events: ChangeEvent[] = []
    hubFor(store).on((e) => events.push(e))
    const { project_id } = await tool('create_project', { name: 'Agent 画布' })
    const models = await tool('list_models')
    expect(models.models).toEqual([expect.objectContaining({ name: '画图', kind: 'image', price_per_call: { amount: 0.3, currency: 'CNY' } })])
    expect(JSON.stringify(models)).not.toContain('"k"')

    // a wrong wire is refused with the reason, and nothing is saved
    const bad = await tool('add_nodes', { project_id, nodes: [{ key: 'p', type: 'text', text: 'x' }, { key: 'g', type: 'image-gen' }], edges: [{ from: 'p', to: 'g', to_port: 'ref' }] })
    expect(bad.error).toMatch(/类型不兼容/)
    expect(store.getProject(project_id)!.graph.nodes).toHaveLength(0)

    const added = await tool('add_nodes', {
      project_id,
      nodes: [{ key: 'idea', type: 'text', text: '一只橘猫坐在礁石上看日落' }, { key: 'pic', type: 'image-gen', params: { aspect_ratio: '16:9', count: 1, bogus: 1 } }],
      edges: [{ from: 'idea', to: 'pic', to_port: 'prompt' }],
    })
    expect(Object.keys(added.created)).toEqual(['idea', 'pic'])
    expect(added.warnings).toEqual([expect.stringMatching(/bogus/)])
    const pic = added.created.pic
    const canvas = await tool('get_canvas', { project_id })
    expect(canvas.nodes.find((n: any) => n.id === pic)).toMatchObject({ type: 'image-gen', params: { aspect_ratio: '16:9', count: 1 }, model: { id: img.id, name: '画图' } })
    expect(canvas.edges).toEqual([{ from: added.created.idea, from_port: 'out', to: pic, to_port: 'prompt' }])
    expect(events.some((e) => e.kind === 'project' && e.projectId === project_id && e.source === 'agent')).toBe(true)

    // paid work waits for the person's go-ahead
    const ask = await tool('run', { project_id })
    expect(ask).toMatchObject({ started: false, needs_confirmation: true, totals: { CNY: 0.3 } })
    expect(images).toBe(0)
    const done = await tool('run', { project_id, confirm_cost: true, wait_seconds: 30 })
    expect(done).toMatchObject({ started: true, status: 'done' })
    expect(prompts).toEqual(['一只橘猫坐在礁石上看日落'])
    expect(events.some((e) => e.kind === 'run')).toBe(true)

    const results = await tool('get_results', { project_id, node_ids: [pic] })
    const out = results.results[0].outputs.out[0]
    expect(out).toMatchObject({ type: 'image', mime: 'image/png' })
    expect(out.path).toContain(dir)
    const view = await tool('view_asset', { asset_id: out.asset_id })
    expect(view.content.map((c: { type: string }) => c.type)).toEqual(['text', 'image'])

    // change the prompt: only that node runs again
    await tool('update_node', { project_id, node_id: added.created.idea, text: '一只橘猫在雨中奔跑' })
    expect((await tool('estimate', { project_id })).calls).toHaveLength(1)
    const again = await tool('run', { project_id, confirm_cost: true })
    expect((await tool('wait_for_run', { run_id: again.run_id, timeout_seconds: 30 })).status).toBe('done')
    expect(prompts).toEqual(['一只橘猫坐在礁石上看日落', '一只橘猫在雨中奔跑'])

    const removed = await tool('remove', { project_id, node_ids: [added.created.idea] })
    expect(removed).toEqual({ removed_nodes: 1, removed_edges: 1 })
  })

  it('uploads local files as input nodes and subjects; prompt_guide follows the target model', async () => {
    store.createProfile({ name: 'Seedance', kind: 'video', adapter: 'ark', endpoint: 'http://127.0.0.1:9/ark', model: 'doubao-seedance-2-5', apiKey: 'k' })
    const { project_id } = await tool('create_project', { name: 'x' })
    const file = join(dir, 'cat.png')
    writeFileSync(file, PNG)
    const up = await tool('upload_asset', { path: file, project_id })
    expect(up).toMatchObject({ mime: 'image/png', node_id: expect.stringMatching(/^n_/) })
    expect((await tool('upload_asset', { path: 'relative.png' })).error).toMatch(/绝对路径/)
    const s = await tool('add_nodes', { project_id, nodes: [{ key: 's', type: 'subject', text: '橘色短毛猫', params: { name: '小橘', kind: 'character', images: [up.asset_id] } }, { key: 'v', type: 'video-gen', text: '@小橘 跑向镜头', params: { duration: 5 } }] })
    const canvas = await tool('get_canvas', { project_id })
    expect(canvas.nodes.find((n: any) => n.id === s.created.s)).toMatchObject({ label: '@小橘', text: '橘色短毛猫', params: { name: '小橘', images: [{ assetId: up.asset_id, mime: 'image/png' }] } })
    const guide = await tool('prompt_guide', { project_id, node_id: s.created.v })
    expect(guide).toMatchObject({ family: 'seedance' })
    expect(guide.rules.length).toBeGreaterThan(2)
    expect((await tool('update_node', { project_id, node_id: s.created.v, model: 'nope' })).error).toMatch(/找不到模型/)
  })
})

describe('the page saving a canvas an agent changed', () => {
  it('a save based on an old revision is refused with the current canvas', async () => {
    const p = store.createProject('x')
    const first = await app.inject({ method: 'PUT', url: `/api/projects/${p.id}`, payload: { graph: p.graph, baseRev: p.updatedAt } })
    expect(first.statusCode).toBe(200)
    const stale = await app.inject({ method: 'PUT', url: `/api/projects/${p.id}`, payload: { graph: p.graph, baseRev: p.updatedAt } })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().project.updatedAt).toBe(first.json().updatedAt)
    expect(first.json().updatedAt > p.updatedAt).toBe(true)
  })
})

describe('MCP in accounts mode', () => {
  it('each account has its own key and only ever sees its own canvases', async () => {
    const adir = mkdtempSync(join(tmpdir(), 'hzc-mcp-acct-'))
    const accounts = new AccountStore(join(adir, 'accounts.sqlite'))
    const workspaces = new Workspaces(adir, { secrets: new SecretBox(join(adir, 'master.key')) })
    const a = await buildApp({ accounts: { accounts, workspaces, signup: true } })
    try {
      const keyFor = async (email: string) => {
        const res = await a.inject({ method: 'POST', url: '/api/auth/signup', headers: { origin: 'http://localhost' }, payload: { email, password: 'teal-lantern-42' } })
        const cookie = String(res.headers['set-cookie']).split(';')[0]!
        await a.inject({ method: 'POST', url: '/api/projects', headers: { cookie, origin: 'http://localhost' }, payload: { name: `${email} 的画布` } })
        const on = await a.inject({ method: 'POST', url: '/api/agent-access', headers: { cookie, origin: 'http://localhost' }, payload: {} })
        expect(on.json()).toMatchObject({ mode: 'account', enabled: true })
        return on.json().token as string
      }
      const ka = await keyFor('ann@example.com'), kb = await keyFor('bob@example.com')
      const list = async (key: string) => {
        const res = await a.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${key}` }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_projects', arguments: {} } } })
        return JSON.parse(res.json().result.content[0].text).projects.map((p: { name: string }) => p.name)
      }
      expect(await list(ka)).toEqual(['ann@example.com 的画布'])
      expect(await list(kb)).toEqual(['bob@example.com 的画布'])
      // a wrong key gets nobody's canvases
      const res = await a.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer hzc_not_a_real_key_at_all_0000' }, payload: { jsonrpc: '2.0', id: 1, method: 'ping' } })
      expect(res.statusCode).toBe(401)
    } finally { await a.close(); workspaces.closeAll(); accounts.close(); rmSync(adir, { recursive: true, force: true }) }
  })
})
