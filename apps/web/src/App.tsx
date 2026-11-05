import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Check, CircleCheck, CircleStop, CloudCheck, FolderOpen, Infinity as InfinityIcon, Info, LayoutTemplate, LoaderCircle, Play, Plus, Settings as SettingsIcon, Sparkles, TriangleExclamationPoint, X } from 'lucide-react'
import { NODE_TYPE_MAP } from '@hzc/core'
import { HzcNode } from './CanvasNode'
import { CommandPalette } from './CommandPalette'
import { Sidebar, DND_MIME } from './Sidebar'
import { Settings } from './Settings'
import { Starfield } from './Starfield'
import { CATEGORY_COLOR, PORT_COLOR } from './icons'
import { enterMenu, enterOverlay, enterToast } from './motion'
import { TEMPLATES } from './templates'
import { useAddNode } from './useAddNode'
import { useStore } from './store'

export const APP_VERSION = 'v1.0.0-beta.4'

const nodeTypes = Object.fromEntries(
  ['text', 'image', 'video', 'audio', 'llm', 'vlm', 'image-gen', 'video-gen', 'tts', 'image-reverse', 'video-reverse', 'director', 'preview', 'export'].map((t) => [t, HzcNode]),
)

const fmt = (n: number, cur: string) => `${cur === 'CNY' ? '¥' : cur === 'USD' ? '$' : cur + ' '}${n.toFixed(n < 1 ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '')}`

/** Shown before any run that generates media or has a priced provider call. */
function ConfirmRun() {
  const pending = useStore((s) => s.pendingRun)
  const runNodes = useStore((s) => s.runNodes)
  const dismiss = useStore((s) => s.dismissPendingRun)
  const backRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (pending) enterOverlay(panelRef.current, backRef.current) }, [pending])
  if (!pending) return null
  const { estimate } = pending
  const calls = estimate.items.filter((i) => !i.cached)
  const reused = estimate.items.length - calls.length
  const totals = Object.entries(estimate.totals)
  return (
    <div className="modal-back" ref={backRef} onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss() }}>
      <div className="modal confirm" ref={panelRef} role="dialog" aria-label="确认运行">
        <div className="modal-head"><h2>确认运行</h2><button className="btn icon ghost" onClick={dismiss} aria-label="关闭"><X /></button></div>
        <div className="pane">
          <div className="muted">本次将调用 {calls.length} 次模型服务{reused > 0 ? `，另有 ${reused} 个节点复用已有结果（不再计费）` : ''}。</div>
          <div className="est-list">
            {calls.map((i) => (
              <div className="est-row" key={i.nodeId}>
                <div className="txt">
                  <div className="nm">{i.label}</div>
                  <div className="ds">{i.profileName ?? '未绑定模型'}{i.generative ? ' · 生成类调用' : ''}</div>
                </div>
                <span className="price">{i.cost ? fmt(i.cost.amount, i.cost.currency) : '未设置单价'}</span>
              </div>
            ))}
          </div>
          <div className="est-total">
            <span>预估费用</span>
            <span className="num" data-testid="estimate-total">{totals.length ? totals.map(([c, n]) => fmt(n, c)).join(' + ') : '—'}</span>
          </div>
          {estimate.unpriced > 0 && <div className="hint" style={{ marginTop: 8 }}><Info />{estimate.unpriced} 次调用未设置单价，可在「设置 → 模型档案」为模型填写每次调用的费用。</div>}
        </div>
        <div className="foot">
          <button className="btn" onClick={dismiss} data-testid="confirm-cancel">取消</button>
          <button className="btn primary" onClick={() => void runNodes(pending.nodeIds, pending.force, true)} data-testid="confirm-run"><Play />确认运行</button>
        </div>
      </div>
    </div>
  )
}

