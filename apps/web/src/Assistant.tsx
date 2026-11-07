import { useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ArrowUp, Check, CircleAlert, Crosshair, MessageSquarePlus, Play, Plus, Sparkles } from 'lucide-react'
import { NODE_TYPE_MAP } from '@hzc/core'
import { CATEGORY_COLOR, NODE_ICON } from './icons'
import { defaultProfileFor, useStore, type AssistantTurn } from './store'

/**
 * Canvas assistant: describe what you want; your own text model proposes the nodes (with prompts
 * and connections), and nothing is added until you approve the plan.
 */
const STARTERS: { label: string; text: string; send?: boolean }[] = [
  { label: '一句话出一条短视频', text: '帮我做一条 5 秒的竖屏短视频：' },
  { label: '照着参考图做同款', text: '我有一张参考图，想做同样风格的新画面：' },
  { label: '把台词做成配音', text: '把这段台词做成配音：' },
  { label: '看看画布，帮我补全', text: '看看当前画布，告诉我还缺什么，并帮我补全成能直接运行的流程。', send: true },
]

function PlanCard({ turn, index }: { turn: AssistantTurn; index: number }) {
  const applyPlan = useStore((s) => s.applyPlan)
  const runNodes = useStore((s) => s.runNodes)
  const focusNode = useStore((s) => s.focusNode)
  const running = useStore((s) => s.runId !== null)
  const { fitView } = useReactFlow()
  const plan = turn.plan!
  const add = (run: boolean) => {
    const ids = applyPlan(index)
    if (!ids.length) return
    requestAnimationFrame(() => requestAnimationFrame(() => void fitView({ nodes: ids.map((id) => ({ id })), padding: 0.2, maxZoom: 1, duration: 400 })))
    if (run) setTimeout(() => void runNodes(ids), 450)
  }
  return (
    <div className="plan-card" data-testid="plan-card">
      <div className="plan-head"><span>方案 · {plan.nodes.length} 个节点</span><span className="muted">{plan.edges.length} 条连线</span></div>
      <div className="plan-list">
        {plan.nodes.map((n) => {
          const def = NODE_TYPE_MAP[n.type]
          const Icon = def ? NODE_ICON[def.type] : undefined
          return (
            <div className="plan-row" key={n.key}>
              {def && Icon && <span className="chip-ico sm" style={{ '--c': CATEGORY_COLOR[def.category] } as React.CSSProperties} aria-hidden="true"><Icon /></span>}
              <div className="txt">
                <div className="nm">{n.label || def?.label}<span className="muted"> · {def?.label}</span></div>
                {n.text && <div className="ds">{n.text}</div>}
              </div>
            </div>
          )
        })}
      </div>
      {!!turn.warnings?.length && (
        <details className="plan-warn"><summary><CircleAlert aria-hidden="true" />已自动修正 {turn.warnings.length} 处</summary><ul>{turn.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
      )}
      {turn.applied
        ? <div className="plan-done"><Check aria-hidden="true" />已添加到画布<button className="btn xs ghost" onClick={() => focusNode(turn.applied![0]!)}><Crosshair />定位</button></div>
        : (
          <div className="plan-actions">
            <button className="btn sm primary" onClick={() => add(false)} data-testid="plan-apply"><Plus />添加到画布</button>
            <button className="btn sm" onClick={() => add(true)} disabled={running} data-testid="plan-apply-run"><Play />添加并运行</button>
          </div>
        )}
    </div>
  )
}

export function Assistant() {
  const profiles = useStore((s) => s.profiles)
  const turns = useStore((s) => s.assistantTurns)
  const busy = useStore((s) => s.assistantBusy)
  const ask = useStore((s) => s.askAssistant)
  const clear = useStore((s) => s.clearAssistant)
  const openSettings = useStore((s) => s.openSettings)
  const textModels = profiles.filter((p) => p.kind === 'llm')
  const [profileId, setProfileId] = useState<string>(() => defaultProfileFor('llm', profiles) ?? '')
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!textModels.some((p) => p.id === profileId)) setProfileId(defaultProfileFor('llm', profiles) ?? '') }, [profiles]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [turns.length, busy])
  const send = (msg = text) => {
    const m = msg.trim()
    if (!m || busy || !profileId) return
    setText('')
    void ask(profileId, m)
  }

  return (
    <div className="assistant" data-testid="assistant">
      <div className="asst-head">
        <select value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-label="助手使用的文本模型" disabled={!textModels.length}>
          {!textModels.length && <option value="">还没有文本模型</option>}
          {textModels.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
        </select>
        <button className="btn ghost sm icon" onClick={clear} disabled={!turns.length || busy} aria-label="新对话" title="新对话"><MessageSquarePlus /></button>
      </div>

      <div className="asst-list" ref={listRef}>
        {!turns.length && (
          <div className="asst-intro">
            <span className="asst-badge" aria-hidden="true"><Sparkles /></span>
            <h3>画布助手</h3>
            <p>说出你想做的，我用你的文本模型挑节点、连好线、写好提示词。方案会先给你看，确认后才加到画布上。</p>
            {textModels.length ? (
              <div className="asst-starters">
                {STARTERS.map((st) => (
                  <button key={st.label} className="btn sm" data-testid="asst-starter"
                    onClick={() => { if (st.send) send(st.text); else { setText(st.text); requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(st.text.length, st.text.length) }) } }}>
                    {st.label}
                  </button>
                ))}
              </div>
            ) : (
              <button className="btn primary sm" onClick={() => openSettings({ addKind: 'llm' })} data-testid="asst-add-model"><Plus />先添加一个文本模型</button>
            )}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}${t.error ? ' error' : ''}`} data-testid={`bubble-${t.role}`}>
            <div className="bubble-text">{t.content}</div>
            {t.plan && <PlanCard turn={t} index={i} />}
          </div>
        ))}
        {busy && <div className="bubble assistant thinking" data-testid="asst-thinking"><span className="orbit" style={{ '--s': '14px' } as React.CSSProperties} aria-hidden="true" />正在规划节点…</div>}
      </div>

      <div className="asst-input">
        <textarea ref={inputRef} rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={!textModels.length}
          placeholder={textModels.length ? '例如：做一张咖啡店秋季新品海报，再把它做成 5 秒的推镜头视频' : '添加文本模型后即可使用'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
          aria-label="告诉助手你想做什么" data-testid="asst-input" />
        <button className="btn primary sm icon" onClick={() => send()} disabled={!text.trim() || busy || !profileId} aria-label="发送" data-testid="asst-send"><ArrowUp /></button>
      </div>
      <div className="asst-foot muted">Enter 发送 · Shift + Enter 换行 · 请求只发给你选的模型</div>
    </div>
  )
}
