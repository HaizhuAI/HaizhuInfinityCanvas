import { useEffect, useRef, useState } from 'react'
import { Boxes, Clapperboard, Cpu, FileUp, Info, KeyRound, Pencil, Plus, Sparkles, Trash, X } from 'lucide-react'
import { ADAPTERS, MODEL_KINDS, type AdapterId, type ModelKind, type ModelProfileInput, type ModelProfilePublic } from '@hzc/core'
import { api, getToken, setToken } from './api'
import { KIND_COLOR, KIND_ICON, KIND_LABEL } from './icons'
import { enterOverlay, motionEnabled, setMotionEnabled } from './motion'
import { ambientOn, setAmbient, setThemePref, themePref, type ThemePref } from './theme'
import { useStore } from './store'

type Tab = 'profiles' | 'skills' | 'appearance' | 'access' | 'about'
type FormState = Omit<ModelProfileInput, 'defaults' | 'cost'> & { id?: string; defaultsText: string; costAmount: string; costCurrency: string }

/** Quick-fill presets: OpenAI-compatible endpoints published by each provider. Model IDs are left to the user. */
const PRESETS: { id: string; label: string; adapter: AdapterId; endpoint: string; kinds: ModelKind[] }[] = [
  { id: 'openai', label: 'OpenAI', adapter: 'openai-compat', endpoint: 'https://api.openai.com/v1', kinds: ['llm', 'vlm'] },
  { id: 'dashscope', label: '阿里云百炼（通义）', adapter: 'openai-compat', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', kinds: ['llm', 'vlm'] },
  { id: 'ark', label: '火山方舟（豆包）', adapter: 'openai-compat', endpoint: 'https://ark.cn-beijing.volces.com/api/v3', kinds: ['llm', 'vlm'] },
  { id: 'deepseek', label: 'DeepSeek', adapter: 'openai-compat', endpoint: 'https://api.deepseek.com/v1', kinds: ['llm'] },
  { id: 'openrouter', label: 'OpenRouter', adapter: 'openai-compat', endpoint: 'https://openrouter.ai/api/v1', kinds: ['llm', 'vlm'] },
  { id: 'ollama', label: 'Ollama（本地）', adapter: 'ollama', endpoint: 'http://127.0.0.1:11434', kinds: ['llm', 'vlm'] },
  { id: 'lmstudio', label: 'LM Studio（本地）', adapter: 'openai-compat', endpoint: 'http://127.0.0.1:1234/v1', kinds: ['llm', 'vlm'] },
  { id: 'openai-img', label: 'OpenAI 图片', adapter: 'openai-compat', endpoint: 'https://api.openai.com/v1', kinds: ['image'] },
  { id: 'replicate', label: 'Replicate', adapter: 'replicate', endpoint: 'https://api.replicate.com/v1', kinds: ['image', 'video'] },
  { id: 'fal', label: 'fal.ai', adapter: 'fal', endpoint: 'https://queue.fal.run', kinds: ['image', 'video'] },
]

const blank = (): FormState => ({ name: '', kind: 'llm', adapter: 'openai-compat', endpoint: '', model: '', apiKey: '', defaultsText: '{}', costAmount: '', costCurrency: 'CNY' })

function ProfileForm({ initial, onDone }: { initial: FormState; onDone: () => void }) {
  const { loadProfiles, showToast } = useStore()
  const [form, setForm] = useState<FormState>(initial)
  const [err, setErr] = useState('')
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  async function submit() {
    setErr('')
    let defaults: Record<string, unknown>
    try {
      const parsed = JSON.parse(form.defaultsText || '{}') as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
      defaults = parsed as Record<string, unknown>
    } catch { setErr('默认参数必须是 JSON 对象，例如 {"temperature": 0.7}'); return }
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
      if (id) await api.updateProfile(id, input)
      else await api.createProfile(input)
      await loadProfiles()
      showToast(id ? '模型档案已更新' : '模型档案已添加，可以从左侧拖入画布')
      onDone()
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <div>
        <h3>{form.id ? '编辑模型档案' : '添加模型档案'}</h3>
        <div className="muted">保存后会成为左侧「我的模型智能体」中的一个图标。</div>
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

      <label className="field"><span>快速填写（可选）</span>
        <select value="" aria-label="快速填写服务商" onChange={(e) => {
          const p = PRESETS.find((x) => x.id === e.target.value)
          if (p) set({ adapter: p.adapter, endpoint: p.endpoint, name: form.name || p.label })
        }}>
          <option value="">选择服务商，自动填好适配器和接口地址…</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}（{p.kinds.map((k) => KIND_LABEL[k]).join(' / ')}）</option>)}
        </select>
      </label>

      <div className="row2">
        <label className="field"><span>名称</span>
          <input required value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="如：通义视觉、Kling 视频" data-testid="pf-name" />
        </label>
        <label className="field"><span>模型 ID</span>
          <input required value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="以服务商文档为准" data-testid="pf-model" />
        </label>
      </div>
      <div className="row2">
        <label className="field"><span>适配器</span>
          <select value={form.adapter} onChange={(e) => set({ adapter: e.target.value as AdapterId })} data-testid="pf-adapter">
            {ADAPTERS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="field"><span>接口地址</span>
          <input value={form.endpoint} onChange={(e) => set({ endpoint: e.target.value })} placeholder="https://…/v1" data-testid="pf-endpoint" />
        </label>
      </div>
      <label className="field"><span>API Key</span>
        <input type="password" autoComplete="off" value={form.apiKey ?? ''} onChange={(e) => set({ apiKey: e.target.value })}
          placeholder={form.id ? '留空 = 保持不变' : '本地模型可留空'} data-testid="pf-key" />
        <span className="help">加密保存在本机服务端，不会再回传到浏览器。</span>
      </label>
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
      <span className="help" style={{ marginTop: -8 }}>用于运行前的费用预估，按你在服务商处的实际价格填写；不填则只提示调用次数。</span>
      <label className="field"><span>默认参数（JSON，可选）</span>
        <textarea value={form.defaultsText} onChange={(e) => set({ defaultsText: e.target.value })} spellCheck={false} data-testid="pf-defaults" />
        <span className="help">
          会合并进每次请求，例如 {'{"temperature": 0.7}'}。以 _ 开头的键是适配器配置、不会发给服务商：
          {' '}<code>_fields</code> 映射输入字段名（如 {'{"_fields": {"image": "input_image", "first": "start_image"}}'}），
          {' '}<code>_timeoutSec</code> 设置最长等待秒数。
        </span>
      </label>

      {err && <div className="form-err" role="alert">{err}</div>}
      <div className="form-actions">
        <button type="submit" className="btn primary" data-testid="pf-save">保存</button>
        <button type="button" className="btn" onClick={onDone}>取消</button>
      </div>
    </form>
  )
}

