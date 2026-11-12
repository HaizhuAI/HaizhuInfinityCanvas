import type { AdapterId, ModelKind } from '@hzc/core'

/** how one provider serves one kind of model: the adapter, its address and the model IDs most people start with */
export interface PresetTarget {
  adapter: AdapterId
  endpoint: string
  /** model IDs from the provider's docs, offered as one-click chips (the connection test lists the rest) */
  models?: string[]
  /** written into the profile's default params when this provider is picked */
  defaults?: Record<string, unknown>
}

export type PresetGroup = 'cn' | 'global' | 'local'
export const GROUP_LABEL: Record<PresetGroup, string> = { cn: '国内', global: '海外', local: '本机' }

export interface Preset {
  id: string
  label: string
  group: PresetGroup
  /** where the user creates a key */
  keyUrl?: string
  local?: boolean
  kinds: Partial<Record<ModelKind, PresetTarget>>
}

const t = (adapter: AdapterId, endpoint: string, models?: string[], defaults?: Record<string, unknown>): PresetTarget => ({ adapter, endpoint, models, defaults })
const chat = (endpoint: string, llm?: string[], vlm?: string[]) => ({ llm: t('openai-compat', endpoint, llm), vlm: t('openai-compat', endpoint, vlm) })

const ARK = 'https://ark.cn-beijing.volces.com/api/v3'
const ZHIPU = 'https://open.bigmodel.cn/api/paas/v4'
const SILICONFLOW = 'https://api.siliconflow.cn/v1'
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai'

/**
 * Providers and their published endpoints (checked against each provider's API reference; see
 * docs/03-guide/model-providers.md). Chat, vision and most images go through the OpenAI-compatible
 * adapter; video and some images / speech through the provider's own API.
 */
