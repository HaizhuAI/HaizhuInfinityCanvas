/** One shot of a storyboard, as produced by a director skill (or, from beta.5, by video reverse). */
export interface Shot {
  index: number
  title: string
  /** what is on screen */
  visual: string
  /** shot size and camera movement */
  camera: string
  /** spoken line / voice-over; empty when silent */
  dialogue: string
  /** seconds */
  duration: number
  /** ready-to-use text-to-image prompt (keeps character/style descriptors for consistency) */
  imagePrompt: string
  /** ready-to-use image-to-video prompt (motion + camera) */
  videoPrompt: string
}

export interface Storyboard { title?: string; shots: Shot[] }

export class StoryboardParseError extends Error {}

/** Pull the first JSON value out of an LLM reply (handles ```json fences and chatter around it). */
export function extractJson(text: string): unknown {
  const t = text.trim()
  try { return JSON.parse(t) } catch { /* fall through */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)
  if (fenced) { try { return JSON.parse(fenced[1]!.trim()) } catch { /* fall through */ } }
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = t.indexOf(open), b = t.lastIndexOf(close)
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { /* try next */ } }
  }
  throw new StoryboardParseError('模型没有返回可解析的 JSON')
}

const pick = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
  return undefined
}
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : Array.isArray(v) ? v.join('，') : '')

function seconds(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return 5
  return Math.min(60, Math.max(1, Math.round(n)))
}

/** Accepts {shots:[…]}, {storyboard:[…]}, {scenes:[…]} or a bare array; tolerant of key styles. */
export function normalizeStoryboard(raw: unknown): Storyboard {
  const root = (Array.isArray(raw) ? { shots: raw } : raw) as Record<string, unknown> | null
  if (!root || typeof root !== 'object') throw new StoryboardParseError('分镜不是 JSON 对象')
  const list = pick(root, ['shots', 'storyboard', 'scenes', '分镜', '镜头'])
  if (!Array.isArray(list) || list.length === 0) throw new StoryboardParseError('分镜里没有镜头（shots 为空）')
  const shots: Shot[] = list.map((item, i) => {
    const o = (item && typeof item === 'object' ? item : { visual: String(item) }) as Record<string, unknown>
    const visual = str(pick(o, ['visual', 'description', 'scene', 'picture', '画面', '画面描述']))
    const camera = str(pick(o, ['camera', 'camera_movement', 'cameraMovement', 'shot_type', 'movement', '运镜', '镜头语言']))
    const imagePrompt = str(pick(o, ['image_prompt', 'imagePrompt', 'prompt', 't2i_prompt', '图片提示词'])) || visual
    return {
      index: i + 1,
      title: str(pick(o, ['title', 'name', 'shot_title', '标题'])) || `镜头 ${i + 1}`,
      visual,
      camera,
      dialogue: str(pick(o, ['dialogue', 'line', 'lines', 'voiceover', 'voice_over', 'narration', '台词', '旁白'])),
      duration: seconds(pick(o, ['duration', 'seconds', 'length', '时长'])),
      imagePrompt,
      videoPrompt: str(pick(o, ['video_prompt', 'videoPrompt', 'i2v_prompt', 'motion', '视频提示词'])) || [visual, camera].filter(Boolean).join('，'),
    }
  })
  if (shots.every((s) => !s.visual && !s.imagePrompt)) throw new StoryboardParseError('镜头缺少画面描述')
  const title = str(pick(root, ['title', 'name', '片名', '标题']))
  return { ...(title ? { title } : {}), shots }
}

/** Plain-text rendering for text consumers (an LLM downstream, copy to clipboard). */
export function storyboardToText(sb: Storyboard): string {
  const head = sb.title ? `《${sb.title}》\n\n` : ''
  return head + sb.shots.map((s) => [
    `镜头 ${s.index}｜${s.title}（${s.duration}s）`,
    s.visual && `画面：${s.visual}`,
    s.camera && `运镜：${s.camera}`,
    s.dialogue && `台词：${s.dialogue}`,
  ].filter(Boolean).join('\n')).join('\n\n')
}
