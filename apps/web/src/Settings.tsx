import { useEffect, useRef, useState } from 'react'
import { Boxes, ChevronRight, CircleUser, LogOut, MonitorSmartphone, Palette, CircleAlert, CircleCheck, Clapperboard, Cpu, ExternalLink, Download, FileArchive, FileUp, Info, KeyRound, LoaderCircle, Pencil, PlugZap, Plus, RefreshCw, ScanSearch, Trash, X } from 'lucide-react'
import { ADAPTERS, MODEL_KINDS, type AdapterId, type ModelKind, type ModelProfileInput, type ModelProfilePublic } from '@hzc/core'
import { api, auth, getToken, setToken, type ConnTest, type SkillKind, type SkillMeta } from './api'
import { useEscape } from './Overlays'
import { KIND_COLOR, KIND_ICON, KIND_LABEL } from './icons'
import { enterOverlay, motionEnabled, setMotionEnabled } from './motion'
import { setThemePref, themePref, type ThemePref } from './theme'
import { useStore, type SettingsTab } from './store'

type Tab = SettingsTab
type FormState = Omit<ModelProfileInput, 'defaults' | 'cost'> & { id?: string; defaultsText: string; costAmount: string; costCurrency: string }

/** Providers with their published OpenAI-compatible (or native) endpoints. Model IDs come from the
 *  provider's list (测试连接) or its docs. `keyUrl` is where the user creates a key. */
