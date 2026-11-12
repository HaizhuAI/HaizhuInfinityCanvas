export const MODEL_KINDS = ['llm', 'vlm', 'image', 'video', 'tts'] as const
export type ModelKind = (typeof MODEL_KINDS)[number]

export const ADAPTERS = [
  'openai-compat',
  'ollama',
  'replicate',
  'fal',
  'wavespeed',
  'comfyui',
  'custom-http',
  // provider-native APIs (video / image / speech)
  'ark',
  'dashscope',
  'kling',
  'minimax',
  'runway',
  'zhipu',
  'siliconflow',
  'elevenlabs',
] as const
export type AdapterId = (typeof ADAPTERS)[number]

/**
 * What each provider-native adapter can do. Chat, vision and most images on the same services go
 * through `openai-compat` (same key, often the same address); these adapters cover what that can't.
 */
export const NATIVE_ADAPTER_KINDS: Partial<Record<AdapterId, readonly ModelKind[]>> = {
  ark: ['video'],
  dashscope: ['image', 'video'],
  kling: ['image', 'video'],
  minimax: ['video', 'tts'],
  runway: ['image', 'video', 'tts'],
  zhipu: ['video'],
  siliconflow: ['video'],
  elevenlabs: ['tts'],
}

/** human names for the adapters, shown in settings */
export const ADAPTER_LABEL: Record<AdapterId, string> = {
  'openai-compat': 'OpenAI 兼容',
  ollama: 'Ollama',
  replicate: 'Replicate',
  fal: 'fal.ai',
  wavespeed: 'WaveSpeed',
  comfyui: 'ComfyUI',
  'custom-http': '自定义 HTTP',
  ark: '火山方舟 Seedance',
  dashscope: '阿里云百炼 万相',
  kling: '可灵 Kling',
  minimax: 'MiniMax 海螺',
  runway: 'Runway',
  zhipu: '智谱 CogVideoX',
  siliconflow: '硅基流动 视频',
  elevenlabs: 'ElevenLabs',
}

/**
 * A user-configured model. Each profile appears as a draggable icon in the sidebar.
 * The API key is never part of this object: it lives in the encrypted secret store
 * and is referenced by `secretRef`.
 */
export interface ModelProfile {
  id: string
  name: string
  kind: ModelKind
  adapter: AdapterId
  endpoint: string
  /** identifier of the secret in the server-side encrypted store; empty = no key */
  secretRef: string
  model: string
  defaults: Record<string, unknown>
  /** optional user-entered price of one call, used for the pre-run estimate */
  cost?: ProfileCost
  createdAt: string
  updatedAt: string
}

export interface ProfileCost { amount: number; currency: string }

/** Shape accepted from the client when creating/updating; `apiKey` is write-only. */
export interface ModelProfileInput {
  name: string
  kind: ModelKind
  adapter: AdapterId
  endpoint: string
  model: string
  defaults?: Record<string, unknown>
  cost?: ProfileCost | null
  apiKey?: string
}

/** Shape returned to the client: never includes the key, only whether one is set. */
export type ModelProfilePublic = Omit<ModelProfile, 'secretRef'> & { hasKey: boolean }

export function validateProfileInput(input: unknown): { ok: true; value: ModelProfileInput } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'body must be an object' }
  const o = input as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name.trim()) return { ok: false, error: 'name is required' }
  if (!MODEL_KINDS.includes(o.kind as ModelKind)) return { ok: false, error: `kind must be one of ${MODEL_KINDS.join(', ')}` }
  if (!ADAPTERS.includes(o.adapter as AdapterId)) return { ok: false, error: `adapter must be one of ${ADAPTERS.join(', ')}` }
  const native = NATIVE_ADAPTER_KINDS[o.adapter as AdapterId]
  if (native && !native.includes(o.kind as ModelKind)) return { ok: false, error: `adapter ${String(o.adapter)} supports ${native.join(', ')} only` }
  if (typeof o.endpoint !== 'string') return { ok: false, error: 'endpoint must be a string' }
  if (o.endpoint && !/^https?:\/\//i.test(o.endpoint)) return { ok: false, error: 'endpoint must start with http:// or https://' }
  if (typeof o.model !== 'string' || !o.model.trim()) return { ok: false, error: 'model is required' }
  if (o.defaults !== undefined && (typeof o.defaults !== 'object' || o.defaults === null || Array.isArray(o.defaults)))
    return { ok: false, error: 'defaults must be an object' }
  if (o.apiKey !== undefined && typeof o.apiKey !== 'string') return { ok: false, error: 'apiKey must be a string' }
  let cost: ProfileCost | null = null
  if (o.cost !== undefined && o.cost !== null) {
    const c = o.cost as Record<string, unknown>
    if (typeof c !== 'object' || typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount < 0)
      return { ok: false, error: 'cost.amount must be a non-negative number' }
    if (typeof c.currency !== 'string' || !/^[A-Za-z¥$€£]{1,8}$/.test(c.currency)) return { ok: false, error: 'cost.currency must be a short currency code, e.g. CNY or USD' }
    cost = { amount: c.amount, currency: c.currency.toUpperCase() }
  }
  return {
    ok: true,
    value: {
      name: o.name.trim(),
      kind: o.kind as ModelKind,
      adapter: o.adapter as AdapterId,
      endpoint: o.endpoint,
      model: o.model.trim(),
      defaults: (o.defaults as Record<string, unknown>) ?? {},
      cost,
      apiKey: o.apiKey as string | undefined,
    },
  }
}
