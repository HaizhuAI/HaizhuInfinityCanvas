import { checkUrl } from './netguard'
import { ADAPTER_LABEL, type AdapterId } from '@hzc/core'
import { ARK_DEFAULT, DASHSCOPE_DEFAULT, ELEVENLABS_DEFAULT, KLING_DEFAULT, MINIMAX_DEFAULT, RUNWAY_DEFAULT, SILICONFLOW_DEFAULT, ZHIPU_DEFAULT } from './vendors'

/**
 * "Test connection" for a model profile. Only free, read-only requests are used — listing models
 * (OpenAI-compatible `/models`, Ollama `/api/tags`) or reading the account (Replicate) — never a
 * generation, so a test can't cost money. The model list helps the user pick a valid model ID.
 */
export type ConnTestResult =
  | { status: 'ok'; message: string; models: string[] }
  | { status: 'error'; message: string }
  | { status: 'skipped'; message: string }

const TIMEOUT_MS = 12_000
const MAX_BYTES = 2_000_000
const DEFAULT_ENDPOINT: Partial<Record<AdapterId, string>> = {
  ollama: 'http://127.0.0.1:11434', replicate: 'https://api.replicate.com/v1', fal: 'https://queue.fal.run',
  ark: ARK_DEFAULT, dashscope: DASHSCOPE_DEFAULT, kling: KLING_DEFAULT, minimax: MINIMAX_DEFAULT, runway: RUNWAY_DEFAULT,
  zhipu: ZHIPU_DEFAULT, siliconflow: SILICONFLOW_DEFAULT, elevenlabs: ELEVENLABS_DEFAULT,
}
/** an id no provider has: asking for it costs nothing and tells a bad key (401) from a good one (404) */
const NO_SUCH_TASK = '00000000-0000-0000-0000-000000000000'

async function getJson(url: string, apiKey: string | undefined, signal?: AbortSignal, headers?: Record<string, string>): Promise<{ status: number; json: unknown; text: string }> {
  await checkUrl(url) // NetGuardError is explained like any other connection failure
  const res = await fetch(url, {
    headers: headers ?? (apiKey ? { authorization: `Bearer ${apiKey}`, accept: 'application/json' } : { accept: 'application/json' }),
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
  })
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.subarray(0, MAX_BYTES).toString('utf8')
  let json: unknown
  try { json = JSON.parse(text) } catch { json = undefined }
  return { status: res.status, json, text }
}

const join = (base: string, path: string) => base.replace(/\/+$/, '') + path

function explainStatus(status: number, text: string, apiKey?: string): string {
  const safe = (apiKey ? text.split(apiKey).join('***') : text).replace(/\s+/g, ' ').slice(0, 200)
  if (status === 401 || status === 403) return `API Key 无效或没有权限（${status}）。请检查 Key 是否完整、是否属于这个服务商。`
  if (status === 404) return `没有找到（404）：接口地址可能不对，或这个服务商不提供模型列表。请确认地址和服务商文档一致（通常以 /v1 之类的版本路径结尾）；地址没问题的话，保存后运行一次节点即可验证。`
  if (status === 429) return '请求太频繁或额度不足（429）。Key 本身是有效的。'
  return `服务返回 ${status}：${safe || '（无内容）'}`
}

function explainNetwork(e: unknown): string {
  const err = e as Error & { cause?: { code?: string } }
  if (err.name === 'TimeoutError') return `连接超时（${TIMEOUT_MS / 1000} 秒）。请检查网络或接口地址；本地模型请确认它已启动。`
  const code = err.cause?.code ?? ''
  if (code === 'ECONNREFUSED') return '连接被拒绝：这个地址上没有服务在运行。本地模型（Ollama / LM Studio）请先启动它。'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '找不到这个域名。请检查接口地址的拼写和网络。'
  const detail = `${err.message} ${(err.cause as Error | undefined)?.message ?? ''}`
  if (/redirect/i.test(detail)) return '服务要求跳转到其他地址。请把接口地址改成最终地址（通常以 https:// 开头）。'
  if (/bad port/i.test(detail)) return '这个端口被安全规则禁止，请换一个端口。'
  return `无法连接：${code || (err.cause as Error | undefined)?.message || err.message}`
}

