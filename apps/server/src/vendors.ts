import { maxVideoDuration, videoCaps, type ModelProfile } from '@hzc/core'
import { ProviderError } from './providers'
import { call, fail, fetchAudio, providerDefaults, type AsyncProvider, type GenRequest, type PollResult, type Submitted } from './generation'

/*
 * Native APIs of the video / image / speech services creators use most, written from each provider's
 * official API reference (see docs/03-guide/model-providers.md for the sources and what was verified).
 * Each provider shapes a GenRequest into its own body; the profile's defaults sit underneath and the
 * node's advanced params (JSON) on top, merged key by key so `{"parameters": {"seed": 1}}` adds a seed
 * without dropping the rest.
 *
 * A native input is `{ path, body }`: the path under the profile's endpoint and the JSON to send.
 * Every URL is built here from the endpoint the user chose, so the key never goes anywhere else.
 */

type Body = Record<string, unknown>
interface Native { path: string; body: Body }

const isObj = (v: unknown): v is Body => typeof v === 'object' && v !== null && !Array.isArray(v)

/** later layers win; nested objects are merged, arrays and values replaced */
export function deepMerge(...layers: Body[]): Body {
  const out: Body = {}
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k] as Body, v) : v
    }
  }
  return out
}

/** drop undefined values so they never reach a provider as null */
function clean<T extends Body>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

const root = (p: Pick<ModelProfile, 'endpoint'>, fallback: string) => (p.endpoint || fallback).replace(/\/+$/, '')
const asNative = (input: Record<string, unknown>) => input as unknown as Native
const bearer = (k?: string): Record<string, string> => (k ? { authorization: `Bearer ${k}` } : {})
const JSON_TYPE = { 'content-type': 'application/json' }
/** the parts of a request a node can't express (negative prompt) are said in words */
const withAvoid = (r: GenRequest) => (r.negative ? `${r.prompt}\n\nAvoid: ${r.negative}` : r.prompt)
const urls = (list: unknown[]) => ({ urls: list.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)) })
const stripDataUri = (u: string) => u.replace(/^data:[^;,]+;base64,/, '')
const ok = (status: number) => status >= 200 && status < 300
const quietly = (p: Promise<unknown>) => p.then(() => undefined, () => undefined)
const CANCEL_TIMEOUT = 15_000

function onlyVideo(r: GenRequest, name: string, hint = '') {
  if (r.want !== 'video') throw new ProviderError(`${name}适配器只用于视频生成${hint}`)
}
function noRefs(r: GenRequest, name: string) {
  if (r.images.length) throw new ProviderError(`${name}的这个接口不接受参考图：请断开参考图，或换用支持图生图的模型`)
}
function needKey(apiKey: string | undefined, name: string): asserts apiKey is string {
  if (!apiKey) throw new ProviderError(`${name}需要 API Key：在模型档案里填写`)
}
/** a model without reference images: wired ones are an error, a subject's pictures are left out */
function noVideoRefs(r: GenRequest, name: string) {
  if (r.images.length) throw new ProviderError(`${name}不接受参考图：请断开「参考图」，或换用支持参考图的模型（如 Seedance、MiniMax-H3）`)
}
/** wired references first, then the pictures of @mentioned subjects */
const allRefs = (r: GenRequest, max = 9) => [...r.images, ...(r.softImages ?? [])].slice(0, max)

function lastNeedsFirst(r: GenRequest, name: string) {
  if (r.last && !r.first) throw new ProviderError(`${name}的尾帧需要同时连接首帧`)
}

/* ------------------------------------------------------------------ 火山方舟 Seedance (Volcengine Ark) */

export const ARK_DEFAULT = 'https://ark.cn-beijing.volces.com/api/v3'

