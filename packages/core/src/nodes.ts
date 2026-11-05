import type { ModelKind } from './profiles'
import type { PortSpec } from './ports'

export type NodeCategory = 'input' | 'model' | 'tool' | 'output'

/** Built-in node types. Model nodes additionally bind to a ModelProfile via `data.profileId`. */
export interface NodeTypeDef {
  type: string
  category: NodeCategory
  label: string
  description: string
  inputs: PortSpec[]
  outputs: PortSpec[]
  /** for model nodes: which profile kind can be bound */
  modelKind?: ModelKind
}

export const NODE_TYPES: NodeTypeDef[] = [
  // ---- inputs
  { type: 'text', category: 'input', label: '文本 / 笔记', description: '剧本、创意、提示词', inputs: [], outputs: [{ id: 'out', type: 'text', label: '文本' }] },
  { type: 'image', category: 'input', label: '图片', description: '导入图片素材', inputs: [], outputs: [{ id: 'out', type: 'image', label: '图片' }] },
  { type: 'video', category: 'input', label: '视频', description: '导入视频素材', inputs: [], outputs: [{ id: 'out', type: 'video', label: '视频' }] },
  { type: 'audio', category: 'input', label: '音频', description: '导入音频素材', inputs: [], outputs: [{ id: 'out', type: 'audio', label: '音频' }] },

  // ---- model agents (bound to profiles)
  {
    type: 'llm', category: 'model', modelKind: 'llm', label: '文本模型', description: '对话 / 改写 / 脚本生成',
    inputs: [{ id: 'in', type: 'text', label: '提示', multiple: true }],
    outputs: [{ id: 'out', type: 'text', label: '文本' }],
  },
  {
    type: 'vlm', category: 'model', modelKind: 'vlm', label: '视觉分析', description: '看图 / 看帧并描述',
    inputs: [{ id: 'image', type: 'image', label: '图片', multiple: true }, { id: 'prompt', type: 'text', label: '指令' }],
    outputs: [{ id: 'out', type: 'text', label: '描述' }],
  },
  {
    type: 'image-gen', category: 'model', modelKind: 'image', label: '图片生成', description: '文生图 / 图生图',
    inputs: [{ id: 'prompt', type: 'text', label: '提示词' }, { id: 'ref', type: 'image', label: '参考图', multiple: true }],
    outputs: [{ id: 'out', type: 'image', label: '图片' }],
  },
  {
    type: 'video-gen', category: 'model', modelKind: 'video', label: '视频生成', description: '文生视频 / 图生视频 / 首尾帧',
    inputs: [{ id: 'prompt', type: 'text', label: '提示词' }, { id: 'first', type: 'image', label: '首帧' }, { id: 'last', type: 'image', label: '尾帧' }],
    outputs: [{ id: 'out', type: 'video', label: '视频' }],
  },
  {
    type: 'tts', category: 'model', modelKind: 'tts', label: '语音合成 TTS', description: '文本转配音',
    inputs: [{ id: 'in', type: 'text', label: '台词' }],
    outputs: [{ id: 'out', type: 'audio', label: '音频' }],
  },

  // ---- tools
  {
    type: 'image-reverse', category: 'tool', modelKind: 'vlm', label: '图片提示词反推', description: '图片 → 可复用的生成提示词',
    inputs: [{ id: 'image', type: 'image', label: '图片' }],
    outputs: [{ id: 'out', type: 'text', label: '提示词' }],
  },
  {
    type: 'video-reverse', category: 'tool', modelKind: 'vlm', label: '视频提示词反推', description: '视频 → 抽帧 → 镜头表',
    inputs: [{ id: 'video', type: 'video', label: '视频' }],
    outputs: [{ id: 'out', type: 'storyboard', label: '分镜' }, { id: 'text', type: 'text', label: '提示词' }],
  },
  {
    type: 'director', category: 'tool', modelKind: 'llm', label: '导演 Skill', description: '创意/剧本 → 分镜（SKILL.md）',
    inputs: [{ id: 'in', type: 'text', label: '创意 / 剧本' }],
    outputs: [{ id: 'out', type: 'storyboard', label: '分镜' }],
  },

  // ---- outputs
  { type: 'preview', category: 'output', label: '预览', description: '查看任意结果', inputs: [{ id: 'in', type: 'any', label: '输入', multiple: true }], outputs: [] },
  {
    type: 'export', category: 'output', label: '导出成片', description: '合成视频 + 配音 + 字幕',
    inputs: [{ id: 'video', type: 'video', label: '视频', multiple: true }, { id: 'audio', type: 'audio', label: '配音', multiple: true }, { id: 'subs', type: 'text', label: '字幕' }],
    outputs: [{ id: 'out', type: 'video', label: '成片' }],
  },
]

export const NODE_TYPE_MAP: Record<string, NodeTypeDef> = Object.fromEntries(NODE_TYPES.map((n) => [n.type, n]))

export const CATEGORY_LABEL: Record<NodeCategory, string> = {
  input: '素材输入',
  model: '模型智能体',
  tool: '创作工具',
  output: '输出',
}
