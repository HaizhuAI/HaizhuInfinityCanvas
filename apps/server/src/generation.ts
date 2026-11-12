import { randomUUID } from 'node:crypto'
import type { ModelProfile } from '@hzc/core'
import { MIME_ALIAS, MIME_EXT, type AssetStore } from './assets'
import type { JobRow, Store } from './db'
import { ProviderError } from './providers'
import { checkUrl, guardedGet, NetGuardError } from './netguard'
import { attempts, retryDelay, retryError, retryStatus, sleepFor, type RetryPolicy } from './retry'

/* ------------------------------------------------------------------ helpers */

const MAX_DOWNLOAD = Number(process.env.HZC_MAX_DOWNLOAD_BYTES ?? 1024 * 1024 * 1024) // 1 GiB
const EXT_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]))
EXT_MIME.jpeg = 'image/jpeg'

/** Reserved keys inside profile.defaults that configure the adapter rather than being sent to the provider. */
export function providerDefaults(d: Record<string, unknown> | undefined) {
  return Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !k.startsWith('_')))
}

export function base(profile: Pick<ModelProfile, 'endpoint'>, fallback: string) {
  return (profile.endpoint || fallback).replace(/\/+$/, '')
}

function sameOrigin(url: string | undefined, baseUrl: string): string | undefined {
  if (!url) return undefined
  try { return new URL(url).origin === new URL(baseUrl).origin ? url : undefined } catch { return undefined }
}

/**
 * One provider request: checked against the outbound guard, retried per `retry` (see retry.ts):
 * reads are retried on transient failures; starting a paid generation only when it surely was not
 * processed.
 */
export async function call(url: string, init: RequestInit & { apiKey?: string }, signal: AbortSignal, retry: RetryPolicy = 'none'): Promise<{ status: number; json: any; text: string }> {
  try { await checkUrl(url) } catch (e) { throw new ProviderError((e as Error).message) }
  const tries = attempts(retry)
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) })
    } catch (e) {
      if (signal.aborted) throw e
      if (attempt + 1 < tries && retryError(retry, e)) { await sleepFor(retryDelay(attempt), signal); continue }
      const err = e as Error & { cause?: { code?: string } }
      throw new ProviderError(`请求失败：${err.name === 'TimeoutError' ? '超时' : (err.cause?.code ?? err.message)}`)
    }
    if (attempt + 1 < tries && retryStatus(retry, res.status)) { await res.text().catch(() => ''); await sleepFor(retryDelay(attempt, res.headers.get('retry-after')), signal); continue }
    const text = await res.text()
    let json: any
    try { json = text ? JSON.parse(text) : {} } catch { json = undefined }
    return { status: res.status, json, text: init.apiKey ? text.split(init.apiKey).join('***') : text }
  }
}

export function fail(status: number, text: string): never {
  throw new ProviderError(`模型服务返回 ${status}：${text.slice(0, 500)}`)
}

/** Every media-looking URL inside a provider output, in document order (handles strings, arrays, {url}, {images:[…]}, …). */
export function extractMediaUrls(output: unknown): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (/^(https?:\/\/|data:(image|video|audio)\/)/i.test(v)) out.push(v); return }
    if (Array.isArray(v)) { v.forEach(walk); return }
    if (v && typeof v === 'object') for (const val of Object.values(v)) walk(val)
  }
  walk(output)
  return [...new Set(out)]
}

/** Download a provider result into the local asset store (provider URLs expire). */
/**
 * Download a generated result into the asset store. The URL comes from the provider, so it goes
 * through the outbound guard (every connection and redirect); private addresses only when the model
 * itself is on the local network (`allowPrivate`). Retried on network errors and 5xx / 429 — the result
 * is already paid for, losing it to a blip would mean paying again.
 */