/** One control for the current canvas: inline rename + a menu to switch or create canvases. */
function ProjectMenu() {
  const { projects, projectId, projectName, openProject, newProject, renameProject } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    enterMenu(menuRef.current)
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="project" ref={ref}>
      <button className="btn ghost icon" onClick={() => setOpen((o) => !o)} aria-label="切换画布" aria-expanded={open} title="切换或新建画布" data-testid="project-menu">
        <FolderOpen />
      </button>
      <input className="pname" value={projectName} onChange={(e) => renameProject(e.target.value)} aria-label="画布名称" title="点击重命名" />
      {open && (
        <div className="menu" role="menu" ref={menuRef}>
          <div className="menu-label">我的画布</div>
          {projects.map((p) => (
            <button key={p.id} role="menuitem" className={`menu-item${p.id === projectId ? ' on' : ''}`}
              onClick={() => { setOpen(false); if (p.id !== projectId) void openProject(p.id) }}>
              <span className="grow">{p.id === projectId ? projectName : p.name}</span>
              {p.id === projectId && <Check />}
            </button>
          ))}
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); void newProject() }} data-testid="new-project"><Plus />新建画布</button>
        </div>
      )}
    </div>
  )
}

function SaveIndicator() {
  const state = useStore((s) => s.saveState)
  const label = { idle: '', dirty: '未保存', saving: '保存中…', saved: '已保存', error: '保存失败' }[state]
  return (
    <span className={`save ${state}`} data-testid="save-state">
      {state === 'saving' && <LoaderCircle className="spin" />}
      {state === 'saved' && <CloudCheck />}
      {state === 'error' && <TriangleExclamationPoint />}
      {label}
    </span>
  )
}

function EmptyState() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const openPalette = useStore((s) => s.openPalette)
  const hasProfiles = useStore((s) => s.profiles.length > 0)
  const { addTemplate } = useAddNode()
  return (
    <div className="canvas-empty">
      <div className="empty-card">
        <div className="badge-ico"><Sparkles /></div>
        <h2>把模型组成你的创作团队</h2>
        <p>每个模型都是一个智能体。拖进画布、连线，就是一条从创意到成片的流水线。</p>
        <ol>
          <li><span>在「设置 → 模型档案」添加你的模型：文本、视觉、图片、视频、语音{hasProfiles && <CircleCheck style={{ width: 14, height: 14, color: 'var(--ok)', marginLeft: 6, verticalAlign: -2 }} />}</span></li>
          <li><span>从左侧拖入模型或节点；或在画布上按 <kbd>/</kbd>、双击空白处快速添加</span></li>
          <li><span>从输出端口连线到输入端口，点「运行全部」</span></li>
        </ol>
        <div className="actions">
          {!hasProfiles && <button className="btn primary" onClick={() => setSettingsOpen(true)}><Plus />添加模型档案</button>}
          {TEMPLATES.map((t) => (
            <button key={t.id} className="btn" onClick={() => addTemplate(t.graph())} title={t.description} data-testid={`template-${t.id}`}><LayoutTemplate />{t.name}</button>
          ))}
          <button className="btn ghost" onClick={() => openPalette()}>全部节点 <kbd>/</kbd></button>
        </div>
      </div>
    </div>
  )
}