/** POST /contents/generations/tasks → GET / DELETE /contents/generations/tasks/{id} */
export const ark: AsyncProvider = {
  input(profile, r) {
    onlyVideo(r, '火山方舟（Seedance）', '；Seedream 图片生成请用 openai-compat 适配器，地址相同')
    lastNeedsFirst(r, 'Seedance ')
    const content: Body[] = [{ type: 'text', text: withAvoid(r) }]
    if (r.first) content.push({ type: 'image_url', image_url: { url: r.first }, role: 'first_frame' })
    if (r.last) content.push({ type: 'image_url', image_url: { url: r.last }, role: 'last_frame' })
    // Seedance 2.x takes up to 9 reference pictures, earlier models 4
    for (const url of allRefs(r, videoCaps(profile).maxRefs ?? 4)) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
    const built = clean({ model: profile.model, content, ratio: r.aspect, duration: r.duration, resolution: r.resolution, generate_audio: r.audio })
    return { path: '/contents/generations/tasks', body: deepMerge(providerDefaults(profile.defaults), built, r.extra) }
  },
  async submit(profile, apiKey, input, signal) {
    needKey(apiKey, '火山方舟')
    const b = root(profile, ARK_DEFAULT)
    const n = asNative(input)
    const r = await call(b + n.path, { method: 'POST', apiKey, headers: { ...JSON_TYPE, ...bearer(apiKey) }, body: JSON.stringify(n.body) }, signal, 'paid')
    if (!ok(r.status) || !r.json?.id) fail(r.status, r.text)
    const task = `${b}/contents/generations/tasks/${encodeURIComponent(String(r.json.id))}`
    return { remoteId: String(r.json.id), pollUrl: task, cancelUrl: task }
  },
  async poll(profile, apiKey, job, signal) {
    const url = job.pollUrl ?? `${root(profile, ARK_DEFAULT)}/contents/generations/tasks/${encodeURIComponent(job.remoteId)}`
    const r = await call(url, { apiKey, headers: bearer(apiKey) }, signal, 'idempotent')
    if (!ok(r.status)) fail(r.status, r.text)
    const st = String(r.json?.status ?? '')
    if (st === 'succeeded') return { state: 'succeeded', output: urls([r.json?.content?.video_url]) }
    if (st === 'failed' || st === 'cancelled' || st === 'expired') return { state: 'failed', error: String(r.json?.error?.message || r.json?.error?.code || st) }
    return { state: st === 'queued' ? 'queued' : 'running' }
  },
  async cancel(profile, apiKey, job) {
    // only queued tasks can be cancelled; deleting a finished one is harmless
    const url = job.cancelUrl ?? `${root(profile, ARK_DEFAULT)}/contents/generations/tasks/${encodeURIComponent(job.remoteId)}`
    await quietly(call(url, { method: 'DELETE', apiKey, headers: bearer(apiKey) }, AbortSignal.timeout(CANCEL_TIMEOUT)))
  },
}

/* ------------------------------------------------------------------ 阿里云百炼 通义万相 Wan (DashScope) */

export const DASHSCOPE_DEFAULT = 'https://dashscope.aliyuncs.com'

/** wan2.6+ text-to-image: total pixels between 1280² and 1440² */
const WAN_IMAGE_SIZE: Record<string, string> = { '1:1': '1280*1280', '16:9': '1792*1008', '9:16': '1008*1792', '4:3': '1536*1152', '3:4': '1152*1536', '21:9': '2016*864' }
/** wan2.5 and earlier: sides 512–1440 */
const WAN_LEGACY_IMAGE_SIZE: Record<string, string> = { '1:1': '1024*1024', '16:9': '1280*720', '9:16': '720*1280', '4:3': '1152*864', '3:4': '864*1152', '21:9': '1440*624' }
const WAN_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4'])
const isLegacyWanImage = (model: string) => /^wanx|^wan2\.[0-5]\b/i.test(model)
/** wan2.7 and later take images as a `media` list and the frame shape as `ratio` */
const isMediaWan = (model: string) => /^wan(2\.(7|8|9)|[3-9])/i.test(model)

function wanVideo(profile: ModelProfile, r: GenRequest): Native {
  noVideoRefs(r, '万相视频')
  const m = profile.model
  const input: Body = { prompt: r.prompt, negative_prompt: r.negative || undefined }
  const parameters: Body = { duration: r.duration }
  let path = '/api/v1/services/aigc/video-generation/video-synthesis'
  if (/kf2v/i.test(m)) {
    // first-and-last-frame models (wan2.2-kf2v-flash, wanx2.1-kf2v-plus): their own path, fixed 5 s
    if (!r.first) throw new ProviderError(`${m} 是首尾帧模型：请连接首帧（尾帧可选）`)
    path = '/api/v1/services/aigc/image2video/video-synthesis'
    input.first_frame_url = r.first
    input.last_frame_url = r.last
    delete parameters.duration
  } else if (isMediaWan(m)) {
    lastNeedsFirst(r, '万相')
    if (r.first) input.media = [{ type: 'first_frame', url: r.first }, ...(r.last ? [{ type: 'last_frame', url: r.last }] : [])]
    else if (r.aspect && WAN_RATIOS.has(r.aspect)) parameters.ratio = r.aspect
  } else if (r.first) {
    if (r.last) throw new ProviderError(`${m} 只支持首帧：首尾帧请用 wan2.7 或 kf2v 系列模型`)
    input.img_url = r.first
  }
  return { path, body: { model: m, input: clean(input), parameters: clean(parameters) } }
}

