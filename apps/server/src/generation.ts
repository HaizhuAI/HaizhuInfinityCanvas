import { randomUUID } from 'node:crypto'
import type { ModelProfile } from '@hzc/core'
import { MIME_EXT, type AssetStore } from './assets'
import type { JobRow, Store } from './db'
import { ProviderError } from './providers'

/* ------------------------------------------------------------------ helpers */

const MAX_DOWNLOAD = Number(process.env.HZC_MAX_DOWNLOAD_BYTES ?? 1024 * 1024 * 1024) // 1 GiB
const EXT_MIME: Record<string, string> = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]))
EXT_MIME.jpeg = 'image/jpeg'

/** Reserved keys inside profile.defaults that configure the adapter rather than being sent to the provider. */
export function providerDefaults(d: Record<string, unknown> | undefined) {
  return Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !k.startsWith('_')))
}

function base(profile: Pick<ModelProfile, 'endpoint'>, fallback: string) {
  return (profile.endpoint || fallback).replace(/\/+$/, '')
}

function sameOrigin(url: string | undefined, baseUrl: string): string | undefined {
  if (!url) return undefined
  try { return new URL(url).origin === new URL(baseUrl).origin ? url : undefined } catch { return undefined }
}

async function call(url: string, init: RequestInit & { apiKey?: string }, signal: AbortSignal): Promise<{ status: number; json: any; text: string }> {
  let res: Response
  try {
    res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) })
  } catch (e) {
    if (signal.aborted) throw e
    const err = e as Error & { cause?: { code?: string } }
    throw new ProviderError(`请求失败：${err.name === 'TimeoutError' ? '超时' : (err.cause?.code ?? err.message)}`)
  }
  const text = await res.text()
  let json: any
  try { json = text ? JSON.parse(text) : {} } catch { json = undefined }
  return { status: res.status, json, text: init.apiKey ? text.split(init.apiKey).join('***') : text }
}

function fail(status: number, text: string): never {
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
export async function downloadToAsset(url: string, assets: AssetStore, want: 'image' | 'video' | 'audio', signal: AbortSignal) {
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url)
    if (!m) throw new ProviderError('无法解析模型返回的 data URL')
    const bytes = m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!))
    return assets.put(bytes, m[1]!.toLowerCase(), `generated.${MIME_EXT[m[1]!.toLowerCase()] ?? 'bin'}`)
  }
  if (!/^https?:\/\//i.test(url)) throw new ProviderError('模型返回了不支持的结果地址')
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10 * 60_000)]) })
  } catch (e) {
    if (signal.aborted) throw e
    throw new ProviderError(`下载生成结果失败：${(e as Error).message}`)
  }
  if (!res.ok) throw new ProviderError(`下载生成结果失败：HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_DOWNLOAD) throw new ProviderError('生成结果超过大小上限')
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_DOWNLOAD) throw new ProviderError('生成结果超过大小上限')
  let mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
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
  if (req.aspect && body.size === undefined && OPENAI_SIZE[req.aspect]) body.size = OPENAI_SIZE[req.aspect]
  const url = base(profile, '') + (profile.endpoint.replace(/\/+$/, '').endsWith('/images/generations') ? '' : '/images/generations')
  const r = await call(url, {
    method: 'POST', apiKey,
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
  }, req.signal)
  if (r.status < 200 || r.status >= 300) fail(r.status, r.text)
  const data = (r.json?.data ?? []) as { b64_json?: string; url?: string }[]
  const urls = data.map((d) => (d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url)).filter((u): u is string => !!u)
  if (!urls.length) throw new ProviderError('模型服务响应中没有图片（data[].b64_json / data[].url）')
  return urls
}

/* ------------------------------------------------------------------ async job providers */

export type PollResult =
  | { state: 'queued' | 'running'; progress?: string }
  | { state: 'succeeded'; output: unknown }
  | { state: 'failed'; error: string }

export interface Submitted { remoteId: string; pollUrl?: string; resultUrl?: string; cancelUrl?: string }

export interface AsyncProvider {
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
    const r = await call(url, { method: 'POST', apiKey, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }, signal)
    if (r.status < 200 || r.status >= 300 || !r.json?.id) fail(r.status, r.text)
    return { remoteId: String(r.json.id) }
  },
  async poll(profile, apiKey, job, signal) {
    const b = base(profile, 'https://api.replicate.com/v1')
    const r = await call(`${b}/predictions/${encodeURIComponent(job.remoteId)}`, { apiKey, headers: { authorization: `Bearer ${apiKey}` } }, signal)
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
    }, signal)
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
    const s = await call(job.pollUrl ?? `${reqBase}/status`, { apiKey, headers }, signal)
    if (s.status < 200 || s.status >= 300) fail(s.status, s.text)
    const st = String(s.json?.status ?? '')
    if (st === 'IN_QUEUE') return { state: 'queued', progress: typeof s.json?.queue_position === 'number' ? `排队中（第 ${s.json.queue_position + 1} 位）` : undefined }
    if (st !== 'COMPLETED') return { state: 'running' }
    const r = await call(job.resultUrl ?? reqBase, { apiKey, headers }, signal)
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
  try {
    for (;;) {
      const r = await provider.poll(profile, apiKey, job, ctx.signal)
      if (r.state === 'succeeded') { ctx.store.updateJob(job.id, { status: 'succeeded' }); return r.output }
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
