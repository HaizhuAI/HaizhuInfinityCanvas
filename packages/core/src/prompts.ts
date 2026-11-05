/**
 * Built-in instruction templates. Users can override them per node (`params.instruction`).
 * These are our own text (not copied from any project).
 */

export const REVERSE_STYLES = ['general', 'midjourney', 'sdxl', 'flux', 'video'] as const
export type ReverseStyle = (typeof REVERSE_STYLES)[number]
export const REVERSE_LANGS = ['zh', 'en'] as const
export type ReverseLang = (typeof REVERSE_LANGS)[number]

export const REVERSE_STYLE_LABEL: Record<ReverseStyle, string> = {
  general: '通用（自然语言）',
  midjourney: 'Midjourney',
  sdxl: 'Stable Diffusion / SDXL（标签式）',
  flux: 'Flux（长句描述）',
  video: '视频生成（含运镜/动态）',
}

const STYLE_RULES: Record<ReverseStyle, string> = {
  general: 'Write one fluent descriptive paragraph usable by any modern text-to-image model.',
  midjourney: 'Write a Midjourney prompt: comma-separated descriptive phrases, then parameters such as --ar W:H (match the image aspect ratio) and --style raw when photographic. No --v flag.',
  sdxl: 'Write a Stable Diffusion prompt as comma-separated tags ordered by importance (subject, attributes, scene, lighting, style, quality tags). Then on a new line starting with "Negative:" list common artifacts to avoid.',
  flux: 'Write a Flux prompt as 2-4 natural, concrete sentences; put the subject first; describe text in the image verbatim in quotes.',
  video: 'Write an image-to-video prompt: describe the scene, then the motion of the subject, then the camera movement (e.g. slow push-in, orbit, handheld), pacing and mood. Keep it to one paragraph.',
}

export function reversePromptInstruction(style: ReverseStyle = 'general', lang: ReverseLang = 'zh'): string {
  const langRule = lang === 'zh'
    ? 'Write the final prompt in Simplified Chinese, except model parameters/tags that must stay in English.'
    : 'Write the final prompt in English.'
  return [
    'You are a prompt engineer. Reverse-engineer a generation prompt that would reproduce the given image as closely as possible.',
    'Cover: main subject and its attributes, action/pose, composition and framing, camera/lens, lighting, color palette, environment, art style or medium, mood.',
    STYLE_RULES[style],
    langRule,
    'Output ONLY the prompt text. No preamble, no explanations, no markdown headings.',
  ].join('\n')
}

/** Instruction for reading a video's shots from one keyframe each (in order). */
export function videoReverseInstruction(durations: number[], lang: ReverseLang = 'zh'): string {
  const n = durations.length
  const list = durations.map((d, i) => `镜头 ${i + 1}：${d.toFixed(1)} 秒`).join('；')
  return [
    `下面按播放顺序给出同一段视频的 ${n} 张关键帧，每张代表一个镜头（${list}）。`,
    '请逐个镜头反推：画面里有什么、景别与镜头运动（根据构图与前后镜头推断）、可直接复用的文生图提示词与图生视频提示词。',
    '保持人物、产品与风格描述在各镜头之间一致：在每个 image_prompt 里重复同一段主体外观描述和风格描述。',
    `image_prompt 与 video_prompt 用${lang === 'en' ? '英文' : '中文'}书写，其余字段用中文。听不到声音，dialogue 一律为空字符串。`,
    '只输出一个 JSON 对象，不要解释、不要 Markdown 代码块：',
    `{"title": "这段视频的标题", "shots": [{"title": "镜头小标题", "visual": "画面内容", "camera": "景别与运镜", "dialogue": "", "image_prompt": "…", "video_prompt": "…"}]}，shots 恰好 ${n} 个，顺序与关键帧一致。`,
  ].join('\n')
}

export const DEFAULT_VLM_INSTRUCTION = '请详细描述这张图片的内容：主体、场景、构图、光线、色彩与风格。'