export async function downloadToAsset(url: string, assets: AssetStore, want: 'image' | 'video' | 'audio', signal: AbortSignal, opts: { allowPrivate?: boolean } = {}) {
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url)
    if (!m) throw new ProviderError('无法解析模型返回的 data URL')
    const bytes = m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!))
    return assets.put(bytes, m[1]!.toLowerCase(), `generated.${MIME_EXT[m[1]!.toLowerCase()] ?? 'bin'}`)
  }
  if (!/^https?:\/\//i.test(url)) throw new ProviderError('模型返回了不支持的结果地址')
  const tries = attempts('idempotent')
  let res: Awaited<ReturnType<typeof guardedGet>> | undefined
  for (let attempt = 0; ; attempt++) {
    try {
      res = await guardedGet(url, { signal, maxBytes: MAX_DOWNLOAD, allowPrivate: !!opts.allowPrivate })
    } catch (e) {
      if (signal.aborted) throw e
      if (e instanceof NetGuardError) throw new ProviderError(`结果地址被拒绝：${e.message}`)
      if (attempt + 1 < tries && retryError('idempotent', e)) { await sleepFor(retryDelay(attempt), signal); continue }
      throw new ProviderError(`下载生成结果失败：${(e as Error).message}`)
    }
    if (attempt + 1 < tries && retryStatus('idempotent', res.status)) { await sleepFor(retryDelay(attempt, res.headers['retry-after']), signal); continue }
    break
  }
  if (res.status < 200 || res.status >= 300) throw new ProviderError(`下载生成结果失败：HTTP ${res.status}`)
  const buf = res.body
  let mime = (res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
  mime = MIME_ALIAS[mime] ?? mime
  if (!MIME_EXT[mime]) {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? ''
    mime = EXT_MIME[ext] ?? mime
  }
  if (!mime.startsWith(`${want}/`)) throw new ProviderError(`期望得到${want === 'image' ? '图片' : want === 'video' ? '视频' : '音频'}，但模型返回了 ${mime || '未知类型'}`)
  return assets.put(buf, mime, `generated.${MIME_EXT[mime] ?? 'bin'}`)
}

/* ------------------------------------------------------------------ OpenAI-compatible images (synchronous) */

const OPENAI_SIZE: Record<string, string> = { '1:1': '1024x1024', '16:9': '1536x1024', '4:3': '1536x1024', '21:9': '1536x1024', '9:16': '1024x1536', '3:4': '1024x1536' }

export async function openaiImages(profile: ModelProfile, apiKey: string | undefined, req: { prompt: string; aspect?: string; signal: AbortSignal }): Promise<string[]> {
  if (!profile.endpoint) throw new ProviderError('模型档案未填写接口地址')
  const body: Record<string, unknown> = { n: 1, ...providerDefaults(profile.defaults), model: profile.model, prompt: req.prompt }
  // most services call it "size"; some (e.g. SiliconFlow: image_size) use another name, which also means it is required
  const sizeField = typeof profile.defaults?._sizeField === 'string' && /^\w{1,32}$/.test(profile.defaults._sizeField) ? profile.defaults._sizeField : 'size'
  if (body[sizeField] === undefined) {
    if (req.aspect && OPENAI_SIZE[req.aspect]) body[sizeField] = OPENAI_SIZE[req.aspect]
    else if (sizeField !== 'size') body[sizeField] = OPENAI_SIZE['1:1']
  }
  const url = base(profile, '') + (profile.endpoint.replace(/\/+$/, '').endsWith('/images/generations') ? '' : '/images/generations')
  const r = await call(url, {
    method: 'POST', apiKey,
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
  }, req.signal, 'paid')
  if (r.status < 200 || r.status >= 300) fail(r.status, r.text)
  // OpenAI and most compatible services answer data[]; SiliconFlow answers images[]
  const data = ([...(r.json?.data ?? []), ...(r.json?.images ?? [])]) as { b64_json?: string; url?: string }[]
  const urls = data.map((d) => (d?.b64_json ? `data:image/png;base64,${d.b64_json}` : d?.url)).filter((u): u is string => !!u)
  if (!urls.length) throw new ProviderError('模型服务响应中没有图片（data[].b64_json / data[].url / images[].url）')
  return urls
}

/* ------------------------------------------------------------------ OpenAI-compatible speech (synchronous) */

const FORMAT_MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/opus', pcm: '' }

/**
 * POST {endpoint}/audio/speech — OpenAI TTS and the many local servers that mimic it
 * (e.g. Kokoro-FastAPI, CosyVoice / GPT-SoVITS OpenAI-style wrappers). Returns raw audio bytes.
 */
export async function openaiSpeech(
  profile: ModelProfile, apiKey: string | undefined,
  req: { input: string; voice?: string; speed?: number; signal: AbortSignal },
): Promise<{ bytes: Buffer; mime: string }> {
  if (!profile.endpoint) throw new ProviderError('模型档案未填写接口地址')
  const d = providerDefaults(profile.defaults)
  const body: Record<string, unknown> = { response_format: 'mp3', voice: 'alloy', ...d, model: profile.model, input: req.input }
  if (req.voice) body.voice = req.voice
  if (typeof req.speed === 'number') body.speed = req.speed
  const fmt = String(body.response_format)
  if (fmt === 'pcm') throw new ProviderError('response_format=pcm 是无封装的原始音频，无法直接播放，请改用 mp3 / wav / flac')
  const b = profile.endpoint.replace(/\/+$/, '')
  const url = b.endsWith('/audio/speech') ? b : `${b}/audio/speech`
  return fetchAudio(url, {
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
  }, req.signal, apiKey, FORMAT_MIME[fmt])
}

/**
 * POST a speech request whose answer is the audio itself. Paid: retried only when surely not processed.
 * `fallbackMime` is used when the server does not say what it sent.
 */
export async function fetchAudio(url: string, init: { headers: Record<string, string>; body: string }, signal: AbortSignal, apiKey: string | undefined, fallbackMime = ''): Promise<{ bytes: Buffer; mime: string }> {
  try { await checkUrl(url) } catch (e) { throw new ProviderError((e as Error).message) }
  const redact = (t: string) => (apiKey ? t.split(apiKey).join('***') : t)
  let res!: Response
  for (let attempt = 0, tries = attempts('paid'); ; attempt++) {
    try {
      res = await fetch(url, { method: 'POST', redirect: 'error', ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) })
    } catch (e) {
      if (signal.aborted) throw e
      if (attempt + 1 < tries && retryError('paid', e)) { await sleepFor(retryDelay(attempt), signal); continue }
      const err = e as Error & { cause?: { code?: string } }
      throw new ProviderError(`请求失败：${err.name === 'TimeoutError' ? '超时' : (err.cause?.code ?? err.message)}`)
    }
    if (attempt + 1 < tries && retryStatus('paid', res.status)) { await res.text().catch(() => ''); await sleepFor(retryDelay(attempt, res.headers.get('retry-after')), signal); continue }
    break
  }
  if (!res.ok) fail(res.status, redact(await res.text()))
  const bytes = Buffer.from(await res.arrayBuffer())
  let mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  mime = MIME_ALIAS[mime] ?? mime
  // only infer the type when the server did not say what it sent
  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') mime = fallbackMime || mime
  if (!mime.startsWith('audio/') || !MIME_EXT[mime]) {
    const raw = bytes.toString('utf8', 0, 300)
    const peek = mime.startsWith('application/json') || mime.startsWith('text/') ? `：${redact(raw)}` : ''
    throw new ProviderError(`语音服务返回了非音频内容（${mime || '未知类型'}）${peek}`)
  }
  if (!bytes.length) throw new ProviderError('语音服务返回了空音频')
  return { bytes, mime }
}

