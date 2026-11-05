import {
  DEFAULT_VLM_INSTRUCTION, NODE_TYPE_MAP, REVERSE_LANGS, REVERSE_STYLES, reversePromptInstruction, valuesOfType, valuesToText,
  type GraphNode, type ModelProfile, type NodeOutputs, type PortValue, type ReverseLang, type ReverseStyle,
} from '@hzc/core'
import type { AssetStore } from './assets'
import { chatAdapterFor, ProviderError, type ChatAdapter } from './providers'
import { ASYNC_PROVIDERS, downloadToAsset, extractMediaUrls, openaiImages, providerDefaults, runJob, type JobCtx } from './generation'

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
}

export type Handler = (ctx: HandlerCtx) => Promise<NodeOutputs>

const PLANNED: Record<string, string> = {
  tts: 'v1.0.0-beta.4', director: 'v1.0.0-beta.4',
  'video-reverse': 'v1.0.0-beta.5', export: 'v1.0.0-beta.6',
}

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
function asyncInput(ctx: HandlerCtx, profile: ModelProfile, media: { image?: string[]; first?: string; last?: string }) {
  const userFields = (profile.defaults?._fields ?? {}) as Partial<Record<'prompt' | 'image' | 'first' | 'last', string>>
  const f = { ...FIELD_DEFAULTS[profile.adapter]!, ...userFields }
  const p = ctx.node.data.params ?? {}
  const input: Record<string, unknown> = { ...providerDefaults(profile.defaults), [f.prompt]: genPrompt(ctx) }
  if (typeof p.aspect_ratio === 'string' && p.aspect_ratio) input.aspect_ratio = p.aspect_ratio
  if (typeof p.duration === 'number') input.duration = p.duration
  if (media.image?.length) input[f.image] = media.image.length === 1 ? media.image[0] : media.image
  if (media.first) input[f.first] = media.first
  if (media.last) input[f.last] = media.last
  return { ...input, ...extraParams(ctx) }
}

async function generate(ctx: HandlerCtx, want: 'image' | 'video', media: { image?: string[]; first?: string; last?: string }) {
  const profile = requireProfile(ctx)
  const provider = ASYNC_PROVIDERS[profile.adapter]
  if (!provider) throw new NodeError(`${want === 'image' ? '图片' : '视频'}生成请使用 replicate 或 fal 适配器${want === 'image' ? '（或 openai-compat 的 /images/generations）' : ''}`)
  const timeoutSec = Number(profile.defaults?._timeoutSec ?? (want === 'video' ? 45 * 60 : 15 * 60))
  const output = await runJob({ ...ctx.job, signal: ctx.signal }, provider, profile.adapter, profile, ctx.apiKey, asyncInput(ctx, profile, media), timeoutSec)
  const urls = extractMediaUrls(output)
  if (!urls.length) throw new ProviderError('模型完成了任务，但结果里没有找到图片/视频地址')
  ctx.job.report('下载结果…')
  const assets = []
  for (const u of urls) {
    try { assets.push(await downloadToAsset(u, ctx.assets, want, ctx.signal)) } catch (e) { if (ctx.signal.aborted || urls.length === 1) throw e }
  }
  if (!assets.length) throw new ProviderError(`结果中没有可用的${want === 'image' ? '图片' : '视频'}`)
  return assets.map((a) => ({ type: want, assetId: a.id, mime: a.mime }) as PortValue)
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
    return { out: await generate(ctx, 'image', { image: refs.map((r) => dataUri(ctx, r.assetId)) }) }
  },

  'video-gen': async (ctx) => {
    const first = valuesOfType(ctx.inputs.first, 'image')[0]
    const last = valuesOfType(ctx.inputs.last, 'image')[0]
    return { out: await generate(ctx, 'video', { first: first && dataUri(ctx, first.assetId), last: last && dataUri(ctx, last.assetId) }) }
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
