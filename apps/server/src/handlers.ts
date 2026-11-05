import {
  DEFAULT_VLM_INSTRUCTION, NODE_TYPE_MAP, REVERSE_LANGS, REVERSE_STYLES, reversePromptInstruction, valuesOfType, valuesToText,
  type GraphNode, type ModelProfile, type NodeOutputs, type PortValue, type ReverseLang, type ReverseStyle,
} from '@hzc/core'
import type { AssetStore } from './assets'
import { chatAdapterFor, type ChatAdapter } from './providers'

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
}

export type Handler = (ctx: HandlerCtx) => Promise<NodeOutputs>

const PLANNED: Record<string, string> = {
  'image-gen': 'v1.0.0-beta.3', 'video-gen': 'v1.0.0-beta.3', tts: 'v1.0.0-beta.4', director: 'v1.0.0-beta.4',
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

  // preview has no outputs; we store what it received under `in` so the UI can render it
  preview: async ({ inputs }) => ({ in: inputs.in ?? [] }),
}

export function handlerFor(type: string): Handler {
  const h = HANDLERS[type]
  if (h) return h
  const v = PLANNED[type]
  return async () => { throw new NodeError(v ? `该节点将在 ${v} 实现` : `未知节点类型：${type}`) }
}