function wanImage(profile: ModelProfile, r: GenRequest): Native {
  noRefs(r, '万相文生图')
  const m = profile.model
  if (isLegacyWanImage(m)) {
    return {
      path: '/api/v1/services/aigc/text2image/image-synthesis',
      body: { model: m, input: clean({ prompt: r.prompt, negative_prompt: r.negative || undefined }), parameters: clean({ n: 1, size: r.aspect ? WAN_LEGACY_IMAGE_SIZE[r.aspect] : undefined }) },
    }
  }
  return {
    path: '/api/v1/services/aigc/image-generation/generation',
    body: {
      model: m,
      input: { messages: [{ role: 'user', content: [{ text: r.prompt }] }] },
      parameters: clean({ n: 1, size: r.aspect ? WAN_IMAGE_SIZE[r.aspect] : undefined, negative_prompt: r.negative || undefined }),
    },
  }
}

/** async HTTP API: POST with X-DashScope-Async → GET /api/v1/tasks/{id}; cancel works while PENDING */
export const dashscope: AsyncProvider = {
  input(profile, r) {
    if (r.want === 'audio') throw new ProviderError('百炼的万相适配器用于图片和视频；语音请用 openai-compat 等适配器')
    const n = r.want === 'video' ? wanVideo(profile, r) : wanImage(profile, r)
    return { path: n.path, body: deepMerge(providerDefaults(profile.defaults), n.body, r.extra) }
  },
  async submit(profile, apiKey, input, signal) {
    needKey(apiKey, '阿里云百炼')
    const b = root(profile, DASHSCOPE_DEFAULT)
    const n = asNative(input)
    const r = await call(b + n.path, { method: 'POST', apiKey, headers: { ...JSON_TYPE, ...bearer(apiKey), 'X-DashScope-Async': 'enable' }, body: JSON.stringify(n.body) }, signal, 'paid')
    const id = r.json?.output?.task_id
    if (!ok(r.status) || !id) fail(r.status, r.text)
    const task = `${b}/api/v1/tasks/${encodeURIComponent(String(id))}`
    return { remoteId: String(id), pollUrl: task, cancelUrl: `${task}/cancel` }
  },
  async poll(profile, apiKey, job, signal) {
    const r = await call(job.pollUrl ?? `${root(profile, DASHSCOPE_DEFAULT)}/api/v1/tasks/${encodeURIComponent(job.remoteId)}`, { apiKey, headers: bearer(apiKey) }, signal, 'idempotent')
    if (!ok(r.status)) fail(r.status, r.text)
    const o = r.json?.output ?? {}
    const st = String(o.task_status ?? '')
    if (st === 'SUCCEEDED') {
      const images = ((o.choices ?? []) as { message?: { content?: { image?: string }[] } }[]).flatMap((c) => (c.message?.content ?? []).map((x) => x.image))
      return { state: 'succeeded', output: urls([o.video_url, ...((o.results ?? []) as { url?: string }[]).map((x) => x.url), ...images]) }
    }
    if (st === 'FAILED' || st === 'CANCELED') return { state: 'failed', error: String(o.message || o.code || st) }
    if (st === 'UNKNOWN') return { state: 'failed', error: '任务不存在或已过期（百炼只保留 24 小时）' }
    return { state: st === 'PENDING' ? 'queued' : 'running' }
  },
  async cancel(profile, apiKey, job) {
    const url = job.cancelUrl ?? `${root(profile, DASHSCOPE_DEFAULT)}/api/v1/tasks/${encodeURIComponent(job.remoteId)}/cancel`
    await quietly(call(url, { method: 'POST', apiKey, headers: bearer(apiKey) }, AbortSignal.timeout(CANCEL_TIMEOUT)))
  },
}

/* ------------------------------------------------------------------ 可灵 Kling */

export const KLING_DEFAULT = 'https://api-singapore.klingai.com'
const KLING_VIDEO_RATIOS = new Set(['16:9', '9:16', '1:1', '21:9'])
const KLING_IMAGE_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'])
const KLING_IMAGES = '/v1/images/generations'

/**
 * Video: model in the path (/text-to-video/kling-2.5-turbo, /image-to-video/…) → GET /tasks?task_ids=.
 * Image: POST /v1/images/generations (model_name) → GET /v1/images/generations/{id}.
 * Images are sent as plain base64 (Kling wants no data: prefix). Envelope: { code: 0, message, data }.
 */
