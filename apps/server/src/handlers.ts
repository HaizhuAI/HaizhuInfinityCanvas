import {
  ASPECT_RATIOS, extractJson, normalizeStoryboard, StoryboardParseError, videoReverseInstruction, type Shot,
  DEFAULT_VLM_INSTRUCTION, NODE_TYPE_MAP, REVERSE_LANGS, REVERSE_STYLES, reversePromptInstruction, valuesOfType, valuesToText,
  type GraphNode, type ModelProfile, type ProjectGraph, type NodeOutputs, type PortValue, type ReverseLang, type ReverseStyle,
} from '@hzc/core'
import type { AssetStore } from './assets'
import { chatAdapterFor, ProviderError, type ChatAdapter } from './providers'
import type { SkillStore } from './skills'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectScenes, extractFrame, MediaError, probe, segmentsFromCuts, withTemp } from './media'
import { exportFilm } from './exporter'
import { ASYNC_PROVIDERS, downloadToAsset, extractMediaUrls, openaiImages, openaiSpeech, providerDefaults, runJob, type JobCtx } from './generation'

export class NodeError extends Error {}

export interface HandlerCtx {
  node: GraphNode
  inputs: Record<string, PortValue[]>
  profile?: ModelProfile
  apiKey?: string
  assets: AssetStore
  signal: AbortSignal
  /** injectable for tests */
  chatAdapter?: (p: ModelProfile) => ChatAdapter
  /** long-running provider jobs (image / video generation) */
  job: Omit<JobCtx, 'signal'>
  skills?: SkillStore
  /** the graph being run (positions are used to match voices to clips by canvas row) */
  graph?: ProjectGraph
}

export type Handler = (ctx: HandlerCtx) => Promise<NodeOutputs>

const PLANNED: Record<string, string> = {}

function requireProfile(ctx: HandlerCtx): ModelProfile {
  const def = NODE_TYPE_MAP[ctx.node.type]
  if (!ctx.node.data.profileId) throw new NodeError('未绑定模型档案')
  if (!ctx.profile) throw new NodeError('绑定的模型档案已被删除')
  if (def?.modelKind && ctx.profile.kind !== def.modelKind) throw new NodeError(`该节点需要「${def.modelKind}」类型的模型档案，当前绑定的是「${ctx.profile.kind}」`)
  return ctx.profile
}