/* ------------------------------------------------------------------ async job providers */

export type PollResult =
  | { state: 'queued' | 'running'; progress?: string }
  | { state: 'succeeded'; output: unknown }
  | { state: 'failed'; error: string }

export interface Submitted { remoteId: string; pollUrl?: string; resultUrl?: string; cancelUrl?: string }

/** what a generation node asks for, before it is shaped into one provider's request */
export interface GenRequest {
  want: 'image' | 'video' | 'audio'
  prompt: string
  /** what the result should not contain (empty = nothing) */
  negative: string
  /** reference images wired into the node (data URIs); a model that can't take them must say so */
  images: string[]
  /** pictures of @mentioned subjects: use them where the model takes references, else leave them out */
  softImages?: string[]
  /** first / last frame (data URIs) */
  first?: string
  last?: string
  aspect?: string
  duration?: number
  voice?: string
  speed?: number
  /** the node's advanced params (JSON), applied last */
  extra: Record<string, unknown>
}

export interface AsyncProvider {
  /** shape the request for this provider (replicate / fal use flat field names instead, see handlers.ts) */
  input?(profile: ModelProfile, req: GenRequest): Record<string, unknown>
  submit(profile: ModelProfile, apiKey: string | undefined, input: Record<string, unknown>, signal: AbortSignal): Promise<Submitted>
  poll(profile: ModelProfile, apiKey: string | undefined, job: Submitted, signal: AbortSignal): Promise<PollResult>
  cancel(profile: ModelProfile, apiKey: string | undefined, job: Submitted): Promise<void>
}

