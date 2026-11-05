import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { createReadStream, existsSync } from 'node:fs'
import { validateProfileInput, type ProjectGraph } from '@hzc/core'
import type { Store } from './db'
import type { AssetStore } from './assets'
import type { Engine } from './engine'
import { SkillError, type SkillStore } from './skills'

export const APP_VERSION = '1.0.0-beta.4'

export interface AppOptions {
  store: Store
  assets: AssetStore
  engine: Engine
  skills: SkillStore
  /** built web UI directory; if it exists it is served at / */
  webDir?: string
  /**
   * Optional access token for WebUI deployments, sent as the `x-hzc-token` header.
   * Only `GET /api/assets/:id` additionally accepts `?t=` because <img>/<video> tags cannot send headers.
   */
  accessToken?: string
}

/** strip internal fields from a profile before sending to clients */
function publicProfile<T extends { secretRef: string }>(p: T): Omit<T, 'secretRef'> {
  const { secretRef: _omit, ...rest } = p
  return rest
}

function isGraph(g: unknown): g is ProjectGraph {
  return typeof g === 'object' && g !== null && (g as ProjectGraph).version === 1 && Array.isArray((g as ProjectGraph).nodes) && Array.isArray((g as ProjectGraph).edges)
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { store, assets, engine, skills } = opts
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 })

  if (opts.accessToken) {
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/') || req.url === '/api/health') return
      if (req.headers['x-hzc-token'] === opts.accessToken) return
      if (req.method === 'GET' && req.url.startsWith('/api/assets/') && (req.query as { t?: string })?.t === opts.accessToken) return
      return reply.code(401).send({ error: 'unauthorized' })
    })
  }

  app.get('/api/health', async () => ({ ok: true, name: 'haizhu-infinity-canvas', version: APP_VERSION }))

  // ---- model profiles
  app.get('/api/profiles', async () => store.listProfiles().map(publicProfile))

  app.post('/api/profiles', async (req, reply) => {
    const v = validateProfileInput(req.body)
    if (!v.ok) return reply.code(400).send({ error: v.error })
    return reply.code(201).send(publicProfile(store.createProfile(v.value)))
  })

  app.put<{ Params: { id: string } }>('/api/profiles/:id', async (req, reply) => {
    const v = validateProfileInput(req.body)
    if (!v.ok) return reply.code(400).send({ error: v.error })
    const p = store.updateProfile(req.params.id, v.value)
    return p ? publicProfile(p) : reply.code(404).send({ error: 'not found' })
  })

  app.delete<{ Params: { id: string } }>('/api/profiles/:id', async (req, reply) =>
    store.deleteProfile(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'not found' }))

  // ---- projects
  app.get('/api/projects', async () => store.listProjects())

  app.post<{ Body: { name?: string; graph?: unknown } }>('/api/projects', async (req, reply) => {
    const name = req.body?.name?.trim() || '未命名画布'
    if (req.body?.graph !== undefined && !isGraph(req.body.graph)) return reply.code(400).send({ error: 'invalid graph' })
    return reply.code(201).send(store.createProject(name, req.body?.graph as ProjectGraph | undefined))
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) =>
    store.getProject(req.params.id) ?? reply.code(404).send({ error: 'not found' }))

  app.put<{ Params: { id: string }; Body: { name?: string; graph?: unknown } }>('/api/projects/:id', async (req, reply) => {
    if (req.body?.graph !== undefined && !isGraph(req.body.graph)) return reply.code(400).send({ error: 'invalid graph' })
    const p = store.saveProject(req.params.id, { name: req.body?.name, graph: req.body?.graph as ProjectGraph | undefined })
    return p ?? reply.code(404).send({ error: 'not found' })
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) =>
    store.deleteProject(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'not found' }))

  // ---- assets: raw body upload (Content-Type = media type, X-File-Name = URI-encoded name)
  app.addContentTypeParser(/^(image|video|audio)\//, { parseAs: 'buffer', bodyLimit: 512 * 1024 * 1024 }, (_req, body, done) => done(null, body))

  app.post('/api/assets', { bodyLimit: 512 * 1024 * 1024 }, async (req, reply) => {
    const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ error: 'empty or unsupported upload' })
    let name = 'upload'
    try { name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'upload')) } catch { /* keep default */ }
    try {
      return reply.code(201).send(assets.put(req.body, mime, name))
    } catch (e) {
      return reply.code(415).send({ error: (e as Error).message })
    }
  })

  app.get<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const a = assets.get(req.params.id)
    if (!a) return reply.code(404).send({ error: 'not found' })
    reply.header('content-type', a.mime)
    reply.header('cache-control', 'private, max-age=31536000, immutable')
    reply.header('x-content-type-options', 'nosniff')
    reply.header('content-disposition', 'inline')
    return reply.send(createReadStream(a.file))
  })

  // ---- skills (Agent Skills SKILL.md)
  app.get('/api/skills', async () => skills.list())
  app.get<{ Params: { name: string } }>('/api/skills/:name', async (req, reply) => skills.get(req.params.name) ?? reply.code(404).send({ error: 'not found' }))
  app.post<{ Body: { content?: unknown } }>('/api/skills', async (req, reply) => {
    if (typeof req.body?.content !== 'string') return reply.code(400).send({ error: 'content (SKILL.md text) is required' })
    try {
      const { body: _b, ...meta } = skills.import(req.body.content)
      return reply.code(201).send(meta)
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })
  app.delete<{ Params: { name: string } }>('/api/skills/:name', async (req, reply) => {
    try {
      return skills.remove(req.params.name) ? reply.code(204).send() : reply.code(404).send({ error: 'not found' })
    } catch (e) {
      if (e instanceof SkillError) return reply.code(400).send({ error: e.message })
      throw e
    }
  })

  // ---- runs
  app.post<{ Params: { id: string }; Body: { nodeIds?: unknown; force?: unknown } }>('/api/projects/:id/run', async (req, reply) => {
    const p = store.getProject(req.params.id)
    if (!p) return reply.code(404).send({ error: 'not found' })
    const nodeIds = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds.filter((x): x is string => typeof x === 'string') : undefined
    if (nodeIds?.some((id) => !p.graph.nodes.find((n) => n.id === id))) return reply.code(400).send({ error: 'unknown node id' })
    const runId = engine.start(p.id, p.graph, { nodeIds, force: req.body?.force === true })
    return reply.code(202).send({ runId })
  })

  app.post<{ Params: { id: string }; Body: { nodeIds?: unknown; force?: unknown } }>('/api/projects/:id/estimate', async (req, reply) => {
    const p = store.getProject(req.params.id)
    if (!p) return reply.code(404).send({ error: 'not found' })
    const nodeIds = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds.filter((x): x is string => typeof x === 'string') : undefined
    try {
      return engine.estimate(p.id, p.graph, { nodeIds, force: req.body?.force === true })
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', async (req, reply) =>
    engine.cancel(req.params.id) ? reply.code(202).send({ ok: true }) : reply.code(404).send({ error: 'no active run' }))

  // Server-Sent Events. The web client reads it with fetch() so it can send the token header.
  app.get<{ Params: { id: string } }>('/api/runs/:id/events', (req, reply) => {
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`)
    // `let` + late assignment: subscribe() replays past events synchronously, before it returns
    let unsubscribe: (() => void) | undefined
    let ended = false
    unsubscribe = engine.subscribe(req.params.id, (e) => {
      send(e)
      if (e.kind === 'run-end') { ended = true; res.end(); unsubscribe?.() }
    })
    if (!unsubscribe) { send({ kind: 'run-end', runId: req.params.id, status: 'error' }); res.end(); return }
    if (ended) return
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
    req.raw.on('close', () => { clearInterval(ping); unsubscribe() })
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/outputs', async (req, reply) =>
    store.getProject(req.params.id) ? store.listNodeOutputs(req.params.id) : reply.code(404).send({ error: 'not found' }))

  // ---- static web UI (SPA fallback)
  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
      return reply.sendFile('index.html')
    })
  }

  return app
}