export const kling: AsyncProvider = {
  input(profile, r) {
    const d = providerDefaults(profile.defaults)
    if (r.want === 'image') {
      if (r.images.length > 1) throw new ProviderError('可灵图片生成只接受 1 张参考图')
      const ref = allRefs(r, 1)[0]
      const built = clean({
        model_name: profile.model, prompt: r.prompt,
        negative_prompt: ref ? undefined : r.negative || undefined, // not allowed together with a reference image
        image: ref ? stripDataUri(ref) : undefined,
        aspect_ratio: r.aspect && KLING_IMAGE_RATIOS.has(r.aspect) ? r.aspect : undefined,
        n: 1,
      })
      return { path: KLING_IMAGES, body: deepMerge(d, built, r.extra) }
    }
    if (r.want !== 'video') throw new ProviderError('可灵适配器用于图片和视频生成')
    noVideoRefs(r, '可灵视频')
    lastNeedsFirst(r, '可灵')
    const model = encodeURIComponent(profile.model)
    if (r.first) {
      const contents: Body[] = [{ type: 'prompt', text: withAvoid(r) }, { type: 'first_frame', url: stripDataUri(r.first) }]
      if (r.last) contents.push({ type: 'last_frame', url: stripDataUri(r.last) })
      return { path: `/image-to-video/${model}`, body: deepMerge(d, { contents, settings: clean({ duration: r.duration }) }, r.extra) }
    }
    const settings = clean({ duration: r.duration, aspect_ratio: r.aspect && KLING_VIDEO_RATIOS.has(r.aspect) ? r.aspect : undefined })
    return { path: `/text-to-video/${model}`, body: deepMerge(d, { prompt: withAvoid(r), settings }, r.extra) }
  },
  async submit(profile, apiKey, input, signal) {
    needKey(apiKey, '可灵')
    const b = root(profile, KLING_DEFAULT)
    const n = asNative(input)
    const r = await call(b + n.path, { method: 'POST', apiKey, headers: { ...JSON_TYPE, ...bearer(apiKey) }, body: JSON.stringify(n.body) }, signal, 'paid')
    const image = n.path === KLING_IMAGES
    const id = image ? r.json?.data?.task_id : r.json?.data?.id
    if (!ok(r.status) || (r.json?.code !== undefined && r.json.code !== 0) || !id) fail(r.status, r.text)
    const pollUrl = image ? `${b}${KLING_IMAGES}/${encodeURIComponent(String(id))}` : `${b}/tasks?task_ids=${encodeURIComponent(String(id))}`
    return { remoteId: String(id), pollUrl }
  },
  async poll(profile, apiKey, job, signal) {
    const b = root(profile, KLING_DEFAULT)
    const url = job.pollUrl ?? `${b}/tasks?task_ids=${encodeURIComponent(job.remoteId)}`
    const r = await call(url, { apiKey, headers: bearer(apiKey) }, signal, 'idempotent')
    if (!ok(r.status) || (r.json?.code !== undefined && r.json.code !== 0)) fail(r.status, r.text)
    if (url.includes(`${KLING_IMAGES}/`)) {
      const d = r.json?.data ?? {}
      const st = String(d.task_status ?? '')
      if (st === 'succeed' || st === 'succeeded') return { state: 'succeeded', output: urls(((d.task_result?.images ?? []) as { url?: string }[]).map((i) => i.url)) }
      if (st === 'failed') return { state: 'failed', error: String(d.task_status_msg || 'failed') }
      return { state: st === 'submitted' ? 'queued' : 'running' }
    }
    const list = (Array.isArray(r.json?.data) ? r.json.data : [r.json?.data]) as { id?: string; status?: string; message?: string; outputs?: { type?: string; url?: string }[] }[]
    const t = list.find((x) => x && String(x.id) === job.remoteId) ?? list.find(Boolean)
    if (!t) return { state: 'failed', error: '可灵找不到这个任务' }
    const st = String(t.status ?? '')
    if (st === 'succeeded' || st === 'succeed') return { state: 'succeeded', output: urls((t.outputs ?? []).filter((o) => !o.type || o.type === 'video').map((o) => o.url)) }
    if (st === 'failed') return { state: 'failed', error: String(t.message || 'failed') }
    return { state: st === 'submitted' ? 'queued' : 'running' }
  },
  async cancel() { /* the API has no cancel */ },
}

/* ------------------------------------------------------------------ MiniMax 海螺 Hailuo + speech */

export const MINIMAX_DEFAULT = 'https://api.minimax.io'
const MINIMAX_V2_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])
/** MiniMax-H3 models use the v2 API (content list); Hailuo-02 / 2.3 and older the v1 API */
const isMinimaxV2 = (model: string) => /^minimax-h3/i.test(model)

function minimaxError(json: any): string | undefined {
  const code = json?.base_resp?.status_code
  return code !== undefined && code !== 0 ? `MiniMax 返回错误 ${code}：${String(json?.base_resp?.status_msg ?? '')}` : undefined
}

/**
 * v1: POST /v1/video_generation → GET /v1/query/video_generation?task_id= → GET /v1/files/retrieve?file_id=.
 * v2: POST /v2/video_generation → GET /v2/query/video_generation/{task_id}.
 */