/** Replicate predictions API. model = "owner/name" (official/latest) or "owner/name:version". */
export const replicate: AsyncProvider = {
  async submit(profile, apiKey, input, signal) {
    if (!apiKey) throw new ProviderError('Replicate 需要 API Token')
    const b = base(profile, 'https://api.replicate.com/v1')
    const [ref, version] = profile.model.split(':')
    const url = version ? `${b}/predictions` : `${b}/models/${ref!.split('/').map(encodeURIComponent).join('/')}/predictions`
    const body = version ? { version, input } : { input }
    const r = await call(url, { method: 'POST', apiKey, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }, signal, 'paid')
    if (r.status < 200 || r.status >= 300 || !r.json?.id) fail(r.status, r.text)
    return { remoteId: String(r.json.id) }
  },
  async poll(profile, apiKey, job, signal) {
    const b = base(profile, 'https://api.replicate.com/v1')
    const r = await call(`${b}/predictions/${encodeURIComponent(job.remoteId)}`, { apiKey, headers: { authorization: `Bearer ${apiKey}` } }, signal, 'idempotent')
    if (r.status < 200 || r.status >= 300) fail(r.status, r.text)
    const st = String(r.json?.status ?? '')
    if (st === 'succeeded') return { state: 'succeeded', output: r.json.output }
    if (st === 'failed' || st === 'canceled') return { state: 'failed', error: String(r.json?.error ?? st) }
    return { state: st === 'starting' ? 'queued' : 'running' }
  },
  async cancel(profile, apiKey, job) {
    const b = base(profile, 'https://api.replicate.com/v1')
    await call(`${b}/predictions/${encodeURIComponent(job.remoteId)}/cancel`, { method: 'POST', apiKey, headers: { authorization: `Bearer ${apiKey}` } }, AbortSignal.timeout(15_000)).catch(() => undefined)
  },
}