function ProfilesPane() {
  const { profiles, loadProfiles } = useStore()
  const [form, setForm] = useState<FormState | null>(null)
  if (form) return <ProfileForm initial={form} onDone={() => setForm(null)} />

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
      <button className="btn primary" onClick={() => setForm(blank())} data-testid="add-profile"><Plus />添加模型档案</button>
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

function SkillsPane() {
  const { skills, loadSkills, showToast } = useStore()
  const [importing, setImporting] = useState(false)
  const [text, setText] = useState(SKILL_TEMPLATE)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function save() {
    setErr('')
    try {
      const s = await api.importSkill(text)
      await loadSkills()
      showToast(`已导入 Skill「${s.label}」`)
      setImporting(false); setText(SKILL_TEMPLATE)
    } catch (e) { setErr((e as Error).message) }
  }

  async function remove(name: string) {
    if (!confirm(`删除 Skill「${name}」？使用它的导演节点会提示找不到 Skill。`)) return
    try { await api.deleteSkill(name); await loadSkills() } catch (e) { showToast((e as Error).message) }
  }

  if (importing) return (
    <div className="form import-box">
      <div>
        <h3>导入 Skill</h3>
        <div className="muted">粘贴一个 SKILL.md（Agent Skills 开放格式），或选择文件。metadata 里写 <code>hzc-kind: director</code> 会让它出现在导演节点的 Skill 列表最前面。</div>
      </div>
      <input ref={fileRef} type="file" accept=".md,text/markdown,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} />
      <div><button className="btn" onClick={() => fileRef.current?.click()}><FileUp />选择 SKILL.md 文件</button></div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} data-testid="skill-text" />
      {err && <div className="form-err" role="alert">{err}</div>}
      <div className="form-actions">
        <button className="btn primary" onClick={() => void save()} data-testid="skill-save">导入</button>
        <button className="btn" onClick={() => { setImporting(false); setErr('') }}>取消</button>
      </div>
    </div>
  )

  return (
    <>
      <h3>导演 Skill</h3>
      <p className="muted">Skill 是给模型的一套专业指令（Agent Skills 开放格式）。导演节点会用它把创意拆成分镜。只使用其中的文字指令，不会执行任何脚本。</p>
      <div className="pcard-list">
        {skills.map((s) => (
          <div className="pcard" key={s.name} data-testid={`skill-${s.name}`}>
            <span className="chip-ico" style={{ '--c': 'var(--c-tool)' } as React.CSSProperties}><Clapperboard /></span>
            <div className="txt">
              <div className="nm">{s.label} <span className="muted skill-src">{s.name}</span></div>
              <div className="ds" title={s.description}>{s.description}</div>
            </div>
            <span className={`tag${s.source === 'builtin' ? ' ok' : ''}`}>{s.source === 'builtin' ? '内置' : '我的'}</span>
            {s.source === 'user' && <button className="btn sm icon ghost" title="删除" aria-label={`删除 ${s.name}`} onClick={() => void remove(s.name)}><Trash /></button>}
          </div>
        ))}
      </div>
      <button className="btn primary" onClick={() => setImporting(true)} data-testid="import-skill"><Plus />导入 Skill</button>
    </>
  )
}