export async function testConnection(adapter: AdapterId, endpointIn: string, apiKey?: string, signal?: AbortSignal): Promise<ConnTestResult> {
  const endpoint = (endpointIn || DEFAULT_ENDPOINT[adapter] || '').trim()
  if (adapter === 'fal') return { status: 'skipped', message: 'fal.ai 没有免费的连接测试接口。保存后运行一次节点即可验证（会按次计费）。' }
  const native = adapter in NATIVE_TESTS
  if (!['openai-compat', 'ollama', 'replicate'].includes(adapter) && !native) return { status: 'skipped', message: `适配器 ${adapter} 暂不支持连接测试。` }
  if (!/^https?:\/\//i.test(endpoint)) return { status: 'error', message: '接口地址需要以 http:// 或 https:// 开头。' }
  if (adapter === 'replicate' && !apiKey) return { status: 'error', message: 'Replicate 需要 API Token。' }
  if (native && !apiKey) return { status: 'error', message: `${ADAPTER_LABEL[adapter]} 需要 API Key。` }
  try {
    if (native) return await NATIVE_TESTS[adapter]!(endpoint.replace(/\/+$/, ''), apiKey!, signal)
    if (adapter === 'ollama') {
      const r = await getJson(join(endpoint, '/api/tags'), undefined, signal)
      if (r.status !== 200) return { status: 'error', message: explainStatus(r.status, r.text) }
      const models = ((r.json as { models?: { name?: string }[] })?.models ?? []).map((m) => String(m.name ?? '')).filter(Boolean)
      return { status: 'ok', message: models.length ? `已连接 Ollama，本机有 ${models.length} 个模型。` : '已连接 Ollama，但本机还没有下载模型（ollama pull 模型名）。', models }
    }
    if (adapter === 'replicate') {
      const r = await getJson(join(endpoint, '/account'), apiKey, signal)
      if (r.status !== 200) return { status: 'error', message: explainStatus(r.status, r.text, apiKey) }
      const user = (r.json as { username?: string })?.username
      return { status: 'ok', message: `Token 有效${user ? `（账号 ${user}）` : ''}。模型 ID 请填 Replicate 上的「所有者/模型名」。`, models: [] }
    }
    const r = await getJson(join(endpoint, '/models'), apiKey, signal)
    if (r.status !== 200) return { status: 'error', message: explainStatus(r.status, r.text, apiKey) }
    const data = (r.json as { data?: { id?: string }[] })?.data
    const models = Array.isArray(data) ? data.map((m) => String(m?.id ?? '')).filter(Boolean).sort() : []
    return { status: 'ok', message: models.length ? `连接成功，可用模型 ${models.length} 个。` : '连接成功。这个服务没有返回模型列表，模型 ID 请按服务商文档填写。', models: models.slice(0, 500) }
  } catch (e) {
    if (signal?.aborted) throw e
    return { status: 'error', message: explainNetwork(e) }
  }
}

/* ------------------------------------------------------------------ provider-native adapters */

type NativeTest = (base: string, apiKey: string, signal?: AbortSignal) => Promise<ConnTestResult>

/** the key works when the service answers anything but 401 / 403 to a read of something that doesn't exist */
function keyAccepted(name: string, r: { status: number; text: string }, apiKey: string, hint = ''): ConnTestResult {
  if (r.status === 401 || r.status === 403) return { status: 'error', message: explainStatus(r.status, r.text, apiKey) }
  if (r.status >= 500) return { status: 'error', message: explainStatus(r.status, r.text, apiKey) }
  return { status: 'ok', message: `${name} 已接受这个 Key。${hint}`, models: [] }
}

const MODEL_HINT = '模型 ID 请按服务商文档填写，或点下方的常用模型。'

const NATIVE_TESTS: Partial<Record<AdapterId, NativeTest>> = {
  // list one task (free)
  ark: async (b, k, s) => keyAccepted('火山方舟', await getJson(`${b}/contents/generations/tasks?page_num=1&page_size=1`, k, s), k, MODEL_HINT),
  dashscope: async (b, k, s) => keyAccepted('阿里云百炼', await getJson(`${b}/api/v1/tasks/${NO_SUCH_TASK}`, k, s), k, MODEL_HINT),
  kling: async (b, k, s) => {
    const r = await getJson(`${b}/v1/images/generations?pageNum=1&pageSize=1`, k, s)
    const code = (r.json as { code?: number } | undefined)?.code
    if (r.status === 200 && code !== undefined && code !== 0) return { status: 'error', message: `可灵返回错误 ${code}：${String((r.json as { message?: string }).message ?? '').slice(0, 120)}` }
    return keyAccepted('可灵', r, k, MODEL_HINT)
  },
  minimax: async (b, k, s) => {
    const r = await getJson(`${b}/v1/query/video_generation?task_id=0`, k, s)
    const code = (r.json as { base_resp?: { status_code?: number; status_msg?: string } } | undefined)?.base_resp?.status_code
    if (code === 1004 || code === 2049) return { status: 'error', message: `API Key 无效（MiniMax ${code}）。国内账号请用 api.minimax.cn，国际账号用 api.minimax.io。` }
    return keyAccepted('MiniMax', r, k, MODEL_HINT)
  },
  runway: async (b, k, s) => keyAccepted('Runway', await getJson(`${b}/v1/tasks/${NO_SUCH_TASK}`, k, s, { authorization: `Bearer ${k}`, 'X-Runway-Version': '2024-11-06', accept: 'application/json' }), k, MODEL_HINT),
  zhipu: async (b, k, s) => keyAccepted('智谱', await getJson(`${b}/async-result/${NO_SUCH_TASK}`, k, s), k, MODEL_HINT),
  siliconflow: async (b, k, s) => {
    const r = await getJson(`${b}/models?type=video`, k, s)
    if (r.status !== 200) return { status: 'error', message: explainStatus(r.status, r.text, k) }
    const data = (r.json as { data?: { id?: string }[] } | undefined)?.data
    const models = Array.isArray(data) ? data.map((m) => String(m?.id ?? '')).filter(Boolean).sort() : []
    return { status: 'ok', message: models.length ? `连接成功，可用视频模型 ${models.length} 个。` : '连接成功。', models }
  },
  elevenlabs: async (b, k, s) => {
    const r = await getJson(`${b}/v1/models`, k, s, { 'xi-api-key': k, accept: 'application/json' })
    if (r.status !== 200) return { status: 'error', message: explainStatus(r.status, r.text, k) }
    const list = Array.isArray(r.json) ? (r.json as { model_id?: string; can_do_text_to_speech?: boolean }[]) : []
    const models = list.filter((m) => m && m.can_do_text_to_speech !== false).map((m) => String(m.model_id ?? '')).filter(Boolean)
    return { status: 'ok', message: `连接成功，可用语音模型 ${models.length} 个。音色在节点里填 voice_id（ElevenLabs → Voices 里复制）。`, models }
  },
}
