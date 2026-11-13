import {
  AudioLines, Clapperboard, Eye, FilePlay, Image, ImagePlus, MessageSquareText, Mic, MonitorPlay, ScanSearch, ScanText, Type, UserRound, Video,
  type LucideIcon,
} from 'lucide-react'
import type { ModelKind, NodeCategory, PortType } from '@hzc/core'

export const NODE_ICON: Record<string, LucideIcon> = {
  text: Type, image: Image, video: Video, audio: AudioLines, subject: UserRound,
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
  llm: '#6cb6ff', vlm: '#39c5cf', image: '#f0808f', video: '#e3b341', tts: '#56d364',
}

export const ASPECT_CSS: Record<string, string> = { '1:1': '1 / 1', '16:9': '16 / 9', '9:16': '9 / 16', '4:3': '4 / 3', '3:4': '3 / 4', '21:9': '21 / 9' }

/** data types on ports and wires: distinct from each other and from the accent (orange = action, selection, running) */
export const PORT_COLOR: Record<PortType, string> = {
  text: '#6cb6ff', image: '#f0808f', video: '#e3b341', audio: '#56d364', storyboard: '#b8bcc2', file: '#39c5cf', any: '#8b8d92',
}

export const PORT_LABEL: Record<PortType, string> = {
  text: '文本', image: '图片', video: '视频', audio: '音频', storyboard: '分镜', file: '文件', any: '任意',
}

/**
 * The Haizhu mark (rc.18): a canvas frame left open at one corner, a node on it, and a bezier wire
 * that runs out through the opening to a signal-orange point: an infinite canvas you draw on. Lines
 * take the text colour; only the point is in the accent.
 */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12.5 3.5H6.5a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8.6" cy="15.4" r="1.9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M10.4 14.6C15.8 12.4 12.6 6.4 17.4 5.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle className="dot" cx="19.3" cy="4.9" r="2.2" fill="#ff4a1f" />
    </svg>
  )
}