const PRESETS: { id: string; label: string; adapter: AdapterId; endpoint: string; kinds: ModelKind[]; keyUrl?: string; local?: boolean }[] = [
  { id: 'openai', label: 'OpenAI', adapter: 'openai-compat', endpoint: 'https://api.openai.com/v1', kinds: ['llm', 'vlm', 'image', 'tts'], keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'dashscope', label: '阿里云百炼（通义）', adapter: 'openai-compat', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', kinds: ['llm', 'vlm'], keyUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'ark', label: '火山方舟（豆包）', adapter: 'openai-compat', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', kinds: ['llm', 'vlm'], keyUrl: 'https://console.volcengine.com/ark' },
  { id: 'deepseek', label: 'DeepSeek', adapter: 'openai-compat', endpoint: 'https://api.deepseek.com/v1', kinds: ['llm'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'openrouter', label: 'OpenRouter', adapter: 'openai-compat', endpoint: 'https://openrouter.ai/api/v1', kinds: ['llm', 'vlm'], keyUrl: 'https://openrouter.ai/keys' },
  { id: 'replicate', label: 'Replicate', adapter: 'replicate', endpoint: 'https://api.replicate.com/v1', kinds: ['image', 'video', 'tts'], keyUrl: 'https://replicate.com/account/api-tokens' },
  { id: 'fal', label: 'fal.ai', adapter: 'fal', endpoint: 'https://queue.fal.run', kinds: ['image', 'video', 'tts'], keyUrl: 'https://fal.ai/dashboard/keys' },
  { id: 'ollama', label: 'Ollama（本机）', adapter: 'ollama', endpoint: 'http://127.0.0.1:11434', kinds: ['llm', 'vlm'], local: true },
  { id: 'lmstudio', label: 'LM Studio（本机）', adapter: 'openai-compat', endpoint: 'http://127.0.0.1:1234/v1', kinds: ['llm', 'vlm'], local: true },
  { id: 'kokoro', label: 'Kokoro / 本机 TTS', adapter: 'openai-compat', endpoint: 'http://127.0.0.1:8880/v1', kinds: ['tts'], local: true },
]
const presetOf = (f: { adapter: string; endpoint: string }) => PRESETS.find((p) => p.adapter === f.adapter && p.endpoint === f.endpoint.replace(/\/+$/, ''))

const blank = (kind: ModelKind = 'llm'): FormState => ({ name: '', kind, adapter: 'openai-compat', endpoint: '', model: '', apiKey: '', defaultsText: '{}', costAmount: '', costCurrency: 'CNY' })

type TestState = { status: 'idle' | 'busy' } | ConnTest

function ProfileForm({ initial, onDone }: { initial: FormState; onDone: (created?: ModelProfilePublic) => void }) {
  const { loadProfiles, showToast } = useStore()
  const [form, setForm] = useState<FormState>(initial)
  const [err, setErr] = useState('')
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const preset = presetOf(form)
  const [advanced, setAdvanced] = useState(!!initial.id && !presetOf(initial))
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))
  useEscape(() => onDone())
  const presets = PRESETS.filter((p) => p.kinds.includes(form.kind))

  function choosePreset(p: (typeof PRESETS)[number] | null) {
    setTest({ status: 'idle' })
    if (!p) { setAdvanced(true); set({ adapter: 'openai-compat', endpoint: '' }); return }
    const autoName = !form.name || PRESETS.some((x) => form.name.startsWith(x.label))
    set({ adapter: p.adapter, endpoint: p.endpoint, name: autoName ? `${p.label} · ${KIND_LABEL[form.kind]}` : form.name })
  }

  async function runTest() {
    setTest({ status: 'busy' })
    try {
      setTest(await api.testProfile({ adapter: form.adapter, endpoint: form.endpoint, apiKey: form.apiKey || undefined, profileId: form.id }))
    } catch (e) { setTest({ status: 'error', message: (e as Error).message }) }
  }

  async function submit() {
    setErr('')
    let defaults: Record<string, unknown>
    try {
      const parsed = JSON.parse(form.defaultsText || '{}') as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
      defaults = parsed as Record<string, unknown>
    } catch { setAdvanced(true); setErr('高级设置里的默认参数必须是 JSON 对象，例如 {"temperature": 0.7}'); return }
    let cost: ModelProfileInput['cost'] = null
    if (form.costAmount.trim()) {
      const amount = Number(form.costAmount)
      if (!Number.isFinite(amount) || amount < 0) { setErr('单次费用必须是不小于 0 的数字'); return }
      cost = { amount, currency: form.costCurrency }
    }
    const { id, defaultsText: _d, costAmount: _a, costCurrency: _c, ...rest } = form
    const input: ModelProfileInput = { ...rest, defaults, cost }
    if (!id && !input.apiKey) delete input.apiKey // create without key
    try {
      const saved = id ? await api.updateProfile(id, input) : await api.createProfile(input)
      await loadProfiles()
      if (id) showToast('模型档案已更新')
      onDone(id ? undefined : saved)
    } catch (e) { setErr((e as Error).message) }
  }

  const models = test.status === 'ok' ? test.models : []
  const q = form.model.trim().toLowerCase()
  const suggestions = models.filter((m) => !q || m.toLowerCase().includes(q)).slice(0, 10)

  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <div>
        <h3>{form.id ? '编辑模型档案' : '添加模型'}</h3>
        <div className="muted">选好类型和服务商，填上模型和 Key 即可。保存后它会出现在左侧「我的模型」里。</div>
      </div>

      <div className="field"><span>类型</span>
        <div className="seg" role="radiogroup" aria-label="类型">
          {MODEL_KINDS.map((k) => {
            const Icon = KIND_ICON[k]
            return (
              <button type="button" key={k} role="radio" aria-checked={form.kind === k} className={form.kind === k ? 'on' : ''}
                style={{ '--c': KIND_COLOR[k] } as React.CSSProperties} onClick={() => set({ kind: k })} data-testid={`kind-${k}`}>
                <Icon />{KIND_LABEL[k]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="field"><span>服务商</span>
        <div className="pchips" role="radiogroup" aria-label="服务商">
          {presets.map((p) => (
            <button type="button" key={p.id} role="radio" aria-checked={preset?.id === p.id} className={`pchip${preset?.id === p.id ? ' on' : ''}`} onClick={() => choosePreset(p)} data-testid={`preset-${p.id}`}>
              {p.label}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={!preset} className={`pchip${!preset ? ' on' : ''}`} onClick={() => choosePreset(null)} data-testid="preset-custom">其他（自定义地址）</button>
        </div>
      </div>

      <div className="row2">
        <label className="field"><span>名称</span>
          <input required value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="如：通义视觉、Kling 视频" data-testid="pf-name" />
        </label>
        <label className="field"><span>模型 ID</span>
          <input required value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder={models.length ? '从下方列表选择，或输入' : '按服务商文档填写，或先测试连接获取列表'} list="pf-models" data-testid="pf-model" />
          <datalist id="pf-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
      </div>

      <label className="field"><span>API Key{preset?.keyUrl && <a className="link inline" href={preset.keyUrl} target="_blank" rel="noreferrer">获取 Key<ExternalLink aria-hidden="true" /></a>}</span>
        <input type="password" autoComplete="off" value={form.apiKey ?? ''} onChange={(e) => { set({ apiKey: e.target.value }); setTest({ status: 'idle' }) }}
          placeholder={form.id ? '留空 = 保持不变' : preset?.local ? '本机模型不需要 Key' : '粘贴服务商提供的 Key'} data-testid="pf-key" />
        <span className="help">只保存在本机（加密），不会再回传到浏览器。</span>
      </label>

      <div className="test-row">
        <button type="button" className="btn sm" onClick={() => void runTest()} disabled={test.status === 'busy' || !form.adapter} data-testid="pf-test">
          {test.status === 'busy' ? <LoaderCircle className="spin" /> : <PlugZap />}测试连接
        </button>
        {test.status === 'ok' && <span className="test-msg ok" data-testid="pf-test-result"><CircleCheck aria-hidden="true" />{test.message}</span>}
        {test.status === 'error' && <span className="test-msg bad" data-testid="pf-test-result"><CircleAlert aria-hidden="true" />{test.message}</span>}
        {test.status === 'skipped' && <span className="test-msg" data-testid="pf-test-result"><Info aria-hidden="true" />{test.message}</span>}
        {test.status === 'idle' && <span className="test-msg">只读取模型列表或账号信息，不会产生费用。</span>}
      </div>
      {suggestions.length > 0 && (
        <div className="pchips models" aria-label="可用模型">
          {suggestions.map((m) => <button type="button" key={m} className={`pchip mono${form.model === m ? ' on' : ''}`} onClick={() => set({ model: m })} data-testid="pf-model-chip">{m}</button>)}
          {models.length > suggestions.length && <span className="more">共 {models.length} 个，输入关键字筛选</span>}
        </div>
      )}

      <div className="row2">
        <label className="field"><span>单次调用费用（可选）</span>
          <input inputMode="decimal" value={form.costAmount} onChange={(e) => set({ costAmount: e.target.value })} placeholder="如 0.3" data-testid="pf-cost" />
        </label>
        <label className="field"><span>币种</span>
          <select value={form.costCurrency} onChange={(e) => set({ costCurrency: e.target.value })}>
            <option value="CNY">人民币 CNY</option><option value="USD">美元 USD</option>
          </select>
        </label>
      </div>
      <span className="help" style={{ marginTop: -8 }}>运行前用它估算费用。按你在服务商处的实际价格填写；不填则只提示调用次数。</span>

      <div className="advanced">
        <button type="button" className="adv-toggle" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)} data-testid="pf-advanced">
          <ChevronRight aria-hidden="true" />高级设置<span className="muted">{form.adapter}{form.endpoint ? ` · ${form.endpoint}` : ''}</span>
        </button>
        {advanced && (
          <div className="adv-body">
            <div className="row2">
              <label className="field"><span>适配器</span>
                <select value={form.adapter} onChange={(e) => { set({ adapter: e.target.value as AdapterId }); setTest({ status: 'idle' }) }} data-testid="pf-adapter">
                  {ADAPTERS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label className="field"><span>接口地址</span>
                <input value={form.endpoint} onChange={(e) => { set({ endpoint: e.target.value }); setTest({ status: 'idle' }) }} placeholder="https://…/v1" data-testid="pf-endpoint" />
              </label>
            </div>
            {(() => {
              // 同时运行 lives in the defaults JSON as _concurrency (a canvas setting, never sent to the provider)
              let obj: Record<string, unknown> | null = null
              try { const v = JSON.parse(form.defaultsText || '{}') as unknown; if (v && typeof v === 'object' && !Array.isArray(v)) obj = v as Record<string, unknown> } catch { /* invalid JSON: edit it below */ }
              const cur = obj && typeof obj._concurrency === 'number' ? String(obj._concurrency) : ''
              const local = form.adapter === 'ollama'
              return (
                <label className="field"><span>同时运行</span>
                  <select value={cur} disabled={!obj} data-testid="pf-concurrency"
                    onChange={(e) => { const next = { ...obj! }; if (e.target.value) next._concurrency = Number(e.target.value); else delete next._concurrency; set({ defaultsText: JSON.stringify(next, null, 2) }) }}>
                    <option value="">自动（{local ? '本机模型一次 1 个' : '最多 3 个'}）</option>
                    {[1, 2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n === 1 ? '一次 1 个（逐个运行）' : `最多 ${n} 个`}</option>)}
                  </select>
                  <span className="help">画布上互不依赖的节点会同时运行（例如分镜的各个镜头）。服务商提示请求过于频繁（429）时调小；{local ? '本机显卡通常一次只能跑一个任务。' : '额度充足时可以调大。'}所有模型合计最多同时 {useStore.getState().maxParallel} 个。</span>
                </label>
              )
            })()}
            <label className="field"><span>默认参数（JSON，可选）</span>
              <textarea value={form.defaultsText} onChange={(e) => set({ defaultsText: e.target.value })} spellCheck={false} data-testid="pf-defaults" />
              <span className="help">
                会合并进每次请求，例如 {'{"temperature": 0.7}'}。以 _ 开头的键是适配器配置、不会发给服务商：
                {' '}<code>_fields</code> 映射输入字段名（如 {'{"_fields": {"image": "input_image", "first": "start_image"}}'}），
                {' '}<code>_timeoutSec</code> 设置最长等待秒数，<code>_concurrency</code> 即上面的「同时运行」。
              </span>
            </label>
          </div>
        )}
      </div>

      {err && <div className="form-err" role="alert">{err}</div>}
      <div className="form-actions">
        <button type="submit" className="btn primary" data-testid="pf-save">保存</button>
        <button type="button" className="btn" onClick={() => onDone()}>取消</button>
      </div>
    </form>
  )
}

function ProfilesPane({ addKind }: { addKind?: ModelKind }) {
  const { profiles, loadProfiles, bindUnbound, showToast, settingsIntent, setSettingsOpen } = useStore()
  const [form, setForm] = useState<FormState | null>(addKind ? blank(addKind) : null)
  const done = (created?: ModelProfilePublic) => {
    setForm(null)
    if (!created) return
    // put the new model to work: nodes of its kind that have none (or a deleted one) now use it
    const n = bindUnbound(created.kind, created.id)
    showToast(n ? `已添加「${created.name}」，画布上 ${n} 个节点已选用它` : `已添加「${created.name}」，可以从左侧拖入画布`)
    if (settingsIntent?.addKind) setSettingsOpen(false) // opened from a node or the pre-run check: go back there
  }
  if (form) return <ProfileForm initial={form} onDone={done} />

  async function remove(p: ModelProfilePublic) {
    if (!confirm(`删除模型档案「${p.name}」？画布上绑定它的节点会提示缺失。`)) return
    await api.deleteProfile(p.id)
    await loadProfiles()
  }

  return (
    <>
      <h3>模型档案</h3>
      <p className="muted">每个档案对应一个可拖入画布的模型智能体。所有模型请求都由本机服务端发出。</p>
      <div className="pcard-list">
        {profiles.map((p) => {
          const Icon = KIND_ICON[p.kind]
          return (
            <div className="pcard" key={p.id} data-testid={`pcard-${p.name}`}>
              <span className="chip-ico" style={{ '--c': KIND_COLOR[p.kind] } as React.CSSProperties}><Icon /></span>
              <div className="txt">
                <div className="nm">{p.name}</div>
                <div className="ds">{KIND_LABEL[p.kind]} · {p.adapter} · {p.model}{p.cost ? ` · ${p.cost.currency === 'CNY' ? '¥' : p.cost.currency === 'USD' ? '$' : p.cost.currency + ' '}${p.cost.amount}/次` : ''}</div>
              </div>
              <span className={`tag${p.hasKey ? ' ok' : ''}`} data-testid="pcard-key">{p.hasKey ? '已设置 Key' : '无 Key'}</span>
              <button className="btn sm icon ghost" title="编辑" aria-label={`编辑 ${p.name}`}
                onClick={() => setForm({ id: p.id, name: p.name, kind: p.kind, adapter: p.adapter, endpoint: p.endpoint, model: p.model, apiKey: undefined, defaultsText: JSON.stringify(p.defaults ?? {}, null, 2), costAmount: p.cost ? String(p.cost.amount) : '', costCurrency: p.cost?.currency ?? 'CNY' })}><Pencil /></button>
              <button className="btn sm icon ghost" title="删除" aria-label={`删除 ${p.name}`} onClick={() => void remove(p)}><Trash /></button>
            </div>
          )
        })}
        {profiles.length === 0 && <div className="sb-empty">还没有模型档案</div>}
      </div>
      <button className="btn primary" onClick={() => setForm(blank())} data-testid="add-profile"><Plus />添加模型</button>
    </>
  )
}

function AccessPane() {
  const { showToast, loadProfiles } = useStore()
  const [token, setTok] = useState(getToken())
  return (
    <div className="form">
      <div>
        <h3>访问口令</h3>
        <div className="muted">仅在把 WebUI 部署到局域网或服务器（设置了 HZC_TOKEN）时需要。桌面版会自动处理。</div>
      </div>
      <label className="field"><span>口令</span>
        <input type="password" placeholder="HZC_TOKEN" value={token} onChange={(e) => setTok(e.target.value)} />
      </label>
      <div className="form-actions">
        <button className="btn primary" onClick={() => { setToken(token); showToast('口令已保存到本浏览器'); void loadProfiles() }}>保存</button>
      </div>
    </div>
  )
}

const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${Math.ceil(Math.max(0, n) / 1024)} KB`)

/** Accounts mode: who is signed in, storage, password, sign out, delete the account. */
function AccountPane() {
  const account = useStore((s) => s.account)
  const showToast = useStore((s) => s.showToast)
  const [storage, setStorage] = useState<{ used: number; quota?: number } | null>(null)
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState<'' | 'pw' | 'others' | 'out' | 'delete'>('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [delPw, setDelPw] = useState('')
  const [delTyped, setDelTyped] = useState('')
  const [delErr, setDelErr] = useState('')
  useEffect(() => { void api.system().then((s) => setStorage(s.storage ?? null)).catch(() => undefined) }, [])
  const pct = storage?.quota ? Math.min(100, Math.round((storage.used / storage.quota) * 100)) : 0

  async function changePw() {
    setBusy('pw'); setPwMsg(null)
    try { await auth.changePassword(cur, next); setCur(''); setNext(''); setPwMsg({ ok: true, text: '密码已修改，其他设备已退出登录' }) }
    catch (e) { setPwMsg({ ok: false, text: (e as Error).message }) }
    finally { setBusy('') }
  }
  async function signOut() {
    setBusy('out')
    useStore.getState().keepDraft() // unsaved edits stay in this browser for next time
    try { await auth.logout() } finally { location.replace('/welcome') }
  }
  async function deleteAccount() {
    setBusy('delete'); setDelErr('')
    try { await auth.deleteAccount(delPw); location.replace('/welcome') }
    catch (e) { setDelErr((e as Error).message); setBusy('') }
  }
  return (
    <div className="form" data-testid="account-pane">
      <div>
        <h3>账号</h3>
        <div className="muted">{account ? <>已登录 <b data-testid="account-email">{account.email}</b> · 注册于 {new Date(account.createdAt).toLocaleDateString('zh-CN')}</> : '读取中…'}</div>
      </div>
      {storage && (
        <div className="field"><span>存储空间（素材与生成结果）</span>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="已用存储空间" style={{ '--p': `${pct}%`, '--c': pct > 90 ? 'var(--danger)' : pct > 75 ? 'var(--warn)' : 'var(--accent)' } as React.CSSProperties}><span /></div>
          <span className="help" data-testid="account-storage">已用 {mb(storage.used)}{storage.quota ? ` / ${mb(storage.quota)}` : ''}。空间不够时，在左侧「素材库」里删除不用的文件。</span>
        </div>
      )}
      <div className="field"><span>修改密码</span>
        <div className="row2">
          <input type="password" autoComplete="current-password" placeholder="当前密码" value={cur} onChange={(e) => setCur(e.target.value)} aria-label="当前密码" />
          <input type="password" autoComplete="new-password" placeholder="新密码（至少 8 位）" value={next} onChange={(e) => setNext(e.target.value)} aria-label="新密码" />
        </div>
        {pwMsg && <span className={pwMsg.ok ? 'help ok' : 'warn'} role="status">{pwMsg.text}</span>}
      </div>
      <div className="form-actions">
        <button className="btn primary" disabled={!cur || !next || busy !== ''} onClick={() => void changePw()}>修改密码</button>
        <button className="btn" disabled={busy !== ''} onClick={() => { setBusy('others'); void auth.logoutOthers().then(() => showToast('其他设备已退出登录')).catch((e) => showToast((e as Error).message, { tone: 'error' })).finally(() => setBusy('')) }}><MonitorSmartphone />退出其他设备</button>
        <button className="btn" disabled={busy !== ''} onClick={() => void signOut()} data-testid="sign-out"><LogOut />退出登录</button>
      </div>
      <details className="danger-zone">
        <summary>删除账号</summary>
        <p className="help">会永久删除你的全部画布、模型档案（含 API Key）、素材、生成记录和备份，无法恢复。需要保留的画布请先在「我的画布」里导出项目包。</p>
        <div className="row2">
          <input type="password" autoComplete="current-password" placeholder="密码" value={delPw} onChange={(e) => setDelPw(e.target.value)} aria-label="确认密码" />
          <input placeholder="输入「删除」确认" value={delTyped} onChange={(e) => setDelTyped(e.target.value)} aria-label="输入删除确认" />
        </div>
        {delErr && <span className="warn" role="alert">{delErr}</span>}
        <div className="form-actions"><button className="btn danger" disabled={!delPw || delTyped.trim() !== '删除' || busy !== ''} onClick={() => void deleteAccount()}>永久删除账号</button></div>
      </details>
    </div>
  )
}

const SKILL_TEMPLATE = `---
name: my-director
description: 我的导演风格。说明它做什么、什么时候用。
metadata:
  hzc-kind: director
  hzc-label: 我的导演
---

# 我的导演

在这里写给模型的导演指令：镜头结构、景别与运镜偏好、角色一致性要求、提示词写法……
`

const KIND_NAME: Record<SkillKind, string> = { 'image-reverse': '图片反推', director: '导演分镜' }

function SkillsPane() {
  const { skills, loadSkills, showToast } = useStore()
  const [importing, setImporting] = useState(false)
  const [text, setText] = useState(SKILL_TEMPLATE)
  const [err, setErr] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<SkillKind | ''>('')
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)

  const done = async (s: SkillMeta) => {
    await loadSkills()
    const bits = [s.kind ? KIND_NAME[s.kind] : '用途未定', s.license, s.references.length ? `${s.references.length} 份参考文件` : ''].filter(Boolean)
    showToast(`已导入「${s.label}」（${bits.join(' · ')}）`)
  }
  async function attempt(key: string, fn: () => Promise<SkillMeta>) {
    setErr(''); setBusy(key)
    try { await done(await fn()); return true } catch (e) { setErr((e as Error).message); return false } finally { setBusy(null) }
  }

  async function save() {
    if (await attempt('paste', () => api.importSkill(text, kind || undefined))) { setImporting(false); setText(SKILL_TEMPLATE) }
  }

  async function remove(s: SkillMeta) {
    const uses = s.kind === 'image-reverse' ? '用它的反推节点' : '用它的导演节点'
    if (!confirm(`删除 Skill「${s.label}」？${uses}会提示找不到 Skill。`)) return
    try { await api.deleteSkill(s.name); await loadSkills() } catch (e) { showToast((e as Error).message) }
  }

  if (importing) return (
    <div className="form import-box">
      <div>
        <h3>粘贴 SKILL.md</h3>
        <div className="muted">粘贴一个 SKILL.md（Agent Skills 开放格式），或选择文件。带参考文件的 Skill 请用 GitHub 链接或压缩包导入。</div>
      </div>
      <input ref={fileRef} type="file" accept=".md,text/markdown,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} />
      <div><button className="btn" onClick={() => fileRef.current?.click()}><FileUp />选择 SKILL.md 文件</button></div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="skill-text" />
      {err && <div className="form-err" role="alert">{err}</div>}
      <div className="form-actions">
        <button className="btn primary" disabled={!!busy} onClick={() => void save()} data-testid="skill-save">导入</button>
        <button className="btn" onClick={() => { setImporting(false); setErr('') }}>取消</button>
      </div>
    </div>
  )

  const groups: [string, SkillMeta[]][] = [
    ['图片反推 Skill', skills.filter((s) => s.kind === 'image-reverse')],
    ['导演 Skill', skills.filter((s) => s.kind === 'director')],
    ['其他 Skill', skills.filter((s) => !s.kind)],
  ]
  return (
    <>
      <h3>Skill</h3>
      <p className="muted">Skill 是给模型的一套专业指令（Agent Skills 开放格式，SKILL.md + 参考文件）。图片反推节点可以用它把参考图反推成提示词，导演节点用它把创意拆成分镜。只使用其中的文字说明，不会执行或保存任何脚本。</p>

      <div className="skill-import" data-testid="skill-import">
        <div className="si-row">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="GitHub 链接，例如 https://github.com/作者/仓库" aria-label="Skill 的 GitHub 链接" data-testid="skill-url"
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) void attempt('url', () => api.importSkillUrl(url.trim(), kind || undefined)).then((ok) => ok && setUrl('')) }} />
          <select value={kind} onChange={(e) => setKind(e.target.value as SkillKind | '')} aria-label="用途" data-testid="skill-kind">
            <option value="">用途：自动判断</option><option value="image-reverse">用于图片反推</option><option value="director">用于导演分镜</option>
          </select>
          <button className="btn primary" disabled={!url.trim() || !!busy} data-testid="skill-url-import"
            onClick={() => void attempt('url', () => api.importSkillUrl(url.trim(), kind || undefined)).then((ok) => ok && setUrl(''))}>
            {busy === 'url' ? <LoaderCircle className="spin" /> : <Download />}从 GitHub 导入
          </button>
        </div>
        <div className="si-row">
          <input ref={zipRef} type="file" accept=".zip,application/zip" hidden data-testid="skill-zip-input"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attempt('zip', () => api.importSkillZip(f, kind || undefined)) }} />
          <button className="btn" disabled={!!busy} onClick={() => zipRef.current?.click()} data-testid="skill-zip">{busy === 'zip' ? <LoaderCircle className="spin" /> : <FileArchive />}上传压缩包（.zip）</button>
          <button className="btn" onClick={() => { setImporting(true); setErr('') }} data-testid="import-skill"><Plus />粘贴 SKILL.md</button>
          <span className="muted si-hint">连不上 GitHub 时：在仓库页面点 Code → Download ZIP，再上传。</span>
        </div>
        {err && <div className="form-err" role="alert" data-testid="skill-error">{err}</div>}
        <div className="hint"><Info aria-hidden="true" /><span>导入的 Skill 来自它的作者，遵循作者的许可证（显示在卡片上，例如 GPL-3.0）。它只保存在你这台电脑上，海柱不会把它打包或再分发。</span></div>
      </div>

      {groups.map(([title, list]) => list.length > 0 && (
        <section key={title} className="skill-group">
          <h4>{title}</h4>
          <div className="pcard-list">
            {list.map((s) => (
              <div className="pcard" key={s.name} data-testid={`skill-${s.name}`}>
                <span className="chip-ico" style={{ '--c': 'var(--c-tool)' } as React.CSSProperties}>{s.kind === 'image-reverse' ? <ScanSearch /> : <Clapperboard />}</span>
                <div className="txt">
                  <div className="nm">{s.label} <span className="muted skill-src">{s.name}</span></div>
                  <div className="ds" title={s.description}>{s.description}</div>
                  <div className="pmeta">
                    {s.license && <span className="lic" title="这个 Skill 的许可证">{s.license}</span>}
                    {s.references.length > 0 && <span>{s.references.length} 份参考文件</span>}
                    {s.sourceUrl && <a href={s.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />来源</a>}
                  </div>
                </div>
                {s.source === 'user' ? (
                  <select className="kind-pick" value={s.kind ?? ''} aria-label={`${s.label} 的用途`} data-testid={`skill-kind-${s.name}`}
                    onChange={(e) => { const k = e.target.value as SkillKind; if (k) void api.setSkillKind(s.name, k).then(() => loadSkills(), (er: Error) => showToast(er.message)) }}>
                    {!s.kind && <option value="">选择用途…</option>}
                    <option value="image-reverse">图片反推</option><option value="director">导演分镜</option>
                  </select>
                ) : <span className="tag ok">内置</span>}
                {s.sourceUrl && (
                  <button className="btn sm icon ghost" title="从 GitHub 重新导入最新版" aria-label={`更新 ${s.label}`} disabled={!!busy} data-testid={`skill-update-${s.name}`}
                    onClick={() => void attempt(`up:${s.name}`, () => api.importSkillUrl(s.sourceUrl!, s.kind))}>
                    {busy === `up:${s.name}` ? <LoaderCircle className="spin" /> : <RefreshCw />}
                  </button>
                )}
                {s.source === 'user' && <button className="btn sm icon ghost" title="删除" aria-label={`删除 ${s.name}`} onClick={() => void remove(s)}><Trash /></button>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function AppearancePane() {
  const [on, setOn] = useState(motionEnabled())
  const [theme, setTheme] = useState<ThemePref>(themePref())
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return (
    <div className="form">
      <div>
        <h3>外观与动效</h3>
        <div className="muted">界面用不带色偏的石墨灰，画布上唯一的颜色来自你的图片和视频。</div>
      </div>
      <div className="field"><span>主题</span>
        <div className="seg2" role="radiogroup" aria-label="主题" style={{ maxWidth: 320 }}>
          {([['system', '跟随系统'], ['dark', '深色'], ['light', '浅色']] as [ThemePref, string][]).map(([v, l]) => (
            <button key={v} role="radio" aria-checked={theme === v} className={theme === v ? 'on' : ''} onClick={() => { setThemePref(v); setTheme(v) }} data-testid={`theme-${v}`}>{l}</button>
          ))}
        </div>
      </div>
      <label className="switch">
        <input type="checkbox" checked={on} disabled={reduced} onChange={(e) => { setMotionEnabled(e.target.checked); setOn(motionEnabled()) }} data-testid="motion-switch" />
        <span className="track"><span className="knob" /></span>
        <span>界面动效</span>
      </label>
      {reduced && <div className="hint"><Info aria-hidden="true" />系统开启了「减少动态效果」，动效已自动关闭。</div>}
    </div>
  )
}

function AboutPane() {
  const [sys, setSys] = useState<Awaited<ReturnType<typeof api.system>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [backing, setBacking] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const load = (refresh = false) => { setBusy(true); void api.system(refresh).then(setSys).catch(() => setSys(null)).finally(() => setBusy(false)) }
  useEffect(() => { load() }, [])
  const backupNow = () => {
    setBacking('busy')
    void api.backupNow().then(() => { setBacking('done'); load() }).catch(() => setBacking('error'))
  }
  const f = sys?.ffmpeg
  const b = sys?.backups
  const r = sys?.recovery
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
  return (
    <div className="form">
      <div>
        <h3>Haizhu Infinity Canvas</h3>
        <div className="muted">面向图像与视频创作者的无限画布。当前版本 v1.0.0-rc.11。</div>
      </div>
      <div className="field"><span>FFmpeg（视频镜头反推、导出成片需要）</span>
        <div className="status-line" data-testid="ffmpeg-status" style={{ '--c': f?.ok ? 'var(--ok)' : 'var(--warn)' } as React.CSSProperties}>
          <span className="dot" aria-hidden="true" />
          {sys == null ? '检测中…' : f?.ok ? `已就绪 · ${f.version ?? ''}${f.h264 ? ' · H.264' : ' · 无 H.264 编码器'}` : '未找到'}
          <button className="btn xs" disabled={busy} onClick={() => load(true)}>重新检测</button>
        </div>
        {sys && !f?.ok && (
          <span className="help">
            安装后重启应用即可：Windows <code>winget install ffmpeg</code>，macOS <code>brew install ffmpeg</code>，Ubuntu/Debian <code>sudo apt install ffmpeg</code>。
            也可以用环境变量 <code>HZC_FFMPEG</code> / <code>HZC_FFPROBE</code> 指定可执行文件路径。
          </span>
        )}
      </div>
      {b && (
        <div className="field"><span>数据备份（画布、模型档案、生成记录）</span>
          <div className="status-line" data-testid="backup-status" style={{ '--c': b.count ? 'var(--ok)' : 'var(--warn)' } as React.CSSProperties}>
            <span className="dot" aria-hidden="true" />
            {b.count ? `自动备份 · 每 ${b.everyHours} 小时 · 保留最近 ${b.keep} 份 · 最近一次 ${when(b.latest)}` : '还没有备份'}
            <button className="btn xs" disabled={backing === 'busy'} onClick={backupNow} data-testid="backup-now">{backing === 'busy' ? '备份中…' : '立即备份'}</button>
          </div>
          <span className="help">{backing === 'error' ? (sys?.accounts ? '备份失败，请稍后再试。' : '备份失败，请检查数据目录的磁盘空间。') : (sys?.accounts ? '备份保存在服务器上你的空间里。数据文件损坏时，会自动换成最近一份完好的备份。' : '备份在数据目录的 backups 文件夹里。数据文件损坏时，下次启动会自动换成最近一份完好的备份。')}</span>
        </div>
      )}
      {r && (
        <div className="hint warn" data-testid="recovery-note" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>
            {when(r.at)} 启动时发现数据文件损坏（{r.problem}），
            {r.restoredFrom ? `已自动从备份 ${r.restoredFrom} 恢复；那之后的修改没有包含在内。` : '没有可用的备份，已用空数据启动。'}
            {r.keptAs && `损坏的文件保留为 ${r.keptAs}，可交给技术支持尝试找回。`}
          </span>
        </div>
      )}
      {sys?.node && <dl className="meta-list"><dt>运行环境</dt><dd>Node {sys.node} · {sys.platform}</dd></dl>}
      <div className="hint"><Info aria-hidden="true" /><span>{sys?.accounts ? '你的画布、模型档案与素材保存在服务器上只属于你的独立空间里，并自动备份；模型由你自带 API 提供。' : '项目与素材保存在本机数据目录；模型由你自带 API 或本地服务提供。'}</span></div>
    </div>
  )
}

export function Settings() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const intent = useStore((s) => s.settingsIntent)
  const [tab, setTab] = useState<Tab>(intent?.tab ?? 'profiles')
  useEscape(() => setSettingsOpen(false))
  const backRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { enterOverlay(panelRef.current, backRef.current) }, [])
  const accounts = useStore((s) => s.accounts)
  // signed-in deployments have accounts instead of the shared access token
  const TABS: { id: Tab; label: string; Icon: typeof Cpu }[] = [
    { id: 'profiles', label: '模型档案', Icon: Cpu },
    { id: 'skills', label: 'Skill', Icon: Clapperboard },
    { id: 'appearance', label: '外观与动效', Icon: Palette },
    accounts ? { id: 'account', label: '账号', Icon: CircleUser } : { id: 'access', label: '访问口令', Icon: KeyRound },
    { id: 'about', label: '关于', Icon: Boxes },
  ]
  return (
    <div className="modal-back" ref={backRef} onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false) }}>
      <div className="modal" ref={panelRef} role="dialog" aria-label="设置">
        <div className="modal-head">
          <h2>设置</h2>
          <button className="btn icon ghost" onClick={() => setSettingsOpen(false)} aria-label="关闭"><X /></button>
        </div>
        <div className="modal-body">
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}><t.Icon />{t.label}</button>
            ))}
          </nav>
          <div className="pane">
            {tab === 'profiles' && <ProfilesPane addKind={intent?.addKind} />}
            {tab === 'access' && <AccessPane />}
            {tab === 'account' && <AccountPane />}
            {tab === 'skills' && <SkillsPane />}
            {tab === 'appearance' && <AppearancePane />}
            {tab === 'about' && <AboutPane />}
          </div>
        </div>
      </div>
    </div>
  )
}
