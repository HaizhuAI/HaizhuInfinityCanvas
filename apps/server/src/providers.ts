import type { AdapterId, ModelProfile } from '@hzc/core'

export interface ChatImage { mime: string; base64: string }

export interface ChatRequest {
  system?: string
  prompt: string
  images?: ChatImage[]
  signal: AbortSignal
}

export type ChatProfile = Pick<ModelProfile, 'adapter' | 'endpoint' | 'model' | 'defaults'>

export interface ChatAdapter {
  chat(profile: ChatProfile, apiKey: string | undefined, req: ChatRequest): Promise<string>
}

export class ProviderError extends Error {}

const TIMEOUT_MS = Number(process.env.HZC_PROVIDER_TIMEOUT_MS ?? 180_000)
/** keys the user may not override through `defaults` */
const RESERVED = new Set(['model', 'messages', 'stream'])

function joinUrl(base: string, path: string) {
  const b = base.replace(/\/+$/, '')
  return b.endsWith(path) ? b : b + path
}

/** request parameters from the profile; keys starting with _ configure the canvas (never sent) */
function pickDefaults(d: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !RESERVED.has(k) && !k.startsWith('_')))
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal, apiKey?: string) {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
  } catch (e) {
    if (signal.aborted) throw e
    const err = e as Error & { cause?: { code?: string } }
    throw new ProviderError(`请求失败：${err.name === 'TimeoutError' ? `超时（${TIMEOUT_MS / 1000}s）` : (err.cause?.code ?? err.message)}`)
  }
  const text = await res.text()
  if (!res.ok) {
    const safe = (apiKey ? text.split(apiKey).join('***') : text).slice(0, 500)
    throw new ProviderError(`模型服务返回 ${res.status}：${safe}`)
  }
  try { return JSON.parse(text) as unknown } catch { throw new ProviderError('模型服务返回了非 JSON 内容') }
}

/** OpenAI-compatible Chat Completions (OpenAI, DeepSeek, Qwen/DashScope compat, OpenRouter, vLLM, LM Studio …). */
export const openaiCompat: ChatAdapter = {
  async chat(profile, apiKey, req) {
    if (!profile.endpoint) throw new ProviderError('模型档案未填写接口地址')
    const content: unknown[] = [{ type: 'text', text: req.prompt }]
    for (const im of req.images ?? []) content.push({ type: 'image_url', image_url: { url: `data:${im.mime};base64,${im.base64}` } })
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      { role: 'user', content: req.images?.length ? content : req.prompt },
    ]
    const json = (await postJson(
      joinUrl(profile.endpoint, '/chat/completions'),
      { ...pickDefaults(profile.defaults), model: profile.model, messages, stream: false },
      apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      req.signal, apiKey,
    )) as { choices?: { message?: { content?: unknown } }[] }
    const c = json.choices?.[0]?.message?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : '')).join('')
    throw new ProviderError('模型服务响应中没有 choices[0].message.content')
  },
}

/** Ollama native /api/chat (local models, e.g. qwen2.5vl, llava). */
export const ollama: ChatAdapter = {
  async chat(profile, _apiKey, req) {
    const base = profile.endpoint || 'http://127.0.0.1:11434'
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      { role: 'user', content: req.prompt, ...(req.images?.length ? { images: req.images.map((i) => i.base64) } : {}) },
    ]
    const json = (await postJson(
      joinUrl(base, '/api/chat'),
      { model: profile.model, messages, stream: false, options: pickDefaults(profile.defaults) },
      {}, req.signal,
    )) as { message?: { content?: string } }
    if (typeof json.message?.content !== 'string') throw new ProviderError('Ollama 响应中没有 message.content')
    return json.message.content
  },
}

const CHAT_ADAPTERS: Partial<Record<AdapterId, ChatAdapter>> = { 'openai-compat': openaiCompat, ollama }

export function chatAdapterFor(id: AdapterId): ChatAdapter {
  const a = CHAT_ADAPTERS[id]
  if (!a) throw new ProviderError(`适配器 ${id} 暂不支持文本/视觉对话（计划在后续 beta 支持）；请使用 openai-compat 或 ollama`)
  return a
}
