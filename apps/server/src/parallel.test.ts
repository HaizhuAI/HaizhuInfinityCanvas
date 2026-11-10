import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectGraph, RunEvent } from '@hzc/core'
import { AssetStore } from './assets'
import { Store } from './db'
import { DEFAULT_MAX_PARALLEL, Engine } from './engine'
import { SecretBox } from './secrets'

// A mock provider that takes a while to answer and records how many calls overlap.
const DELAY = 120
let mock: FastifyInstance
let M = ''
let inFlight = 0, peak = 0
const peakBy = new Map<string, number>(), flightBy = new Map<string, number>()
const bodies: any[] = []
let failOn = ''
async function handle(model: string, text: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }, ok: unknown) {
  inFlight++; peak = Math.max(peak, inFlight)
  flightBy.set(model, (flightBy.get(model) ?? 0) + 1); peakBy.set(model, Math.max(peakBy.get(model) ?? 0, flightBy.get(model)!))
  await new Promise((r) => setTimeout(r, DELAY))
  inFlight--; flightBy.set(model, flightBy.get(model)! - 1)
  return failOn && text.includes(failOn) ? reply.code(500).send({ error: 'boom' }) : ok
}
beforeAll(async () => {
  mock = Fastify({ forceCloseConnections: true }) // a stopped run leaves a request open: don't wait for it on close
  mock.post('/v1/chat/completions', async (req, reply) => {
    const b = req.body as { model: string; messages: { content: string }[] }
    bodies.push(b)
    const text = String(b.messages.at(-1)!.content)
    return handle(b.model, text, reply, { choices: [{ message: { content: `OUT:${text}` } }] })
  })
  mock.post('/api/chat', async (req, reply) => { // ollama
    const b = req.body as { model: string; messages: { content: string }[] }
    const text = String(b.messages.at(-1)!.content)
    return handle('ollama', text, reply, { message: { content: `OUT:${text}` } })
  })
  await mock.listen({ port: 0, host: '127.0.0.1' })
  M = `http://127.0.0.1:${(mock.server.address() as { port: number }).port}`
})
afterAll(async () => { await mock.close() })

