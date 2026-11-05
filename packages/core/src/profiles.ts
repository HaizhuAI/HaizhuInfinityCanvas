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
] as const
export type AdapterId = (typeof ADAPTERS)[number]

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
