import { useEffect, useState } from 'react'
import { LoaderCircle, PenLine, RotateCcw, X } from 'lucide-react'
import { OPTIMIZE_LANGS, PROMPT_FAMILY_LABEL, promptFamily, type OptimizeLang } from '@hzc/core'
import { api } from './api'
import { useStore } from './store'

/** which text model, which writing rules and which language to use: remembered in this browser */
interface Prefs { profileId?: string; skill?: string; lang: OptimizeLang }
const KEY = 'hzc.optimizer'
function loadPrefs(): Prefs {
  try { return { lang: 'auto', ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) } } catch { return { lang: 'auto' } }
}
function savePrefs(p: Prefs) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* blocked */ } }

const LANG_LABEL: Record<OptimizeLang, string> = { auto: '自动', zh: '中文', en: 'English' }

export interface OptimizerProps {
  kind: 'image' | 'video'
  /** the model the prompt is for (its family decides the writing rules) */
  targetProfileId?: string
  prompt: string
  /** a first frame is connected: describe motion only */
  fromImage?: boolean
  /** images a vision model may look at (first frame / references) */
  imageIds?: string[]
  onApply: (text: string) => void
  /** why it can't be used here (e.g. the prompt comes from an upstream node's output) */
  disabledReason?: string
  /** open and start rewriting at once (the composer's 「优化」) */
  autoStart?: boolean
  /** closing hides the panel in the caller (instead of collapsing to a button) */
  onClose?: () => void
}

/**
 * 「优化提示词」：rewrites the prompt the way the target model reads best, with the user's own text
 * model. Shows the result first; nothing changes until 「使用这一版」.
 */
export function PromptOptimizer(p: OptimizerProps) {
  const profiles = useStore((s) => s.profiles)
  const skills = useStore((s) => s.skills)
  const openSettings = useStore((s) => s.openSettings)
  const writers = profiles.filter((x) => x.kind === 'llm' || x.kind === 'vlm')
  const promptSkills = skills.filter((x) => x.kind === 'prompt')
  const [prefs, setPrefsState] = useState(loadPrefs)
  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((cur) => { const next = { ...cur, ...patch }; savePrefs(next); return next })
  const writer = writers.find((x) => x.id === prefs.profileId) ?? writers[0]
  const skill = promptSkills.find((x) => x.name === prefs.skill)
  const target = profiles.find((x) => x.id === p.targetProfileId)
  const family = promptFamily({ kind: p.kind, adapter: target?.adapter, model: target?.model })
  const [open, setOpen] = useState(!!p.autoStart)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setResult(null); setErr('') }, [p.targetProfileId, p.kind])
  useEffect(() => { if (p.autoStart && writer && p.prompt.trim()) void run() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setOpen(false); setResult(null); p.onClose?.() }

  async function run() {
    if (!writer) return
    if (!p.prompt.trim()) { setErr('先写一句提示词，再优化'); return }
    setBusy(true); setErr(''); setResult(null)
    try {
      const r = await api.optimizePrompt({
        profileId: writer.id, prompt: p.prompt, target: { profileId: p.targetProfileId, kind: p.kind },
        fromImage: p.fromImage, imageIds: writer.kind === 'vlm' ? p.imageIds : undefined, lang: prefs.lang, skill: skill?.name,
      })
      setResult(r.prompt)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button type="button" className="btn sm" disabled={!!p.disabledReason} title={p.disabledReason ?? `用你的文本模型，按 ${PROMPT_FAMILY_LABEL[family]} 的写法改写`}
        onClick={() => { setOpen(true); if (writer && p.prompt.trim()) void run() }} data-testid="optimize-open">
        <PenLine />优化提示词
      </button>
    )
  }
  return (
    <div className="popt" data-testid="prompt-optimizer">
      <div className="popt-head">
        <span>按 <b>{skill ? skill.label : PROMPT_FAMILY_LABEL[family]}</b> 的写法{p.fromImage ? '（已有首帧：只写运动与运镜）' : ''}</span>
        <button type="button" className="btn xs icon ghost" onClick={close} aria-label="收起" data-testid="optimize-close"><X /></button>
      </div>
      {!writer ? (
        <div className="popt-empty">
          需要一个文本模型来改写提示词。
          <button type="button" className="btn sm" onClick={() => openSettings({ tab: 'profiles', addKind: 'llm' })}>添加文本模型</button>
        </div>
      ) : (
        <>
          <div className="popt-row">
            <select value={writer.id} onChange={(e) => setPrefs({ profileId: e.target.value })} aria-label="用哪个文本模型改写" data-testid="optimize-writer">
              {writers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select value={skill?.name ?? ''} onChange={(e) => setPrefs({ skill: e.target.value || undefined })} aria-label="写法" data-testid="optimize-skill">
              <option value="">写法：按模型（{PROMPT_FAMILY_LABEL[family]}）</option>
              {promptSkills.map((x) => <option key={x.name} value={x.name}>Skill：{x.label}</option>)}
            </select>
            <div className="seg2 sm" role="radiogroup" aria-label="语言">
              {OPTIMIZE_LANGS.map((l) => (
                <button type="button" key={l} role="radio" aria-checked={prefs.lang === l} className={prefs.lang === l ? 'on' : ''} onClick={() => setPrefs({ lang: l })}>{LANG_LABEL[l]}</button>
              ))}
            </div>
          </div>
          {busy && <div className="popt-busy"><LoaderCircle className="spin" aria-hidden="true" />正在改写…</div>}
          {err && <div className="form-err" role="alert">{err}</div>}
          {result !== null && !busy && (
            <textarea className="popt-out" value={result} onChange={(e) => setResult(e.target.value)} spellCheck={false} data-testid="optimize-result" aria-label="改写后的提示词（可以再改）" />
          )}
          <div className="popt-actions">
            {result !== null && !busy && <button type="button" className="btn sm primary" onClick={() => { p.onApply(result); close() }} data-testid="optimize-apply">使用这一版</button>}
            <button type="button" className="btn sm" disabled={busy} onClick={() => void run()} data-testid="optimize-run"><RotateCcw />{result === null ? '开始改写' : '再改写一次'}</button>
            {writer.kind === 'vlm' && !!p.imageIds?.length && <span className="muted">{writer.name} 会参考接入的图片</span>}
          </div>
        </>
      )}
    </div>
  )
}