async function chat(ctx: HandlerCtx, prompt: string, opts: { system?: string; imageIds?: string[] } = {}) {
  const profile = requireProfile(ctx)
  const adapter = (ctx.chatAdapter ?? ((p) => chatAdapterFor(p.adapter)))(profile)
  const images = (opts.imageIds ?? []).map((id) => ctx.assets.readBase64(id))
  return adapter.chat(profile, ctx.apiKey, { prompt, system: opts.system, images, signal: ctx.signal })
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

const media = (type: 'image' | 'video' | 'audio'): Handler => async ({ node }) => {
  if (!node.data.assetId || !node.data.mime) throw new NodeError('还没有上传素材')
  return { out: [{ type, assetId: node.data.assetId, mime: node.data.mime }] }
}

/** Default input field names per adapter. Override per profile with defaults._fields = { prompt, image, first, last }. */
const FIELD_DEFAULTS: Record<string, { prompt: string; image: string; first: string; last: string }> = {
  replicate: { prompt: 'prompt', image: 'image', first: 'image', last: 'end_image' },
  fal: { prompt: 'prompt', image: 'image_url', first: 'image_url', last: 'end_image_url' },
}

function dataUri(ctx: HandlerCtx, assetId: string) {
  const { mime, base64 } = ctx.assets.readBase64(assetId)
  return `data:${mime};base64,${base64}`
}

function genPrompt(ctx: HandlerCtx) {
  const prompt = valuesToText(ctx.inputs.prompt).trim() || str(ctx.node.data.text)
  if (!prompt) throw new NodeError('没有提示词：请连接文本/反推节点，或在节点内填写')
  return prompt
}

function extraParams(ctx: HandlerCtx): Record<string, unknown> {
  const raw = ctx.node.data.params?.extra
  if (raw === undefined || raw === '') return {}
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>
  try {
    const v = JSON.parse(String(raw)) as unknown
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* fallthrough */ }
  throw new NodeError('高级参数必须是 JSON 对象')
}

/** Build the provider input for replicate / fal from node inputs + profile defaults + node params. */
function asyncInput(ctx: HandlerCtx, profile: ModelProfile, media: { image?: string[]; first?: string; last?: string }, want: Want, prompt: string) {
  const userFields = (profile.defaults?._fields ?? {}) as Partial<Record<'prompt' | 'image' | 'first' | 'last', string>>
  // speech models usually call their input "text"
  const f = { ...FIELD_DEFAULTS[profile.adapter]!, ...(want === 'audio' ? { prompt: 'text' } : {}), ...userFields }
  const p = ctx.node.data.params ?? {}
  const input: Record<string, unknown> = { ...providerDefaults(profile.defaults), [f.prompt]: prompt }
  if (want === 'audio' && typeof p.voice === 'string' && p.voice) input.voice = p.voice
  if (want === 'audio' && typeof p.speed === 'number') input.speed = p.speed
  if (typeof p.aspect_ratio === 'string' && p.aspect_ratio) input.aspect_ratio = p.aspect_ratio
  if (typeof p.duration === 'number') input.duration = p.duration
  if (media.image?.length) input[f.image] = media.image.length === 1 ? media.image[0] : media.image
  if (media.first) input[f.first] = media.first
  if (media.last) input[f.last] = media.last
  return { ...input, ...extraParams(ctx) }
}

type Want = 'image' | 'video' | 'audio'
const WANT_LABEL: Record<Want, string> = { image: '图片', video: '视频', audio: '音频' }

async function generate(ctx: HandlerCtx, want: Want, media: { image?: string[]; first?: string; last?: string }, prompt: string) {
  const profile = requireProfile(ctx)
  const provider = ASYNC_PROVIDERS[profile.adapter]
  if (!provider) {
    const sync = want === 'image' ? '（或 openai-compat 的 /images/generations）' : want === 'audio' ? '（或 openai-compat 的 /audio/speech）' : ''
    throw new NodeError(`${WANT_LABEL[want]}生成请使用 replicate 或 fal 适配器${sync}`)
  }
  const timeoutSec = Number(profile.defaults?._timeoutSec ?? (want === 'video' ? 45 * 60 : 15 * 60))
  const output = await runJob({ ...ctx.job, signal: ctx.signal }, provider, profile.adapter, profile, ctx.apiKey, asyncInput(ctx, profile, media, want, prompt), timeoutSec)
  const urls = extractMediaUrls(output)
  if (!urls.length) throw new ProviderError(`模型完成了任务，但结果里没有找到${WANT_LABEL[want]}地址`)
  ctx.job.report('下载结果…')
  const assets = []
  for (const u of urls) {
    try { assets.push(await downloadToAsset(u, ctx.assets, want, ctx.signal)) } catch (e) { if (ctx.signal.aborted || urls.length === 1) throw e }
  }
  if (!assets.length) throw new ProviderError(`结果中没有可用的${WANT_LABEL[want]}`)
  return assets.map((a) => ({ type: want, assetId: a.id, mime: a.mime }) as PortValue)
}

export const DEFAULT_DIRECTOR_SKILL = 'director-short-film'

/** Appended to every director skill: the machine-readable contract the canvas relies on. */
export function directorContract(o: { shots: number; lang: 'zh' | 'en'; aspect?: string; style?: string }) {
  return [
    '## 输出格式（必须严格遵守）',
    '只输出一个 JSON 对象，不要任何解释，不要 Markdown 代码块。结构如下：',
    '{"title": "片名", "shots": [{"title": "镜头小标题", "visual": "画面内容", "camera": "景别与运镜", "dialogue": "台词或旁白，没有则为空字符串", "duration": 5, "image_prompt": "文生图提示词", "video_prompt": "图生视频提示词"}]}',
    `- shots 恰好 ${o.shots} 个，按播放顺序排列。`,
    '- duration 是 2 到 10 之间的整数（秒）。',
    `- image_prompt 和 video_prompt 用${o.lang === 'en' ? '英文' : '中文'}书写；title、visual、camera、dialogue 用中文。`,
    o.aspect ? `- 画面比例为 ${o.aspect}，按这个比例设计构图。` : '',
    o.style ? `- 整体视觉风格：${o.style}。把它写进每个 image_prompt。` : '',
  ].filter(Boolean).join('\n')
}

export const HANDLERS: Record<string, Handler> = {
  text: async ({ node }) => ({ out: [{ type: 'text', text: node.data.text ?? '' }] }),
  image: media('image'),
  video: media('video'),
  audio: media('audio'),

  llm: async (ctx) => {
    const prompt = valuesToText(ctx.inputs.in).trim() || str(ctx.node.data.text)
    if (!prompt) throw new NodeError('没有输入提示：请连接文本节点或在节点内填写')
    const text = await chat(ctx, prompt, { system: str(ctx.node.data.params?.system) || undefined })
    return { out: [{ type: 'text', text }] }
  },

  vlm: async (ctx) => {
    const imgs = valuesOfType(ctx.inputs.image, 'image')
    if (!imgs.length) throw new NodeError('请连接至少一张图片')
    const prompt = valuesToText(ctx.inputs.prompt).trim() || str(ctx.node.data.params?.instruction) || DEFAULT_VLM_INSTRUCTION
    const text = await chat(ctx, prompt, { imageIds: imgs.map((i) => i.assetId) })
    return { out: [{ type: 'text', text }] }
  },

  'image-reverse': async (ctx) => {
    const img = valuesOfType(ctx.inputs.image, 'image')[0]
    if (!img) throw new NodeError('请连接一张图片')
    const p = ctx.node.data.params ?? {}
    const style = (REVERSE_STYLES as readonly string[]).includes(p.style as string) ? (p.style as ReverseStyle) : 'general'
    const lang = (REVERSE_LANGS as readonly string[]).includes(p.lang as string) ? (p.lang as ReverseLang) : 'zh'
    const instruction = str(p.instruction) || reversePromptInstruction(style, lang)
    const text = await chat(ctx, instruction, { imageIds: [img.assetId] })
    return { out: [{ type: 'text', text: text.trim() }] }
  },

  'image-gen': async (ctx) => {
    const refs = valuesOfType(ctx.inputs.ref, 'image')
    const profile = requireProfile(ctx)
    if (profile.adapter === 'openai-compat') {
      if (refs.length) throw new NodeError('openai-compat 图片生成暂不支持参考图，请改用 replicate / fal 的图生图模型，或断开参考图')
      const urls = await openaiImages(profile, ctx.apiKey, { prompt: genPrompt(ctx), aspect: ctx.node.data.params?.aspect_ratio as string | undefined, signal: ctx.signal })
      ctx.job.report('保存结果…')
      const out: PortValue[] = []
      for (const u of urls) { const a = await downloadToAsset(u, ctx.assets, 'image', ctx.signal); out.push({ type: 'image', assetId: a.id, mime: a.mime }) }
      return { out }
    }
    return { out: await generate(ctx, 'image', { image: refs.map((r) => dataUri(ctx, r.assetId)) }, genPrompt(ctx)) }
  },

  'video-gen': async (ctx) => {
    const first = valuesOfType(ctx.inputs.first, 'image')[0]
    const last = valuesOfType(ctx.inputs.last, 'image')[0]
    return { out: await generate(ctx, 'video', { first: first && dataUri(ctx, first.assetId), last: last && dataUri(ctx, last.assetId) }, genPrompt(ctx)) }
  },

  tts: async (ctx) => {
    const text = valuesToText(ctx.inputs.in).trim() || str(ctx.node.data.text)
    if (!text) throw new NodeError('没有要朗读的文本：请连接文本节点，或在节点内填写台词')
    const profile = requireProfile(ctx)
    const p = ctx.node.data.params ?? {}
    if (profile.adapter === 'openai-compat') {
      const { bytes, mime } = await openaiSpeech(profile, ctx.apiKey, {
        input: text, voice: typeof p.voice === 'string' && p.voice ? p.voice : undefined,
        speed: typeof p.speed === 'number' ? p.speed : undefined, signal: ctx.signal,
      })
      const a = ctx.assets.put(bytes, mime, `speech.${mime.split('/')[1]}`)
      return { out: [{ type: 'audio', assetId: a.id, mime: a.mime }] }
    }
    return { out: await generate(ctx, 'audio', {}, text) }
  },

  director: async (ctx) => {
    const idea = valuesToText(ctx.inputs.in).trim() || str(ctx.node.data.text)
    if (!idea) throw new NodeError('没有创意或剧本：请连接文本节点，或在节点内填写')
    const p = ctx.node.data.params ?? {}
    const skillName = str(p.skill) || DEFAULT_DIRECTOR_SKILL
    const skill = ctx.skills?.get(skillName)
    if (!skill) throw new NodeError(`找不到 Skill「${skillName}」`)
    const shots = Math.min(12, Math.max(1, Math.round(Number(p.shots ?? 6)) || 6))
    const lang = p.lang === 'en' ? 'en' : 'zh'
    const aspect = (ASPECT_RATIOS as readonly string[]).includes(p.aspect_ratio as string) ? (p.aspect_ratio as string) : undefined
    const system = `${skill.body}\n\n${directorContract({ shots, lang, aspect, style: str(p.style) || undefined })}`
    const ask = `请为下面的内容设计 ${shots} 个镜头的分镜：\n\n${idea}`
    let reply = await chat(ctx, ask, { system })
    try {
      return { out: [{ type: 'storyboard', ...normalizeStoryboard(extractJson(reply)) }] }
    } catch (e) {
      if (!(e instanceof StoryboardParseError)) throw e
      ctx.job.report('输出格式不对，正在让模型重写…')
      reply = await chat(ctx, `${ask}\n\n（你上一次的回复无法解析：${e.message}。这次只输出符合格式的 JSON 对象。）`, { system })
      try {
        return { out: [{ type: 'storyboard', ...normalizeStoryboard(extractJson(reply)) }] }
      } catch (e2) {
        if (!(e2 instanceof StoryboardParseError)) throw e2
        throw new NodeError(`模型两次都没有返回有效分镜（${e2.message}）。模型回复开头：${reply.slice(0, 160)}`)
      }
    }
  },

  'video-reverse': async (ctx) => {
    const vid = valuesOfType(ctx.inputs.video, 'video')[0]
    if (!vid) throw new NodeError('请连接一个视频')
    const asset = ctx.assets.get(vid.assetId)
    if (!asset) throw new NodeError('视频素材不存在')
    requireProfile(ctx)
    const p = ctx.node.data.params ?? {}
    const maxShots = Math.min(16, Math.max(1, Math.round(Number(p.maxShots ?? 8)) || 8))
    const threshold = Math.min(0.9, Math.max(0.05, Number(p.threshold ?? 0.3) || 0.3))
    const lang = p.lang === 'en' ? 'en' : 'zh'
    try {
      ctx.job.report('读取视频信息…')
      const info = await probe(asset.file, ctx.signal)
      if (!info.duration) throw new NodeError('无法读取视频时长')
      ctx.job.report('分析镜头切换…')
      const segs = segmentsFromCuts(await detectScenes(asset.file, threshold, ctx.signal), info.duration, maxShots)
      const frames = await withTemp(ctx.assets.dataDir, async (dir) => {
        const out: { assetId: string; mime: string }[] = []
        for (const [i, s] of segs.entries()) {
          ctx.job.report(`提取关键帧 ${i + 1}/${segs.length}`)
          const f = join(dir, `k${i}.jpg`)
          await extractFrame(asset.file, s.start + (s.end - s.start) / 2, f, 768, ctx.signal)
          const a = ctx.assets.put(readFileSync(f), 'image/jpeg', `关键帧-${i + 1}.jpg`)
          out.push({ assetId: a.id, mime: a.mime })
        }
        return out
      })
      const durations = segs.map((s) => s.end - s.start)
      ctx.job.report('视觉模型解读镜头…')
      const reply = await chat(ctx, videoReverseInstruction(durations, lang), { imageIds: frames.map((f) => f.assetId) })
      let parsed: { title?: string; shots: Shot[] }
      try { parsed = normalizeStoryboard(extractJson(reply)) } catch (e) {
        if (!(e instanceof StoryboardParseError)) throw e
        throw new NodeError(`视觉模型没有返回有效的镜头表（${e.message}）。回复开头：${reply.slice(0, 160)}`)
      }
      // the video, not the model, is the source of truth for count, timing and keyframes
      const shots: Shot[] = segs.map((s, i) => {
        const m = parsed.shots[i]
        return {
          index: i + 1,
          title: m?.title || `镜头 ${i + 1}`,
          visual: m?.visual || '（模型未描述这个镜头）',
          camera: m?.camera ?? '',
          dialogue: '',
          duration: Math.max(1, Math.round(s.end - s.start)),
          imagePrompt: m?.imagePrompt || m?.visual || '',
          videoPrompt: m?.videoPrompt || '',
          keyframe: frames[i],
          start: Math.round(s.start * 100) / 100,
        }
      })
      const text = shots.map((s) => `镜头 ${s.index}（${s.duration}s）\n画面：${s.imagePrompt}\n运动：${s.videoPrompt}`).join('\n\n')
      return {
        out: [{ type: 'storyboard', ...(parsed.title ? { title: parsed.title } : {}), shots }],
        text: [{ type: 'text', text }],
      }
    } catch (e) {
      if (e instanceof MediaError) throw new NodeError(e.message)
      throw e
    }
  },

  export: async (ctx) => {
    const clips = valuesOfType(ctx.inputs.video, 'video')
    if (!clips.length) throw new NodeError('请把要合成的视频片段连到「视频」端口（按画布上从上到下、从左到右的顺序拼接）')
    const file = (id: string) => { const a = ctx.assets.get(id); if (!a) throw new NodeError('有一个素材已不存在'); return a.file }
    const p = ctx.node.data.params ?? {}
    // keep blank lines: line i belongs to clip i, a blank line is a silent shot
    const subs = valuesToText(ctx.inputs.subs).replace(/\s+$/, '').split('\n').map((l) => l.trim())
    // match each voice to the clip in the same canvas row (nearest y within 240px)
    const g = ctx.graph
    const srcY = (handle: string) => g ? g.edges.filter((e) => e.target === ctx.node.id && e.targetHandle === handle)
      .map((e) => g.nodes.find((n) => n.id === e.source)?.position).filter(Boolean).sort((a, b) => a!.y - b!.y || a!.x - b!.x).map((q) => q!.y) : []
    const clipY = srcY('video'), voiceY = srcY('audio')
    const voices = valuesOfType(ctx.inputs.audio, 'audio')
    let voiceClip: number[] | undefined
    if (clipY.length === clips.length && voiceY.length === voices.length && voices.length !== clips.length) {
      const m = voiceY.map((y) => { let best = -1, d = Infinity; clipY.forEach((cy, i) => { const dd = Math.abs(cy - y); if (dd < d) { d = dd; best = i } }); return d <= 240 ? best : -1 })
      if (m.every((i) => i >= 0)) voiceClip = m
    }
    try {
      ctx.job.report('准备片段…')
      const r = await exportFilm({
        clips: clips.map((c) => ({ file: file(c.assetId) })),
        voices: voices.map((a) => file(a.assetId)),
        voiceClip,
        subtitles: subs,
        size: typeof p.size === 'string' ? p.size : undefined,
        fps: typeof p.fps === 'number' ? p.fps : undefined,
        keepAudio: p.keepAudio === 'drop' ? 'drop' : 'mix',
        dataDir: ctx.assets.dataDir, signal: ctx.signal,
        onProgress: (pct) => ctx.job.report(`合成中 ${pct}%`),
      })
      const a = ctx.assets.put(r.bytes, 'video/mp4', `成片-${r.size}.mp4`)
      return { out: [{ type: 'video', assetId: a.id, mime: a.mime }], ...(r.srt ? { srt: [{ type: 'text', text: r.srt }] } : {}) }
    } catch (e) {
      if (e instanceof MediaError) throw new NodeError(e.message)
      throw e
    }
  },

  // preview has no outputs; we store what it received under `in` so the UI can render it
  preview: async ({ inputs }) => ({ in: inputs.in ?? [] }),
}

export function handlerFor(type: string): Handler {
  const h = HANDLERS[type]
  if (h) return h
  const v = PLANNED[type]
  return async () => { throw new NodeError(v ? `该节点将在 ${v} 实现` : `未知节点类型：${type}`) }
}
