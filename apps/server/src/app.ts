import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { createReadStream, existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { ADAPTERS, validateProfileInput, type AdapterId, type ProjectGraph } from '@hzc/core'
import type { Store } from './db'
import type { AssetStore } from './assets'
import type { Engine } from './engine'
import { SkillError, isSkillKind, type SkillStore } from './skills'
import { fetchGitHubSkill, skillFilesFromZip } from './skillImport'
import { ffmpegInfo } from './media'
import { testConnection } from './conntest'
import { runAssistant, type CanvasSummary, type ChatTurn } from './assistant'
import { chatAdapterFor, ProviderError } from './providers'
import { SecretError } from './secrets'
import { BundleError, importBundle, isGraph, planBundle } from './bundle'
import { ZIP_MAX, ZipError, zipChunks } from './zip'

export const APP_VERSION = '1.0.0-rc.7'

export interface AppOptions {
  store: Store
  assets: AssetStore
  engine: Engine
  skills: SkillStore
  /** how GitHub archives are downloaded (tests replace it) */
  skillFetch?: typeof fetch
  /** built web UI directory; if it exists it is served at / */
  webDir?: string
  /**
   * Optional access token for WebUI deployments, sent as the `x-hzc-token` header.
   * Only `GET /api/assets/:id` and `GET /api/projects/:id/bundle` additionally accept `?t=`, because
   * <img>/<video> tags and plain download links cannot send headers.
   */
  accessToken?: string
}

/** strip internal fields from a profile before sending to clients */
function publicProfile<T extends { secretRef: string }>(p: T): Omit<T, 'secretRef'> {
  const { secretRef: _omit, ...rest } = p
  return rest
}

/** project bundles are read into memory; keep well under what a desktop machine can hold */
export const BUNDLE_LIMIT = 2 * 1024 ** 3
const TOKEN_IN_QUERY = /^\/api\/(assets\/[^/?]+|projects\/[^/?]+\/bundle)(\?|$)/

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { store, assets, engine, skills } = opts
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 })

  if (opts.accessToken) {
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/') || req.url === '/api/health') return
      if (req.headers['x-hzc-token'] === opts.accessToken) return
      if (req.method === 'GET' && TOKEN_IN_QUERY.test(req.url) && (req.query as { t?: string })?.t === opts.accessToken) return
      return reply.code(401).send({ error: 'unauthorized' })
    })
  }

  app.get('/api/health', async () => ({ ok: true, name: 'haizhu-infinity-canvas', version: APP_VERSION }))

  /** environment status for Settings: FFmpeg availability (video reverse / export need it) */
  app.get<{ Querystring: { refresh?: string } }>('/api/system', async (req) => {
    const f = await ffmpegInfo(req.query.refresh === '1')
    return { version: APP_VERSION, node: process.versions.node, platform: process.platform, maxParallel: engine.maxParallel, ffmpeg: { ok: f.ok, version: f.version, h264: f.h264, aac: f.aac, error: f.error } }
  })

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

  /** free, read-only connectivity check (lists models where the provider allows it) */
  app.post<{ Body: { adapter?: unknown; endpoint?: unknown; apiKey?: unknown; profileId?: unknown } }>('/api/profiles/test', async (req, reply) => {
    const b = req.body ?? {}
    if (typeof b.adapter !== 'string' || !(ADAPTERS as readonly string[]).includes(b.adapter)) return reply.code(400).send({ error: 'unknown adapter' })
    // editing a saved profile without retyping its key: use the stored one (never sent back)
    let key = typeof b.apiKey === 'string' && b.apiKey ? b.apiKey : undefined
    if (!key && typeof b.profileId === 'string') {
      try { key = store.getApiKey(b.profileId) } catch (e) { return { status: 'error', message: (e as Error).message } }
    }
    return testConnection(b.adapter as AdapterId, typeof b.endpoint === 'string' ? b.endpoint : '', key)
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

  app.post<{ Params: { id: string }; Body: { name?: unknown } }>('/api/projects/:id/duplicate', async (req, reply) => {
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim().slice(0, 100) : undefined
    const p = store.duplicateProject(req.params.id, name)
    return p ? reply.code(201).send(p) : reply.code(404).send({ error: 'not found' })
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    if (engine.isRunning(req.params.id)) return reply.code(409).send({ error: '这个画布正在运行，停止后再删除' })
    return store.deleteProject(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'not found' })
  })

  // ---- portable project bundle (.hzc = zip: project.json + referenced assets), streamed one file at a time
  app.get<{ Params: { id: string } }>('/api/projects/:id/bundle', async (req, reply) => {
    const b = planBundle(store, assets, req.params.id, APP_VERSION)
    if (!b) return reply.code(404).send({ error: 'not found' })
    if (b.size > ZIP_MAX - 64 * 1024 * 1024) return reply.code(413).send({ error: '这个画布引用的素材超过 4 GB，无法打包成一个文件' })
    reply.header('content-type', 'application/zip')
    // no filename here: the page names the download (<a download="画布名.hzc">). Chromium drops a
    // UTF-8 filename* and lets an ASCII filename override the page's name, so neither is sent.
    reply.header('content-disposition', 'attachment')
    reply.header('x-content-type-options', 'nosniff')
    reply.header('cache-control', 'no-store')
    return reply.send(Readable.from(zipChunks(b.entries())))
  })

  app.addContentTypeParser(['application/zip', 'application/x-zip-compressed'], { parseAs: 'buffer', bodyLimit: BUNDLE_LIMIT }, (_req, body, done) => done(null, body))

  app.post('/api/projects/import', { bodyLimit: BUNDLE_LIMIT }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: '请上传 .hzc 项目包' })
    try {
      return reply.code(201).send(importBundle(store, assets, req.body))
    } catch (e) {
      if (e instanceof ZipError) return reply.code(400).send({ error: `项目包无法读取：${e.message}` })
      if (e instanceof BundleError) return reply.code(400).send({ error: e.message })
      throw e
    }
  })

  // ---- assets: raw body upload (Content-Type = media type, X-File-Name = URI-encoded name)
  app.addContentTypeParser(/^(image|video|audio)\//, { parseAs: 'buffer', bodyLimit: 512 * 1024 * 1024 }, (_req, body, done) => done(null, body))

  app.post('/api/assets', { bodyLimit: 512 * 1024 * 1024 }, async (req, reply) => {
    const mime = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (!/^(image|video|audio)\//.test(mime)) return reply.code(415).send({ error: `unsupported media type: ${mime}` })
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ error: 'empty or unsupported upload' })
    let name = 'upload'
    try { name = decodeURIComponent(String(req.headers['x-file-name'] ?? 'upload')) } catch { /* keep default */ }
    try {
      return reply.code(201).send(assets.put(req.body, mime, name))
    } catch (e) {
      return reply.code(415).send({ error: (e as Error).message })
    }
  })

  app.get<{ Querystring: { kind?: string; limit?: string } }>('/api/assets', async (req) => {
    const k = req.query.kind
    const kind = k === 'image' || k === 'video' || k === 'audio' ? k : undefined
    return store.listAssets(kind, Number(req.query.limit ?? 200) || 200)
  })

  app.get<{ Params: { id: string } }>('/api/assets/:id', async (req, reply) => {
    const a = assets.get(req.params.id)
    if (!a) return reply.code(404).send({ error: 'not found' })
    reply.header('content-type', a.mime)
    reply.header('cache-control', 'private, max-age=31536000, immutable')
    reply.header('x-content-type-options', 'nosniff')
    // media plays inline; anything else (editor packages) is only ever a download
    reply.header('content-disposition', /^(image|video|audio)\//.test(a.mime) ? 'inline' : `attachment; filename="${a.id}.${a.mime === 'application/zip' ? 'zip' : 'bin'}"`)
    return reply.send(createReadStream(a.file))
  })

  // ---- prompt library: saved prompts
  app.get('/api/prompts', async () => store.listPrompts())
  app.post<{ Body: { text?: unknown; title?: unknown } }>('/api/prompts', async (req, reply) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 4000) : ''
    if (!text) return reply.code(400).send({ error: '提示词不能为空' })
    const title = (typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : text.replace(/\s+/g, ' ')).slice(0, 40)
    return reply.code(201).send(store.addPrompt(text, title))
  })
  app.delete<{ Params: { id: string } }>('/api/prompts/:id', async (req, reply) =>
    store.deletePrompt(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'not found' }))

  // ---- canvas assistant: a request -> a node plan the user approves before it is added
  app.post<{ Body: { profileId?: unknown; message?: unknown; history?: unknown; canvas?: unknown } }>('/api/assistant', async (req, reply) => {
    const b = req.body ?? {}
    const profile = typeof b.profileId === 'string' ? store.getProfile(b.profileId) : undefined
    if (!profile) return reply.code(400).send({ error: '请先选择一个文本模型' })
    if (profile.kind !== 'llm' && profile.kind !== 'vlm') return reply.code(400).send({ error: '画布助手需要文本模型' })
    const message = typeof b.message === 'string' ? b.message.trim().slice(0, 4000) : ''
    if (!message) return reply.code(400).send({ error: '请输入想做的内容' })
    const history: ChatTurn[] = Array.isArray(b.history)
      ? b.history.filter((t): t is ChatTurn => !!t && typeof t === 'object' && ((t as ChatTurn).role === 'user' || (t as ChatTurn).role === 'assistant') && typeof (t as ChatTurn).content === 'string').slice(-12)
      : []
    const c = b.canvas as Partial<CanvasSummary> | undefined
    const canvas: CanvasSummary | undefined = c && Array.isArray(c.nodes) && Array.isArray(c.edges)
      ? {
          nodes: c.nodes.filter((n) => n && typeof n.id === 'string' && typeof n.type === 'string').slice(0, 200).map((n) => ({ id: n.id, type: n.type, label: typeof n.label === 'string' ? n.label : undefined, text: typeof n.text === 'string' ? n.text : undefined })),
          edges: c.edges.filter((e) => e && typeof e.source === 'string' && typeof e.target === 'string').slice(0, 400),
        }
      : undefined
    let apiKey: string | undefined
    try { apiKey = store.getApiKey(profile.id) } catch (e) { if (e instanceof SecretError) return reply.code(400).send({ error: e.message }); throw e }
    const ctrl = new AbortController()
    // the client went away before the answer was sent (a request's own 'close' fires once its body is read)
    reply.raw.on('close', () => { if (!reply.raw.writableEnded) ctrl.abort() })
    try {
      return await runAssistant({
        profile, apiKey, adapter: chatAdapterFor(profile.adapter), message, history, canvas, signal: ctrl.signal,
        skills: skills.list().filter((x) => x.kind === 'director').map((x) => x.name),
        kinds: [...new Set(store.listProfiles().map((p) => p.kind))],
      })
    } catch (e) {
      if (e instanceof ProviderError) return reply.code(502).send({ error: e.message })
      throw e
    }
  })

  // ---- skills (Agent Skills SKILL.md)
  app.get('/api/skills', async () => skills.list())
  app.get<{ Params: { name: string } }>('/api/skills/:name', async (req, reply) => skills.get(req.params.name) ?? reply.code(404).send({ error: 'not found' }))
  const kindOf = (v: unknown) => (isSkillKind(v) ? v : undefined)
  app.post<{ Body: { content?: unknown; kind?: unknown } }>('/api/skills', async (req, reply) => {
    if (typeof req.body?.content !== 'string') return reply.code(400).send({ error: 'content (SKILL.md text) is required' })
    try {
      const { body: _b, ...meta } = skills.import(req.body.content, { kind: kindOf(req.body.kind) })
      return reply.code(201).send(meta)
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })
  // a skill folder from GitHub (repository or …/tree/<branch>/<folder>); importing again updates it
  app.post<{ Body: { url?: unknown; kind?: unknown } }>('/api/skills/import-url', async (req, reply) => {
    if (typeof req.body?.url !== 'string' || !req.body.url.trim()) return reply.code(400).send({ error: '请填写 GitHub 链接' })
    try {
      const { files, sourceUrl } = await fetchGitHubSkill(req.body.url, { fetch: opts.skillFetch })
      const { body: _b, ...meta } = skills.importFiles(files, { kind: kindOf(req.body.kind), sourceUrl })
      return reply.code(201).send(meta)
    } catch (e) {
      if (e instanceof SkillError) return reply.code(400).send({ error: e.message })
      throw e
    }
  })
  // a skill folder as a .zip (e.g. GitHub's Code → Download ZIP), for when GitHub can't be reached
  app.post<{ Querystring: { kind?: string }; Body: Buffer }>('/api/skills/import-zip', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: '请上传 zip 压缩包' })
    try {
      const { body: _b, ...meta } = skills.importFiles(skillFilesFromZip(req.body), { kind: kindOf(req.query.kind) })
      return reply.code(201).send(meta)
    } catch (e) {
      if (e instanceof SkillError) return reply.code(400).send({ error: e.message })
      throw e
    }
  })
  app.put<{ Params: { name: string }; Body: { kind?: unknown } }>('/api/skills/:name/kind', async (req, reply) => {
    const kind = kindOf(req.body?.kind)
    if (!kind) return reply.code(400).send({ error: 'kind 必须是 director 或 image-reverse' })
    try {
      const s = skills.setKind(req.params.name, kind)
      if (!s) return reply.code(404).send({ error: 'not found' })
      const { body: _b, ...meta } = s
      return meta
    } catch (e) {
      if (e instanceof SkillError) return reply.code(400).send({ error: e.message })
      throw e
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
    res.on('close', () => { clearInterval(ping); unsubscribe() })
  })

  app.get<{ Params: { id: string } }>('/api/projects/:id/outputs', async (req, reply) =>
    store.getProject(req.params.id) ? store.listNodeOutputs(req.params.id) : reply.code(404).send({ error: 'not found' }))

  // ---- result versions (every generation of a node, newest first) and switching between them
  app.get<{ Params: { id: string; nodeId: string } }>('/api/projects/:id/nodes/:nodeId/versions', async (req, reply) =>
    store.getProject(req.params.id) ? store.listNodeVersions(req.params.id, req.params.nodeId) : reply.code(404).send({ error: 'not found' }))

  app.post<{ Params: { id: string; nodeId: string; seq: string } }>('/api/projects/:id/nodes/:nodeId/versions/:seq/use', async (req, reply) => {
    if (!store.getProject(req.params.id)) return reply.code(404).send({ error: 'not found' })
    if (engine.isRunning(req.params.id)) return reply.code(409).send({ error: '运行中不能切换版本，请等运行结束' })
    const cur = store.useNodeVersion(req.params.id, req.params.nodeId, Number(req.params.seq))
    return cur ? { outputs: cur.outputs, finishedAt: cur.finishedAt, versions: store.countNodeVersions(req.params.id, req.params.nodeId) } : reply.code(404).send({ error: 'no such version' })
  })

  // ---- static web UI (SPA fallback)
  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, {
      root: opts.webDir,
      // the build ships .br / .gz next to each text file: send those when the browser accepts them
      preCompressed: true,
      cacheControl: false,
      setHeaders(res, path) {
        // files under assets/ carry a content hash in their name: cache them for good, never ask again.
        // Everything else (index.html, icons) is revalidated, so a new version is picked up at once.
        res.setHeader('cache-control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache')
        res.setHeader('vary', 'accept-encoding')
      },
    })
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' })
      return reply.sendFile('index.html')
    })
  }

  return app
}
