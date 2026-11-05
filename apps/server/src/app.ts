import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { validateProfileInput, type ProjectGraph } from '@hzc/core'
import type { Store } from './db'

export const APP_VERSION = '1.0.0-beta.1'

export interface AppOptions {
  store: Store
  /** built web UI directory; if it exists it is served at / */
  webDir?: string
  /** optional access token for WebUI deployments (required as `x-hzc-token` header or `token` cookie-less query is NOT supported) */
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
  const { store } = opts
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 })

  if (opts.accessToken) {
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/') || req.url === '/api/health') return
      if (req.headers['x-hzc-token'] !== opts.accessToken) return reply.code(401).send({ error: 'unauthorized' })
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