function Canvas() {
  const s = useStore()
  const { screenToFlowPosition } = useReactFlow()
  // The canvas is remounted per project (see ProjectWorkspace). Fit the view on open only if the
  // project already has nodes — otherwise React Flow would zoom onto the first node the user drops.
  const [fitOnOpen] = useState(() => useStore.getState().nodes.length > 0)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData(DND_MIME)
    if (!raw) return
    const { type, profileId } = JSON.parse(raw) as { type: string; profileId?: string }
    s.addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }), profileId)
  }, [s, screenToFlowPosition])

  // colour each edge by the data type of its source port; animate it while its target runs
  const edges = useMemo<Edge[]>(() => {
    const types = new Map(s.nodes.map((n) => [n.id, n.type ?? '']))
    return s.edges.map((e) => {
      const def = NODE_TYPE_MAP[types.get(e.source) ?? '']
      const port = def?.outputs.find((p) => p.id === (e.sourceHandle ?? 'out'))
      const stroke = port ? PORT_COLOR[port.type] : undefined
      return { ...e, animated: s.runStates[e.target]?.status === 'running', style: stroke ? { stroke, strokeOpacity: 0.85 } : undefined }
    })
  }, [s.edges, s.nodes, s.runStates])

  return (
    <div className="canvas" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
      onDoubleClick={(e) => {
        // double-click on empty canvas: quick-add at that point
        if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return
        s.openPalette(screenToFlowPosition({ x: e.clientX - 150, y: e.clientY - 40 }))
      }}>
      <ReactFlow
        nodes={s.nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={s.onNodesChange} onEdgesChange={s.onEdgesChange}
        onConnect={s.onConnect} isValidConnection={s.isValidConnection}
        onMove={(_, vp) => {
          // the star ground drifts slightly with panning (parallax)
          const r = document.documentElement.style
          r.setProperty('--pan-x', String(vp.x)); r.setProperty('--pan-y', String(vp.y))
          window.dispatchEvent(new Event('hzc:pan'))
        }}
        fitView={fitOnOpen} fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        zoomOnDoubleClick={false}
        deleteKeyCode={['Backspace', 'Delete']} minZoom={0.1} maxZoom={2}
        colorMode="system" proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
        <Controls showInteractive={false} />
        {s.nodes.length > 0 && (
          <MiniMap pannable zoomable nodeBorderRadius={6}
            nodeColor={(n) => { const d = NODE_TYPE_MAP[n.type ?? '']; return d ? CATEGORY_COLOR[d.category] : '#555' }} />
        )}
      </ReactFlow>
      {s.nodes.length === 0 && <EmptyState />}
    </div>
  )
}

/** Fresh React Flow instance (and viewport) per opened project; sidebar and palette share it. */
function ProjectWorkspace() {
  const projectId = useStore((s) => s.projectId)
  return (
    <ReactFlowProvider key={projectId ?? 'none'}>
      <div className="main">
        <Sidebar />
        <Canvas />
      </div>
      <CommandPalette />
    </ReactFlowProvider>
  )
}

function Toast() {
  const toast = useStore((s) => s.toast)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (toast) enterToast(ref.current) }, [toast])
  if (!toast) return null
  return <div className="toast" role="status" ref={ref}><Sparkles />{toast}</div>
}

export function App() {
  const s = useStore()

  useEffect(() => { void s.init().catch((e) => s.showToast(`连接服务失败：${(e as Error).message}`)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // debounced autosave
  useEffect(() => {
    if (s.saveState !== 'dirty') return
    const t = setTimeout(() => void s.save(), 800)
    return () => clearTimeout(t)
  }, [s.saveState, s.nodes, s.edges, s.projectName]) // eslint-disable-line react-hooks/exhaustive-deps

  // "/" opens quick-add anywhere except while typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (useStore.getState().settingsOpen) return
      e.preventDefault()
      useStore.getState().openPalette()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <Starfield />
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="logo"><InfinityIcon /></span>
            <span className="brand-name">Haizhu Infinity Canvas</span>
            <span className="ver">{APP_VERSION}</span>
          </div>
          <span className="divider" />
          <ProjectMenu />
          <span className="spacer" />
          <SaveIndicator />
          {s.runId
            ? <button className="btn danger running" onClick={() => void s.cancelRun()} data-testid="stop-run"><CircleStop />停止</button>
            : <button className="btn primary" onClick={() => void s.runNodes()} disabled={s.nodes.length === 0} data-testid="run-all"><Play />运行全部</button>}
          <button className="btn icon ghost" onClick={() => s.setSettingsOpen(true)} data-testid="open-settings" title="设置" aria-label="设置"><SettingsIcon /></button>
        </header>
        <ProjectWorkspace />
        {s.settingsOpen && <Settings />}
        <ConfirmRun />
        <Toast />
      </div>
    </>
  )
}

export default function Root() {
  return <App />
}
