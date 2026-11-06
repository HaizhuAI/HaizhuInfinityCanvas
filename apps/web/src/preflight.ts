import { ancestorsOf, NODE_TYPE_MAP, type GraphEdge, type ModelKind, type ModelProfilePublic } from '@hzc/core'
import type { Edge } from '@xyflow/react'
import type { CanvasNode } from './store'

/**
 * Pre-run check: what would certainly fail, found before anything is sent to a provider.
 * The rules mirror the server's own errors (apps/server/src/handlers.ts), so a node that passes
 * here only fails for reasons we can't know up front (network, provider, content).
 */
export type IssueType = 'model' | 'media' | 'input' | 'ffmpeg'
export interface Issue { nodeId: string; type: IssueType; text: string; kind?: ModelKind }

/** inputs a node cannot run without: a connected port, or (where allowed) its own text */
const NEEDS: Record<string, { port: string; ownText?: boolean; text: string }> = {
  'image-gen': { port: 'prompt', ownText: true, text: '没有提示词：连接一个文本节点，或在节点里写提示词' },
  'video-gen': { port: 'prompt', ownText: true, text: '没有提示词：连接一个文本节点，或在节点里写提示词' },
  llm: { port: 'in', ownText: true, text: '没有输入：连接一个文本节点，或在节点里写内容' },
  tts: { port: 'in', ownText: true, text: '没有台词：连接一个文本节点，或在节点里写要朗读的文字' },
  director: { port: 'in', ownText: true, text: '没有创意或剧本：连接一个文本节点并写下你的想法' },
  vlm: { port: 'image', text: '需要连接至少一张图片' },
  'image-reverse': { port: 'image', text: '需要连接一张图片' },
  'video-reverse': { port: 'video', text: '需要连接一个视频' },
  export: { port: 'video', text: '需要把视频片段连到「视频」端口' },
}
const MEDIA = new Set(['image', 'video', 'audio'])
const NEEDS_FFMPEG = new Set(['video-reverse', 'export'])
const MEDIA_WORD: Record<string, string> = { image: '图片', video: '视频', audio: '音频' }

export function preflight(
  s: { nodes: CanvasNode[]; edges: Edge[]; profiles: ModelProfilePublic[]; ffmpegOk: boolean | null },
  nodeIds?: string[],
): Issue[] {
  const scope = nodeIds?.length ? ancestorsOf({ edges: s.edges as unknown as GraphEdge[] }, nodeIds) : undefined
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const issues: Issue[] = []
  for (const n of s.nodes) {
    if (scope && !scope.has(n.id)) continue
    const type = n.type ?? ''
    const def = NODE_TYPE_MAP[type]
    if (!def) continue
    if (def.modelKind) {
      const p = n.data.profileId ? s.profiles.find((x) => x.id === n.data.profileId) : undefined
      if (!p || p.kind !== def.modelKind) issues.push({ nodeId: n.id, type: 'model', kind: def.modelKind, text: n.data.profileId && !p ? '之前选择的模型已被删除' : '还没有选择模型' })
    }
    if (MEDIA.has(type) && !n.data.assetId) issues.push({ nodeId: n.id, type: 'media', text: `还没有上传${MEDIA_WORD[type]}` })
    const need = NEEDS[type]
    if (need) {
      const sources = s.edges.filter((e) => e.target === n.id && (e.targetHandle ?? 'in') === need.port).map((e) => byId.get(e.source))
      const own = need.ownText && !!n.data.text?.trim()
      // a connected text node that is still empty gives the same failure as no connection
      const emptyText = sources.length > 0 && sources.every((src) => src?.type === 'text' && !src.data.text?.trim())
      if (!own && (!sources.length || emptyText)) issues.push({ nodeId: n.id, type: 'input', text: emptyText ? '连接的文本节点还是空的：先写点内容' : need.text })
    }
    if (NEEDS_FFMPEG.has(type) && s.ffmpegOk === false) issues.push({ nodeId: n.id, type: 'ffmpeg', text: '需要先在电脑上安装 FFmpeg' })
  }
  return issues
}