/** fal.ai queue API. model = endpoint id, e.g. "fal-ai/flux/dev". Note: COMPLETED is also reported for failures. */
export const fal: AsyncProvider = {
  async submit(profile, apiKey, input, signal) {
    if (!apiKey) throw new ProviderError('fal 需要 API Key')
    const b = base(profile, 'https://queue.fal.run')
    const r = await call(`${b}/${profile.model.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST', apiKey, headers: { 'content-type': 'application/json', authorization: `Key ${apiKey}` }, body: JSON.stringify(input),
    }, signal, 'paid')
    if (r.status < 200 || r.status >= 300 || !r.json?.request_id) fail(r.status, r.text)
    // only follow URLs on the configured host so the key is never sent elsewhere
    return {
      remoteId: String(r.json.request_id),
      pollUrl: sameOrigin(r.json.status_url, b),
      resultUrl: sameOrigin(r.json.response_url, b),
      cancelUrl: sameOrigin(r.json.cancel_url, b),
    }
  },
  async poll(profile, apiKey, job, signal) {
    const b = base(profile, 'https://queue.fal.run')
    const reqBase = `${b}/${profile.model.split('/').map(encodeURIComponent).join('/')}/requests/${encodeURIComponent(job.remoteId)}`
    const headers = { authorization: `Key ${apiKey}` }
    const s = await call(job.pollUrl ?? `${reqBase}/status`, { apiKey, headers }, signal, 'idempotent')
    if (s.status < 200 || s.status >= 300) fail(s.status, s.text)
    const st = String(s.json?.status ?? '')
    if (st === 'IN_QUEUE') return { state: 'queued', progress: typeof s.json?.queue_position === 'number' ? `排队中（第 ${s.json.queue_position + 1} 位）` : undefined }
    if (st !== 'COMPLETED') return { state: 'running' }
    const r = await call(job.resultUrl ?? reqBase, { apiKey, headers }, signal, 'idempotent')
    if (r.status < 200 || r.status >= 300) return { state: 'failed', error: `fal 返回 ${r.status}：${r.text.slice(0, 400)}` }
    if (!extractMediaUrls(r.json).length && r.json?.detail) return { state: 'failed', error: JSON.stringify(r.json.detail).slice(0, 400) }
    return { state: 'succeeded', output: r.json }
  },
  async cancel(profile, apiKey, job) {
    const b = base(profile, 'https://queue.fal.run')
    const url = job.cancelUrl ?? `${b}/${profile.model.split('/').map(encodeURIComponent).join('/')}/requests/${encodeURIComponent(job.remoteId)}/cancel`
    await call(url, { method: 'PUT', apiKey, headers: { authorization: `Key ${apiKey}` } }, AbortSignal.timeout(15_000)).catch(() => undefined)
  },
}

export const ASYNC_PROVIDERS: Record<string, AsyncProvider> = { replicate, fal }

/* ------------------------------------------------------------------ job runner */

export interface JobCtx {
  store: Store
  projectId: string
  nodeId: string
  cacheKey: string
  /** regenerate: never resume an in-flight job */
  force: boolean
  signal: AbortSignal
  report: (progress: string) => void
  /** test hook: polling interval schedule in ms */
  pollDelays?: number[]
}

/** polls in a row that may fail before the run reports the job as lost (it can still be resumed) */
const MAX_POLL_FAILURES = 5

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new Error('aborted')) }, { once: true })
})

/**
 * Submit (or resume) a provider job and poll until it finishes.
 * A job with the same node + cache key that is still in flight is resumed instead of re-submitted,
 * so restarting the app or re-running never pays twice for the same generation.
 */
export async function runJob(
  ctx: JobCtx, provider: AsyncProvider, adapter: string, profile: ModelProfile, apiKey: string | undefined,
  input: Record<string, unknown>, timeoutSec: number,
): Promise<unknown> {
  let job: (Submitted & { id: string }) | undefined
  const existing: JobRow | undefined = ctx.force ? undefined : ctx.store.findActiveJob(ctx.projectId, ctx.nodeId, ctx.cacheKey)
  // finished and paid for, but its results never made it here (download failed, app stopped): use it
  const finished = ctx.force || existing ? undefined : ctx.store.takeFinishedJob(ctx.projectId, ctx.nodeId, ctx.cacheKey)
  if (finished) { ctx.report('使用已完成的任务结果…'); return finished.output }
  if (existing) {
    job = { id: existing.id, remoteId: existing.remoteId, pollUrl: existing.pollUrl, resultUrl: existing.resultUrl, cancelUrl: existing.cancelUrl }
    ctx.report('恢复进行中的任务…')
  } else {
    ctx.report('提交任务…')
    const s = await provider.submit(profile, apiKey, input, ctx.signal)
    job = { id: randomUUID(), ...s }
    ctx.store.insertJob({ id: job.id, projectId: ctx.projectId, nodeId: ctx.nodeId, cacheKey: ctx.cacheKey, adapter, ...s, status: 'submitted' })
  }

  const started = Date.now()
  const delays = ctx.pollDelays ?? [1500, 2000, 3000, 4000, 5000]
  let i = 0
  let fails = 0 // consecutive polls that failed (each already retried a few times)
  try {
    for (;;) {
      let r: PollResult
      try {
        r = await provider.poll(profile, apiKey, job, ctx.signal)
        fails = 0
      } catch (e) {
        // the job keeps running at the provider: a shaky connection is no reason to give it up
        if (ctx.signal.aborted || !(e instanceof ProviderError) || ++fails >= MAX_POLL_FAILURES) throw e
        ctx.report(`连接服务商不稳定，继续等待（${fails}/${MAX_POLL_FAILURES}）…`)
        await sleep(delays[Math.min(i++, delays.length - 1)]! * 2, ctx.signal)
        continue
      }
      if (r.state === 'succeeded') { ctx.store.updateJob(job.id, { status: 'succeeded', output: r.output }); return r.output }
      if (r.state === 'failed') { ctx.store.updateJob(job.id, { status: 'failed', error: r.error }); throw new ProviderError(`生成失败：${r.error}`) }
      ctx.store.updateJob(job.id, { status: 'running' })
      const secs = Math.round((Date.now() - started) / 1000)
      ctx.report(r.progress ?? (r.state === 'queued' ? `排队中 · ${secs}s` : `生成中 · ${secs}s`))
      if (secs > timeoutSec) throw new ProviderError(`等待超过 ${Math.round(timeoutSec / 60)} 分钟仍未完成。任务仍保留在服务商处，再次运行会继续等待它，不会重复提交。`)
      await sleep(delays[Math.min(i++, delays.length - 1)]!, ctx.signal)
    }
  } catch (e) {
    if (ctx.signal.aborted) {
      await provider.cancel(profile, apiKey, job)
      ctx.store.updateJob(job.id, { status: 'cancelled' })
    }
    throw e
  }
}