export const minimax: AsyncProvider = {
  input(profile, r) {
    onlyVideo(r, 'MiniMax ', '；语音合成选「语音」类型即可使用同一个 Key')
    const d = providerDefaults(profile.defaults)
    if (isMinimaxV2(profile.model)) {
      lastNeedsFirst(r, 'MiniMax ')
      const content: Body[] = [{ type: 'text', text: withAvoid(r) }]
      if (r.first) content.push({ type: 'image_url', image_url: { url: r.first }, role: 'first_frame' })
      if (r.last) content.push({ type: 'image_url', image_url: { url: r.last }, role: 'last_frame' })
      for (const url of allRefs(r, 9)) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
      const duration = Math.min(maxVideoDuration(profile) > 15 ? maxVideoDuration(profile) : 15, Math.max(4, Math.round(r.duration ?? 6)))
      const ratio = r.aspect && MINIMAX_V2_RATIOS.has(r.aspect) ? r.aspect : r.first ? 'adaptive' : '16:9'
      return { path: '/v2/video_generation', body: deepMerge({ resolution: '768P' }, d, clean({ model: profile.model, content, duration, ratio, resolution: r.resolution }), r.extra) }
    }
    noVideoRefs(r, `${profile.model}（MiniMax-H3 可以）`)
    // v1 takes 6 or 10 seconds
    const duration = r.duration === undefined ? undefined : r.duration >= 8 ? 10 : 6
    const built = clean({ model: profile.model, prompt: withAvoid(r), first_frame_image: r.first, last_frame_image: r.last, duration })
    return { path: '/v1/video_generation', body: deepMerge(d, built, r.extra) }
  },
  async submit(profile, apiKey, input, signal) {
    needKey(apiKey, 'MiniMax ')
    const b = root(profile, MINIMAX_DEFAULT)
    const n = asNative(input)
    const r = await call(b + n.path, { method: 'POST', apiKey, headers: { ...JSON_TYPE, ...bearer(apiKey) }, body: JSON.stringify(n.body) }, signal, 'paid')
    const err = minimaxError(r.json)
    if (err) throw new ProviderError(err)
    const id = r.json?.task_id
    if (!ok(r.status) || !id) fail(r.status, r.text)
    const tid = encodeURIComponent(String(id))
    const pollUrl = n.path.startsWith('/v2/') ? `${b}/v2/query/video_generation/${tid}` : `${b}/v1/query/video_generation?task_id=${tid}`
    return { remoteId: String(id), pollUrl }
  },
  async poll(profile, apiKey, job, signal) {
    const b = root(profile, MINIMAX_DEFAULT)
    const url = job.pollUrl ?? `${b}/v1/query/video_generation?task_id=${encodeURIComponent(job.remoteId)}`
    const r = await call(url, { apiKey, headers: bearer(apiKey) }, signal, 'idempotent')
    if (!ok(r.status)) fail(r.status, r.text)
    if (url.includes('/v2/')) {
      const t = r.json?.task ?? {}
      const st = String(t.status ?? '').toLowerCase()
      if (st === 'succeeded') return { state: 'succeeded', output: urls([t.content?.url, t.content?.video_url]) }
      if (st === 'failed' || st === 'cancelled') return { state: 'failed', error: String(t.error?.message || minimaxError(r.json) || st) }
      return { state: st === 'queued' ? 'queued' : 'running' }
    }
    const st = String(r.json?.status ?? '')
    if (st === 'Fail') return { state: 'failed', error: minimaxError(r.json) ?? '生成失败' }
    if (st !== 'Success') {
      const err = minimaxError(r.json)
      if (err) return { state: 'failed', error: err }
      return { state: st === 'Processing' ? 'running' : 'queued' }
    }
    const fileId = r.json?.file_id
    if (!fileId) return { state: 'failed', error: 'MiniMax 完成了任务，但没有返回 file_id' }
    const f = await call(`${b}/v1/files/retrieve?file_id=${encodeURIComponent(String(fileId))}`, { apiKey, headers: bearer(apiKey) }, signal, 'idempotent')
    if (!ok(f.status)) fail(f.status, f.text)
    const link = f.json?.file?.download_url
    if (!link) return { state: 'failed', error: minimaxError(f.json) ?? 'MiniMax 没有返回下载地址' }
    return { state: 'succeeded', output: urls([link]) }
  },
  async cancel() { /* no documented cancel for v1 */ },
}

const AUDIO_MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac' }