let dir: string, store: Store, assets: AssetStore
beforeEach(() => {
  inFlight = 0; peak = 0; peakBy.clear(); flightBy.clear(); bodies.length = 0; failOn = ''
  dir = mkdtempSync(join(tmpdir(), 'hzc-par-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  assets = new AssetStore(dir, store)
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

const llm = (name: string, defaults: Record<string, unknown> = {}, adapter: 'openai-compat' | 'ollama' = 'openai-compat') =>
  store.createProfile({ name, kind: 'llm', adapter, endpoint: adapter === 'ollama' ? M : `${M}/v1`, model: name, defaults, apiKey: adapter === 'ollama' ? undefined : 'k' })

/** n independent "text → llm" rows; row i uses profiles[i % profiles.length] */
function rows(n: number, profiles: string[], extra: Partial<ProjectGraph> = {}): ProjectGraph {
  const nodes: ProjectGraph['nodes'] = [], edges: ProjectGraph['edges'] = []
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `t${i}`, type: 'text', position: { x: 0, y: i * 200 }, data: { text: `row${i}` } })
    nodes.push({ id: `m${i}`, type: 'llm', position: { x: 400, y: i * 200 }, data: { profileId: profiles[i % profiles.length] } })
    edges.push({ id: `e${i}`, source: `t${i}`, sourceHandle: 'out', target: `m${i}`, targetHandle: 'in' })
  }
  return { version: 1, nodes: [...nodes, ...(extra.nodes ?? [])], edges: [...edges, ...(extra.edges ?? [])] }
}

async function run(engine: Engine, graph: ProjectGraph) {
  const p = store.createProject('p', graph)
  const t0 = Date.now()
  const events = await engine.wait(engine.start(p.id, graph))
  const ms = Date.now() - t0
  const last = new Map<string, any>()
  const seq = new Map<string, string[]>()
  for (const e of events) if (e.kind === 'node') { last.set(e.nodeId, e.state); seq.set(e.nodeId, [...(seq.get(e.nodeId) ?? []), e.state.status]) }
  return { ms, last, seq, end: events.at(-1) as Extract<RunEvent, { kind: 'run-end' }>, events }
}

describe('parallel runs', () => {
  it('independent nodes run at the same time, up to 3 per model; one-at-a-time still works', async () => {
    const a = llm('a')
    const par = await run(new Engine(store, assets), rows(6, [a.id]))
    expect(par.end.status).toBe('done')
    expect(peak).toBe(3)                                   // the per-model default
    expect(par.ms).toBeLessThan(DELAY * 6 * 0.75)          // 2 rounds of 3, not 6 in a row
    for (let i = 0; i < 6; i++) {
      expect(par.last.get(`m${i}`).outputs.out[0].text).toBe(`OUT:row${i}`)   // each got its own input
      expect(par.seq.get(`m${i}`)).toEqual(['queued', 'running', 'done'])
    }

    peak = 0
    const b = llm('b')
    const seq = await run(new Engine(store, assets, { maxParallel: 1 }), rows(4, [b.id]))
    expect(peak).toBe(1)
    expect(seq.ms).toBeGreaterThanOrEqual(DELAY * 4 - 20)
    expect(new Engine(store, assets).maxParallel).toBe(DEFAULT_MAX_PARALLEL)
    expect(new Engine(store, assets, { maxParallel: 99 }).maxParallel).toBe(8)
    expect(new Engine(store, assets, { maxParallel: Number('nope') }).maxParallel).toBe(DEFAULT_MAX_PARALLEL)
  })

  it('limits: overall cap across models, a model\'s own setting, and one call at a time per Ollama server', async () => {
    const [a, b] = [llm('a'), llm('b')]
    await run(new Engine(store, assets), rows(8, [a.id, b.id]))
    expect(peak).toBe(DEFAULT_MAX_PARALLEL)                // 3 + 3 would be 6: the overall cap holds it at 4
    expect(peakBy.get('a')).toBeLessThanOrEqual(3)

    peak = 0; peakBy.clear()
    const one = llm('one', { _concurrency: 1 }), six = llm('six', { _concurrency: 6 })
    await run(new Engine(store, assets, { maxParallel: 8 }), rows(8, [one.id, six.id, six.id, six.id]))
    expect(peakBy.get('one')).toBe(1)
    expect(peakBy.get('six')).toBeGreaterThan(3)
    expect(bodies.every((x) => !('_concurrency' in x))).toBe(true)   // canvas settings are never sent to the provider

    peak = 0; peakBy.clear()
    const [o1, o2] = [llm('qwen', {}, 'ollama'), llm('llava', {}, 'ollama')]
    const r = await run(new Engine(store, assets), rows(4, [o1.id, o2.id]))
    expect(r.end.status).toBe('done')
    expect(peakBy.get('ollama')).toBe(1)                   // two local models share the one server
  })

  it('a failure skips only what depends on it; the other branches finish', async () => {
    const a = llm('a')
    failOn = 'row1'
    const g = rows(3, [a.id], {
      nodes: [
        { id: 'after1', type: 'llm', position: { x: 800, y: 200 }, data: { profileId: a.id } },
        { id: 'after2', type: 'llm', position: { x: 800, y: 400 }, data: { profileId: a.id } },
        { id: 'join', type: 'preview', position: { x: 1200, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'x1', source: 'm1', sourceHandle: 'out', target: 'after1', targetHandle: 'in' },
        { id: 'x2', source: 'm2', sourceHandle: 'out', target: 'after2', targetHandle: 'in' },
        { id: 'j0', source: 'm0', sourceHandle: 'out', target: 'join', targetHandle: 'in' },
        { id: 'j2', source: 'after2', sourceHandle: 'out', target: 'join', targetHandle: 'in' },
      ],
    })
    const r = await run(new Engine(store, assets), g)
    expect(r.end.status).toBe('error')
    expect(r.last.get('m1').status).toBe('error')
    expect(r.last.get('after1')).toMatchObject({ status: 'skipped', error: '上游节点未成功' })
    expect(r.last.get('after2').outputs.out[0].text).toBe('OUT:OUT:row2')
    // a node waits for everything upstream, and multi-input ports keep canvas order (top first)
    expect(r.last.get('join').outputs.in.map((v: any) => v.text)).toEqual(['OUT:row0', 'OUT:OUT:row2'])
    const at = (id: string, status: string) => r.events.findIndex((e) => e.kind === 'node' && e.nodeId === id && e.state.status === status)
    expect(at('after2', 'running')).toBeGreaterThan(at('m2', 'done'))
    expect(at('join', 'running')).toBeGreaterThan(at('after2', 'done'))
  })

  it('stopping cancels the calls in flight and everything still waiting, at once', async () => {
    const a = llm('a')
    const g = rows(6, [a.id])
    const p = store.createProject('p', g)
    const engine = new Engine(store, assets)
    const id = engine.start(p.id, g)
    await new Promise((r) => setTimeout(r, DELAY / 3))
    const t0 = Date.now()
    engine.cancel(id)
    const events = await engine.wait(id)
    expect(Date.now() - t0).toBeLessThan(DELAY)            // didn't wait for the calls to answer
    const last = new Map<string, string>()
    for (const e of events) if (e.kind === 'node') last.set(e.nodeId, e.state.status)
    expect((events.at(-1) as any).status).toBe('cancelled')
    for (let i = 0; i < 6; i++) expect(last.get(`m${i}`)).toBe('cancelled')
    expect(engine.isRunning(p.id)).toBe(false)
  })

  it('cached results never take a slot: a second run finishes without any call', async () => {
    const a = llm('a')
    const g = rows(5, [a.id])
    const p = store.createProject('p', g)
    const engine = new Engine(store, assets)
    await engine.wait(engine.start(p.id, g))
    const calls = bodies.length
    const t0 = Date.now()
    const events = await engine.wait(engine.start(p.id, g))
    expect(Date.now() - t0).toBeLessThan(DELAY)
    expect(bodies.length).toBe(calls)
    expect(events.filter((e) => e.kind === 'node' && e.state.status === 'cached')).toHaveLength(5)
  })
})
