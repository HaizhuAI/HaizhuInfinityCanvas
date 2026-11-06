import { useEffect, useMemo, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { CircleAlert, Crosshair, Download, Keyboard, Play, Plus, Sparkles, X } from 'lucide-react'
import { NODE_TYPE_MAP, type ModelKind } from '@hzc/core'
import { CATEGORY_COLOR, KIND_COLOR, KIND_ICON, KIND_LABEL, NODE_ICON } from './icons'
import { enterOverlay, enterToast } from './motion'
import { preflight, type Issue } from './preflight'
import { useStore } from './store'

/** Escape closes the top-most overlay that registered (latest wins). */
const escStack: (() => void)[] = []
let escBound = false
export function useEscape(onEscape: () => void, active = true) {
  const fn = useRef(onEscape)
  fn.current = onEscape
  useEffect(() => {
    if (!active) return
    if (!escBound) {
      escBound = true
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !escStack.length || e.defaultPrevented) return
        e.preventDefault()
        escStack[escStack.length - 1]!()
      })
    }
    const entry = () => fn.current()
    escStack.push(entry)
    return () => { const i = escStack.lastIndexOf(entry); if (i >= 0) escStack.splice(i, 1) }
  }, [active])
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'

/** Before a run: what would fail, with a fix right there (choose a model, add one, locate the node). */
export function PreflightDialog() {
  const pending = useStore((s) => s.pendingCheck)
  const nodes = useStore((s) => s.nodes)
  const edges = useStore((s) => s.edges)
  const profiles = useStore((s) => s.profiles)
  const ffmpegOk = useStore((s) => s.ffmpegOk)
  const { dismissCheck, runNodes, setNodeData, openSettings, focusNode } = useStore.getState()
  const issues = useMemo(() => (pending ? preflight({ nodes, edges, profiles, ffmpegOk }, pending.nodeIds) : []), [pending, nodes, edges, profiles, ffmpegOk])
  const backRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (pending) enterOverlay(panelRef.current, backRef.current) }, [pending])
  useEscape(dismissCheck, !!pending)
  if (!pending) return null
  // missing models are grouped by kind (one choice fixes every node of that kind); the rest per node
  const modelGroups = new Map<ModelKind, string[]>()
  const byNode = new Map<string, Issue[]>()
  for (const i of issues) {
    if (i.type === 'model' && i.kind) modelGroups.set(i.kind, [...(modelGroups.get(i.kind) ?? []), i.nodeId])
    else byNode.set(i.nodeId, [...(byNode.get(i.nodeId) ?? []), i])
  }
  const affected = new Set(issues.map((i) => i.nodeId)).size
  const go = () => void runNodes(pending.nodeIds, pending.force, { checked: true })
  const locate = (id: string) => { dismissCheck(); focusNode(id) }
  const nameOf = (id: string) => { const n = nodes.find((x) => x.id === id); return n ? n.data.label ?? NODE_TYPE_MAP[n.type ?? '']?.label ?? '节点' : '节点' }

  return (
    <div className="modal-back" ref={backRef} onMouseDown={(e) => { if (e.target === e.currentTarget) dismissCheck() }}>
      <div className="modal confirm" ref={panelRef} role="dialog" aria-label="运行前检查" data-testid="preflight">
        <div className="modal-head"><h2>{issues.length ? '运行前还差几步' : '都准备好了'}</h2><button className="btn icon ghost" onClick={dismissCheck} aria-label="关闭"><X /></button></div>
        <div className="pane">
          <div className="muted">{issues.length
            ? `有 ${affected} 个节点现在运行会失败。在这里直接处理，或者先运行其余部分。`
            : '问题都处理好了，可以开始运行。'}</div>
          <div className="est-list">
            {[...modelGroups.entries()].map(([kind, ids]) => {
              const KIcon = KIND_ICON[kind]
              const options = profiles.filter((p) => p.kind === kind)
              const names = ids.slice(0, 3).map(nameOf).join('、') + (ids.length > 3 ? ` 等 ${ids.length} 个` : '')
              return (
                <div className="check-row" key={kind} data-testid="preflight-model-group">
                  <span className="chip-ico sm" style={{ '--c': KIND_COLOR[kind] } as React.CSSProperties} aria-hidden="true"><KIcon /></span>
                  <div className="txt">
                    <div className="nm">{ids.length > 1 ? `${ids.length} 个节点需要${KIND_LABEL[kind]}` : `「${names}」需要${KIND_LABEL[kind]}`}</div>
                    <div className="ds"><CircleAlert aria-hidden="true" />{options.length ? '还没有选择模型' : `还没有${KIND_LABEL[kind]}档案`}{ids.length > 1 ? `：${names}` : ''}</div>
                  </div>
                  <div className="fix">
                    {options.length
                      ? <select aria-label={`为这些节点选择${KIND_LABEL[kind]}`} value="" data-testid="preflight-pick"
                          onChange={(e) => { const v = e.target.value; if (v) ids.forEach((id) => setNodeData(id, { profileId: v })) }}>
                          <option value="">{ids.length > 1 ? `全部使用…` : `选择${KIND_LABEL[kind]}…`}</option>
                          {options.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
                        </select>
                      : <button className="btn sm" onClick={() => openSettings({ addKind: kind })} data-testid="preflight-add-model"><Plus />添加{KIND_LABEL[kind]}</button>}
                  </div>
                </div>
              )
            })}
            {[...byNode.entries()].map(([id, list]) => {
              const n = nodes.find((x) => x.id === id)
              if (!n) return null
              const def = NODE_TYPE_MAP[n.type ?? '']!
              const Icon = NODE_ICON[def.type]!
              return (
                <div className="check-row" key={id} data-testid="preflight-row">
                  <span className="chip-ico sm" style={{ '--c': CATEGORY_COLOR[def.category] } as React.CSSProperties} aria-hidden="true"><Icon /></span>
                  <div className="txt">
                    <div className="nm">{n.data.label ?? def.label}</div>
                    {list.map((i, k) => <div className="ds" key={k}><CircleAlert aria-hidden="true" />{i.text}</div>)}
                  </div>
                  <div className="fix">
                    {list.some((i) => i.type === 'ffmpeg') && <button className="btn sm" onClick={() => openSettings({ tab: 'about' })}><Download />安装方法</button>}
                    {list.some((i) => i.type === 'media' || i.type === 'input') && <button className="btn sm ghost" onClick={() => locate(id)} data-testid="preflight-locate"><Crosshair />定位</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="foot">
          <button className="btn" onClick={dismissCheck} data-testid="preflight-cancel">取消</button>
          {issues.length
            ? <button className="btn" onClick={go} data-testid="preflight-run-anyway"><Play />仍然运行</button>
            : <button className="btn primary" onClick={go} data-testid="preflight-run"><Play />开始运行</button>}
        </div>
      </div>
    </div>
  )
}

const SHORTCUTS: [string, [string, string[]][]][] = [
  ['添加与编辑', [['快速添加节点', ['/']], ['在某处添加', ['双击空白处']], ['撤销', [MOD, 'Z']], ['重做', [MOD, 'Shift', 'Z']], ['复制 / 粘贴', [MOD, 'C', '/', 'V']], ['创建副本', [MOD, 'D']], ['全选', [MOD, 'A']], ['删除选中', ['Delete']]]],
  ['运行', [['运行全部', [MOD, 'Enter']], ['运行单个节点', ['节点上的 ▶']]]],
  ['画布', [['适应画布', ['Shift', '1']], ['平移', ['拖动空白处']], ['缩放', [MOD, '滚轮']], ['框选', ['Shift', '拖动']], ['多选', [MOD, '点击']]]],
  ['其他', [['粘贴图片 / 视频', [MOD, 'V']], ['拖入文件', ['拖到画布上']], ['关闭弹窗', ['Esc']], ['快捷键', ['?']]]],
]

export function ShortcutsSheet() {
  const open = useStore((s) => s.shortcutsOpen)
  const close = () => useStore.getState().setShortcutsOpen(false)
  const backRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) enterOverlay(panelRef.current, backRef.current) }, [open])
  useEscape(close, open)
  if (!open) return null
  return (
    <div className="modal-back" ref={backRef} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="modal confirm shortcuts" ref={panelRef} role="dialog" aria-label="快捷键" data-testid="shortcuts">
        <div className="modal-head"><Keyboard aria-hidden="true" /><h2>快捷键</h2><button className="btn icon ghost" onClick={close} aria-label="关闭"><X /></button></div>
        <div className="pane sc-grid">
          {SHORTCUTS.map(([group, rows]) => (
            <section key={group}>
              <h3>{group}</h3>
              {rows.map(([label, keys]) => (
                <div className="sc-row" key={label}><span>{label}</span><span className="keys">{keys.map((k, i) => (k === '/' && keys.length > 1 ? <i key={i}>/</i> : <kbd key={i}>{k}</kbd>))}</span></div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Toast with an optional action (e.g. "查看原因" jumps to the failed node). */
export function ToastView() {
  const toast = useStore((s) => s.toast)
  const dismiss = useStore((s) => s.dismissToast)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (toast) enterToast(ref.current) }, [toast?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!toast) return null
  return (
    <div className={`toast${toast.tone === 'error' ? ' error' : ''}`} role="status" ref={ref} data-testid="toast">
      {toast.tone === 'error' ? <CircleAlert aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
      <span>{toast.text}</span>
      {toast.action && <button className="btn sm" onClick={() => { toast.action!.run(); dismiss() }} data-testid="toast-action">{toast.action.label}</button>}
      {toast.action && <button className="btn xs icon ghost" onClick={dismiss} aria-label="关闭提示"><X /></button>}
    </div>
  )
}

/** Inside the React Flow provider: centre on a requested node; Shift+1 fits the canvas. */
export function CanvasHelpers() {
  const req = useStore((s) => s.focusRequest)
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (req) requestAnimationFrame(() => void fitView({ nodes: [{ id: req.id }], maxZoom: 1, minZoom: 0.5, padding: 0.6, duration: 400 }))
  }, [req, fitView])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.shiftKey && (e.code === 'Digit1' || e.key === '!')) || e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      void fitView({ padding: 0.2, maxZoom: 1, duration: 300 })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitView])
  return null
}