/** POST /v1/t2a_v2 (synchronous): the audio comes back hex-encoded in data.audio */
export async function minimaxSpeech(profile: ModelProfile, apiKey: string | undefined, req: { input: string; voice?: string; speed?: number; signal: AbortSignal }): Promise<{ bytes: Buffer; mime: string }> {
  needKey(apiKey, 'MiniMax ')
  const body = deepMerge(
    { stream: false, output_format: 'hex', voice_setting: { voice_id: 'Chinese (Mandarin)_Lyrical_Voice', speed: 1 }, audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000, channel: 1 } },
    providerDefaults(profile.defaults),
    { model: profile.model, text: req.input, voice_setting: clean({ voice_id: req.voice || undefined, speed: req.speed }) },
  )
  const fmt = String((body.audio_setting as Body | undefined)?.format ?? 'mp3')
  const mime = AUDIO_MIME[fmt]
  if (!mime) throw new ProviderError(`audio_setting.format=${fmt} 无法直接播放，请改用 mp3 / wav / flac`)
  if (body.output_format !== 'hex') body.output_format = 'hex'
  const r = await call(`${root(profile, MINIMAX_DEFAULT)}/v1/t2a_v2`, { method: 'POST', apiKey, headers: { ...JSON_TYPE, ...bearer(apiKey) }, body: JSON.stringify(body) }, req.signal, 'paid')
  const err = minimaxError(r.json)
  if (err) throw new ProviderError(err)
  if (!ok(r.status)) fail(r.status, r.text)
  const hex = r.json?.data?.audio
  if (typeof hex !== 'string' || !hex || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2) throw new ProviderError('MiniMax 没有返回音频（data.audio）')
  return { bytes: Buffer.from(hex, 'hex'), mime }
}

/* ------------------------------------------------------------------ Runway */

export const RUNWAY_DEFAULT = 'https://api.dev.runwayml.com'
const RUNWAY_VERSION = '2024-11-06'
const RUNWAY_VIDEO_RATIO: Record<string, string> = { '16:9': '1280:720', '9:16': '720:1280', '1:1': '960:960', '4:3': '1104:832', '3:4': '832:1104', '21:9': '1584:672' }
const RUNWAY_IMAGE_RATIO: Record<string, string> = { '16:9': '1920:1080', '9:16': '1080:1920', '1:1': '1024:1024', '4:3': '1440:1080', '3:4': '1080:1440', '21:9': '2112:912' }
/** Runway accepts data URIs up to 5 MB (about 3.3 MB of image) */
const RUNWAY_MAX_DATA_URI = 5_000_000
const runwayHeaders = (k?: string) => ({ ...bearer(k), 'X-Runway-Version': RUNWAY_VERSION })

function runwayUri(u: string) {
  if (u.startsWith('data:') && u.length > RUNWAY_MAX_DATA_URI) throw new ProviderError('Runway 直接接收的图片不能超过约 3.3 MB：请先压缩或缩小这张图片')
  return u
}

/** POST /v1/text_to_image | /v1/image_to_video | /v1/text_to_video | /v1/text_to_speech → GET /v1/tasks/{id}; DELETE cancels */
export const runway: AsyncProvider = {
  input(profile, r) {
    const d = providerDefaults(profile.defaults)
    const model = profile.model
    if (r.want === 'image') {
      if (r.images.length > 3) throw new ProviderError('Runway 最多接受 3 张参考图')
      const refs = allRefs(r, 3)
      const built = clean({ model, promptText: withAvoid(r), ratio: RUNWAY_IMAGE_RATIO[r.aspect ?? ''] ?? '1920:1080', referenceImages: refs.length ? refs.map((u) => ({ uri: runwayUri(u) })) : undefined })
      return { path: '/v1/text_to_image', body: deepMerge(d, built, r.extra) }
    }
    if (r.want === 'audio') {
      return { path: '/v1/text_to_speech', body: deepMerge(d, { model, promptText: r.prompt, voice: { type: 'runway-preset', presetId: r.voice || 'Maya' } }, r.extra) }
    }
    noVideoRefs(r, 'Runway 视频')
    lastNeedsFirst(r, 'Runway ')
    const ratio = RUNWAY_VIDEO_RATIO[r.aspect ?? ''] ?? '1280:720'
    const duration = r.duration ?? 5
    if (r.first) {
      const promptImage = r.last ? [{ uri: runwayUri(r.first), position: 'first' }, { uri: runwayUri(r.last), position: 'last' }] : runwayUri(r.first)
      return { path: '/v1/image_to_video', body: deepMerge(d, { model, promptText: withAvoid(r), promptImage, ratio, duration }, r.extra) }
    }
    return { path: '/v1/text_to_video', body: deepMerge(d, { model, promptText: withAvoid(r), ratio, duration }, r.extra) }
  },
  async submit(profile, apiKey, input, signal) {
    needKey(apiKey, 'Runway ')
    const b = root(profile, RUNWAY_DEFAULT)
    const n = asNative(input)
    const r = await call(b + n.path, { method: 'POST', apiKey, headers: { ...JSON_TYPE, ...runwayHeaders(apiKey) }, body: JSON.stringify(n.body) }, signal, 'paid')
    if (!ok(r.status) || !r.json?.id) fail(r.status, r.text)
    const task = `${b}/v1/tasks/${encodeURIComponent(String(r.json.id))}`
    return { remoteId: String(r.json.id), pollUrl: task, cancelUrl: task }
  },
  async poll(profile, apiKey, job, signal): Promise<PollResult> {
    const r = await call(job.pollUrl ?? `${root(profile, RUNWAY_DEFAULT)}/v1/tasks/${encodeURIComponent(job.remoteId)}`, { apiKey, headers: runwayHeaders(apiKey) }, signal, 'idempotent')
    if (!ok(r.status)) fail(r.status, r.text)
    const st = String(r.json?.status ?? '')
    if (st === 'SUCCEEDED') return { state: 'succeeded', output: urls(Array.isArray(r.json?.output) ? r.json.output : []) }
    if (st === 'FAILED') return { state: 'failed', error: String(r.json?.failure || r.json?.failureCode || 'failed') }
    if (st === 'CANCELLED') return { state: 'failed', error: '任务已取消' }
    if (st === 'RUNNING') {
      const p = Number(r.json?.progress)
      return { state: 'running', progress: Number.isFinite(p) && p > 0 && p <= 1 ? `生成中 · ${Math.round(p * 100)}%` : undefined }
    }
    return { state: 'queued' } // PENDING / THROTTLED
  },
  async cancel(profile, apiKey, job) {
    const url = job.cancelUrl ?? `${root(profile, RUNWAY_DEFAULT)}/v1/tasks/${encodeURIComponent(job.remoteId)}`
    await quietly(call(url, { method: 'DELETE', apiKey, headers: runwayHeaders(apiKey) }, AbortSignal.timeout(CANCEL_TIMEOUT)))
  },
}

