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

export const DEFAULT_VLM_INSTRUCTION = '请详细描述这张图片的内容：主体、场景、构图、光线、色彩与风格。'