export const PRESETS: Preset[] = [
  // ------------------------------------------------ 国内
  {
    id: 'ark', label: '火山方舟（豆包）', group: 'cn', keyUrl: 'https://console.volcengine.com/ark',
    kinds: { ...chat(ARK), image: t('openai-compat', ARK), video: t('ark', ARK, ['doubao-seedance-1-0-pro-250528', 'doubao-seedance-2-5-260628']) },
  },
  {
    id: 'dashscope', label: '阿里云百炼（通义）', group: 'cn', keyUrl: 'https://bailian.console.aliyun.com/',
    kinds: {
      ...chat('https://dashscope.aliyuncs.com/compatible-mode/v1'),
      image: t('dashscope', 'https://dashscope.aliyuncs.com', ['wan2.6-t2i', 'wan2.2-t2i-flash']),
      video: t('dashscope', 'https://dashscope.aliyuncs.com', ['wan2.7-t2v', 'wan2.7-i2v-2026-04-25', 'wan2.2-kf2v-flash']),
    },
  },
  {
    id: 'kling', label: '可灵 Kling', group: 'cn', keyUrl: 'https://kling.ai/document-api',
    kinds: { image: t('kling', 'https://api-singapore.klingai.com', ['kling-v3', 'kling-v2-1']), video: t('kling', 'https://api-singapore.klingai.com', ['kling-2.5-turbo', 'kling-3.0', 'kling-4.0']) },
  },
  {
    id: 'minimax', label: 'MiniMax 海螺', group: 'cn', keyUrl: 'https://platform.minimax.cn/',
    kinds: {
      ...chat('https://api.minimax.cn/v1', ['MiniMax-M3', 'MiniMax-M3.1-Flash'], ['MiniMax-M3', 'MiniMax-M3.1-Flash']),
      video: t('minimax', 'https://api.minimax.cn', ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-02', 'MiniMax-H3']),
      tts: t('minimax', 'https://api.minimax.cn', ['speech-2.8-hd', 'speech-2.6-hd', 'speech-2.8-turbo']),
    },
  },
  {
    id: 'zhipu', label: '智谱 BigModel', group: 'cn', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    kinds: {
      ...chat(ZHIPU, ['glm-5.3', 'glm-4.7'], ['glm-4.6v', 'glm-5v-turbo']),
      image: t('openai-compat', ZHIPU, ['cogview-4', 'glm-image']),
      video: t('zhipu', ZHIPU, ['cogvideox-3', 'cogvideox-flash']),
    },
  },
  {
    id: 'siliconflow', label: '硅基流动', group: 'cn', keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    kinds: {
      ...chat(SILICONFLOW),
      image: t('openai-compat', SILICONFLOW, ['Kwai-Kolors/Kolors'], { _sizeField: 'image_size' }),
      video: t('siliconflow', SILICONFLOW, ['MiniMaxAI/MiniMax-H3']),
      tts: t('openai-compat', SILICONFLOW, ['FunAudioLLM/CosyVoice2-0.5B']),
    },
  },
  { id: 'moonshot', label: 'Kimi（月之暗面）', group: 'cn', keyUrl: 'https://platform.moonshot.cn/console/api-keys', kinds: chat('https://api.moonshot.cn/v1', ['kimi-k3', 'kimi-k3.1-pro'], ['kimi-k3', 'kimi-k3.1-pro']) },
  { id: 'deepseek', label: 'DeepSeek', group: 'cn', keyUrl: 'https://platform.deepseek.com/api_keys', kinds: { llm: t('openai-compat', 'https://api.deepseek.com/v1') } },
  // ------------------------------------------------ 海外
  {
    id: 'openai', label: 'OpenAI', group: 'global', keyUrl: 'https://platform.openai.com/api-keys',
    kinds: { ...chat('https://api.openai.com/v1'), image: t('openai-compat', 'https://api.openai.com/v1'), tts: t('openai-compat', 'https://api.openai.com/v1') },
  },
  {
    id: 'gemini', label: 'Google Gemini', group: 'global', keyUrl: 'https://aistudio.google.com/apikey',
    kinds: { ...chat(GEMINI), image: t('openai-compat', GEMINI, ['gemini-2.5-flash-image'], { response_format: 'b64_json' }) },
  },
  {
    id: 'runway', label: 'Runway', group: 'global', keyUrl: 'https://dev.runwayml.com/',
    kinds: {
      image: t('runway', 'https://api.dev.runwayml.com', ['gen4_image', 'gen4_image_turbo']),
      video: t('runway', 'https://api.dev.runwayml.com', ['gen4.5', 'gen4_turbo']),
      tts: t('runway', 'https://api.dev.runwayml.com', ['eleven_multilingual_v2', 'eleven_v3']),
    },
  },
  { id: 'elevenlabs', label: 'ElevenLabs', group: 'global', keyUrl: 'https://elevenlabs.io/app/settings/api-keys', kinds: { tts: t('elevenlabs', 'https://api.elevenlabs.io', ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5']) } },
  {
    id: 'minimax-intl', label: 'MiniMax（国际）', group: 'global', keyUrl: 'https://platform.minimax.io/',
    kinds: {
      ...chat('https://api.minimax.io/v1', ['MiniMax-M3', 'MiniMax-M3.1-Flash'], ['MiniMax-M3', 'MiniMax-M3.1-Flash']),
      video: t('minimax', 'https://api.minimax.io', ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-02', 'MiniMax-H3']),
      tts: t('minimax', 'https://api.minimax.io', ['speech-2.8-hd', 'speech-2.6-hd', 'speech-2.8-turbo']),
    },
  },
  {
    id: 'dashscope-intl', label: '阿里云百炼（国际）', group: 'global', keyUrl: 'https://modelstudio.console.alibabacloud.com/',
    kinds: {
      ...chat('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'),
      image: t('dashscope', 'https://dashscope-intl.aliyuncs.com', ['wan2.6-t2i']),
      video: t('dashscope', 'https://dashscope-intl.aliyuncs.com', ['wan2.7-t2v', 'wan2.7-i2v-2026-04-25']),
    },
  },
  { id: 'openrouter', label: 'OpenRouter', group: 'global', keyUrl: 'https://openrouter.ai/keys', kinds: chat('https://openrouter.ai/api/v1') },
  {
    id: 'replicate', label: 'Replicate', group: 'global', keyUrl: 'https://replicate.com/account/api-tokens',
    kinds: { image: t('replicate', 'https://api.replicate.com/v1'), video: t('replicate', 'https://api.replicate.com/v1'), tts: t('replicate', 'https://api.replicate.com/v1') },
  },
  {
    id: 'fal', label: 'fal.ai', group: 'global', keyUrl: 'https://fal.ai/dashboard/keys',
    kinds: { image: t('fal', 'https://queue.fal.run'), video: t('fal', 'https://queue.fal.run'), tts: t('fal', 'https://queue.fal.run') },
  },
  // ------------------------------------------------ 本机
  { id: 'ollama', label: 'Ollama', group: 'local', local: true, kinds: { llm: t('ollama', 'http://127.0.0.1:11434'), vlm: t('ollama', 'http://127.0.0.1:11434') } },
  { id: 'lmstudio', label: 'LM Studio', group: 'local', local: true, kinds: chat('http://127.0.0.1:1234/v1') },
  { id: 'kokoro', label: 'Kokoro / 本机 TTS', group: 'local', local: true, kinds: { tts: t('openai-compat', 'http://127.0.0.1:8880/v1') } },
]

const norm = (u: string) => u.trim().replace(/\/+$/, '')

/** the provider (and its target for this kind) a profile's adapter + address belong to */
export function presetOf(f: { kind: ModelKind; adapter: string; endpoint: string }): { preset: Preset; target: PresetTarget } | null {
  for (const p of PRESETS) {
    const target = p.kinds[f.kind]
    if (target && target.adapter === f.adapter && target.endpoint === norm(f.endpoint)) return { preset: p, target }
  }
  return null
}

/** what to type in a speech node's 音色 field, per adapter */
export const VOICE_HINT: Partial<Record<AdapterId, string>> = {
  'openai-compat': '如 alloy',
  minimax: '如 Chinese (Mandarin)_Lyrical_Voice',
  elevenlabs: 'voice_id，留空用默认音色',
  runway: '如 Maya',
}