/* ------------------------------------------------------------------ 智谱 CogVideoX (Zhipu BigModel) */

export const ZHIPU_DEFAULT = 'https://open.bigmodel.cn/api/paas/v4'
const ZHIPU_SIZE: Record<string, string> = { '16:9': '1920x1080', '9:16': '1080x1920', '1:1': '1024x1024' }

/** POST /videos/generations → GET /async-result/{id}. Chat and CogView images use openai-compat on the same address. */
export const zhipu: AsyncProvider = {
  input(profile, r) {
    onlyVideo(r, '智谱 CogVideoX ', '；对话、视觉和 CogView 图片请用 openai-compat 适配器，地址相同')
    noVideoRefs(r, 'CogVideoX ')
    lastNeedsFirst(r, 'CogVideoX ')
    const v3 = /cogvideox-3/i.test(profile.model)
    const built = clean({
      model: profile.model,
      prompt: withAvoid(r),
      image_url: r.first ? (r.last ? [r.first, r.last] : r.first) : undefined,
      size: !r.first && r.aspect ? ZHIPU_SIZE[r.aspect] : undefined,
      duration: v3 && r.duration !== undefined ? (r.duration >= 8 ? 10 : 5) : undefined,
    })
    return { path: '/videos/generations', body: deepMerge(providerDefaults(profile.defaults), built, r.extra) }
  },
  async submit(profile, apiKey, input, signal) {
    needKey(apiKey, '智谱')
    const b = root(profile, ZHIPU_DEFAULT)
    const n = asNative(input)
    const r = await call(b + n.path, { method: 'POST', apiKey, headers: { ...JSON_TYPE, ...bearer(apiKey) }, body: JSON.stringify(n.body) }, signal, 'paid')
    if (!ok(r.status) || !r.json?.id) fail(r.status, r.text)
    return { remoteId: String(r.json.id), pollUrl: `${b}/async-result/${encodeURIComponent(String(r.json.id))}` }
  },
  async poll(profile, apiKey, job, signal) {
    const r = await call(job.pollUrl ?? `${root(profile, ZHIPU_DEFAULT)}/async-result/${encodeURIComponent(job.remoteId)}`, { apiKey, headers: bearer(apiKey) }, signal, 'idempotent')
    if (!ok(r.status)) fail(r.status, r.text)
    const st = String(r.json?.task_status ?? '')
    if (st === 'SUCCESS') return { state: 'succeeded', output: urls(((r.json?.video_result ?? []) as { url?: string }[]).map((v) => v.url)) }
    if (st === 'FAIL') return { state: 'failed', error: String(r.json?.error?.message || 'FAIL') }
    return { state: 'running' }
  },
  async cancel() { /* no cancel endpoint */ },
}

/* ------------------------------------------------------------------ SiliconFlow 硅基流动 video */

export const SILICONFLOW_DEFAULT = 'https://api.siliconflow.cn/v1'
const SILICONFLOW_RATIOS = new Set(['1:1', '3:4', '4:3', '9:16', '16:9', '21:9'])