function AppearancePane() {
  const [on, setOn] = useState(motionEnabled())
  const [theme, setTheme] = useState<ThemePref>(themePref())
  const [amb, setAmb] = useState(ambientOn())
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  return (
    <div className="form">
      <div>
        <h3>外观与动效</h3>
        <div className="muted">默认是中性深灰的工作室界面：背景不偏色，让你的图片和视频色彩如实呈现。</div>
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
      <label className="switch">
        <input type="checkbox" checked={amb} onChange={(e) => { setAmbient(e.target.checked); setAmb(e.target.checked) }} data-testid="ambient-switch" />
        <span className="track"><span className="knob" /></span>
        <span>氛围星空背景（仅深色主题）</span>
      </label>
      <div className="hint"><Info aria-hidden="true" />{reduced ? '系统开启了「减少动态效果」，动效已自动关闭。' : '评估画面色彩时建议关闭氛围背景。'}</div>
    </div>
  )
}

function AboutPane() {
  const [sys, setSys] = useState<Awaited<ReturnType<typeof api.system>> | null>(null)
  const [busy, setBusy] = useState(false)
  const load = (refresh = false) => { setBusy(true); void api.system(refresh).then(setSys).catch(() => setSys(null)).finally(() => setBusy(false)) }
  useEffect(() => { load() }, [])
  const f = sys?.ffmpeg
  return (
    <div className="form">
      <div>
        <h3>Haizhu Infinity Canvas</h3>
        <div className="muted">面向图像与视频创作者的无限画布。当前版本 v1.0.0-rc.1。</div>
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
      {sys && <dl className="meta-list"><dt>运行环境</dt><dd>Node {sys.node} · {sys.platform}</dd></dl>}
      <div className="hint"><Info aria-hidden="true" /><span>项目与素材保存在本机数据目录；模型由你自带 API 或本地服务提供。</span></div>
    </div>
  )
}

export function Settings() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const [tab, setTab] = useState<Tab>('profiles')
  const backRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { enterOverlay(panelRef.current, backRef.current) }, [])
  const TABS: { id: Tab; label: string; Icon: typeof Cpu }[] = [
    { id: 'profiles', label: '模型档案', Icon: Cpu },
    { id: 'skills', label: '导演 Skill', Icon: Clapperboard },
    { id: 'appearance', label: '外观与动效', Icon: Sparkles },
    { id: 'access', label: '访问口令', Icon: KeyRound },
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
            {tab === 'profiles' && <ProfilesPane />}
            {tab === 'access' && <AccessPane />}
            {tab === 'skills' && <SkillsPane />}
            {tab === 'appearance' && <AppearancePane />}
            {tab === 'about' && <AboutPane />}
          </div>
        </div>
      </div>
    </div>
  )
}
