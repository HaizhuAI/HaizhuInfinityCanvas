import {
  AudioLines, Clapperboard, Eye, FilePlay, Image, ImagePlus, MessageSquareText, Mic, MonitorPlay, ScanSearch, ScanText, Type, Video,
  type LucideIcon,
} from 'lucide-react'
import type { ModelKind, NodeCategory, PortType } from '@hzc/core'

export const NODE_ICON: Record<string, LucideIcon> = {
  text: Type, image: Image, video: Video, audio: AudioLines,
  llm: MessageSquareText, vlm: Eye, 'image-gen': ImagePlus, 'video-gen': Clapperboard, tts: Mic,
  'image-reverse': ScanText, 'video-reverse': ScanSearch, director: Clapperboard,
  preview: MonitorPlay, export: FilePlay,
}

export const KIND_ICON: Record<ModelKind, LucideIcon> = { llm: MessageSquareText, vlm: Eye, image: ImagePlus, video: Clapperboard, tts: Mic }

export const KIND_LABEL: Record<ModelKind, string> = { llm: '文本模型', vlm: '视觉分析', image: '图片生成', video: '视频生成', tts: '语音 TTS' }

export const KIND_TO_NODE: Record<ModelKind, string> = { llm: 'llm', vlm: 'vlm', image: 'image-gen', video: 'video-gen', tts: 'tts' }

export const CATEGORY_COLOR: Record<NodeCategory, string> = {
  input: 'var(--c-input)', model: 'var(--c-model)', tool: 'var(--c-tool)', output: 'var(--c-output)',
}

export const KIND_COLOR: Record<ModelKind, string> = {
  llm: '#a78bfa', vlm: '#38bdf8', image: '#f472b6', video: '#fb923c', tts: '#34d399',
}

export const PORT_COLOR: Record<PortType, string> = {
  text: '#60a5fa', image: '#f472b6', video: '#fb923c', audio: '#34d399', storyboard: '#c084fc', any: '#9ca3af',
}

export const PORT_LABEL: Record<PortType, string> = {
  text: '文本', image: '图片', video: '视频', audio: '音频', storyboard: '分镜', any: '任意',
}