/** POST /video/submit → POST /video/status { requestId }. Chat, images and speech use openai-compat. */
export const siliconflow: AsyncProvider = {
  input(profile, r) {
    onlyVideo(r, '硅基流动', '；对话、图片和语音请用 openai-compat 适配器，地址相同')
    noVideoRefs(r, '硅基流动视频')
    lastNeedsFirst(r, '硅基流动')
    const images = r.first ? [{ url: r.first, role: 'first_frame' }, ...(r.last ? [{ url: r.last, role: 'last_frame' }] : [])] : undefined
    const built = clean({ model: profile.model, prompt: withAvoid(r), duration: r.duration, ratio: r.aspect && SILICONFLOW_RATIOS.has(r.aspect) ? r.aspect : undefined, images })
    return { path: '/video/submit', body: deepMerge(providerDefaults(profile.defaults), built, r.extra) }
  },
  async submit(profile, apiKey, input, signal) {
    needKey(apiKey, '硅基流动')
    const b = root(profile, SILICONFLOW_DEFAULT)
    const n = asNative(input)
    const r = await call(b + n.path, { method: 'POST', apiKey, headers: { ...JSON_TYPE, ...bearer(apiKey) }, body: JSON.stringify(n.body) }, signal, 'paid')
    if (!ok(r.status) || !r.json?.requestId) fail(r.status, r.text)
    return { remoteId: String(r.json.requestId), pollUrl: `${b}/video/status` }
  },
  async poll(profile, apiKey, job, signal) {
    const url = job.pollUrl ?? `${root(profile, SILICONFLOW_DEFAULT)}/video/status`
    const r = await call(url, { method: 'POST', apiKey, headers: { ...JSON_TYPE, ...bearer(apiKey) }, body: JSON.stringify({ requestId: job.remoteId }) }, signal, 'idempotent')
    if (!ok(r.status)) fail(r.status, r.text)
    const st = String(r.json?.status ?? '')
    if (st === 'Succeed') return { state: 'succeeded', output: urls(((r.json?.results?.videos ?? []) as { url?: string }[]).map((v) => v.url)) }
    if (st === 'Failed') return { state: 'failed', error: String(r.json?.reason || 'Failed') }
    return { state: st === 'InQueue' ? 'queued' : 'running' }
  },
  async cancel() { /* no cancel endpoint */ },
}

/* ------------------------------------------------------------------ ElevenLabs speech */

export const ELEVENLABS_DEFAULT = 'https://api.elevenlabs.io'
/** a premade voice every account has; override with the node's 音色 (a voice_id from ElevenLabs → Voices) */
export const ELEVENLABS_DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'

/** POST /v1/text-to-speech/{voice_id}?output_format=… with xi-api-key: the reply is the audio itself */
export async function elevenlabsSpeech(profile: ModelProfile, apiKey: string | undefined, req: { input: string; voice?: string; speed?: number; signal: AbortSignal }): Promise<{ bytes: Buffer; mime: string }> {
  needKey(apiKey, 'ElevenLabs ')
  const d = providerDefaults(profile.defaults)
  const voice = req.voice || (typeof d.voice_id === 'string' && d.voice_id) || ELEVENLABS_DEFAULT_VOICE
  const format = typeof d.output_format === 'string' && /^[a-z0-9_]{3,32}$/.test(d.output_format) ? d.output_format : 'mp3_44100_128'
  delete d.voice_id
  delete d.output_format
  const speed = typeof req.speed === 'number' ? Math.min(1.2, Math.max(0.7, req.speed)) : undefined
  const body = deepMerge(d, { text: req.input, model_id: profile.model }, speed === undefined ? {} : { voice_settings: { speed } })
  const url = `${root(profile, ELEVENLABS_DEFAULT)}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${encodeURIComponent(format)}`
  const fallback = format.startsWith('mp3') ? 'audio/mpeg' : format.startsWith('opus') ? 'audio/opus' : ''
  return fetchAudio(url, { headers: { ...JSON_TYPE, accept: 'audio/*', 'xi-api-key': apiKey }, body: JSON.stringify(body) }, req.signal, apiKey, fallback)
}

/* ------------------------------------------------------------------ registry */

export const NATIVE_PROVIDERS: Record<string, AsyncProvider> = { ark, dashscope, kling, minimax, runway, zhipu, siliconflow }

export type SpeechFn = (profile: ModelProfile, apiKey: string | undefined, req: { input: string; voice?: string; speed?: number; signal: AbortSignal }) => Promise<{ bytes: Buffer; mime: string }>
/** speech APIs that answer with the audio straight away */
export const SYNC_SPEECH: Record<string, SpeechFn> = { minimax: minimaxSpeech, elevenlabs: elevenlabsSpeech }

export type { Submitted }
