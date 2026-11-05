import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowRight, Check, ChevronDown, Download, FileUp, CircleStop, CloudCheck, Infinity as InfinityIcon, Info, LoaderCircle, PanelRightOpen, Play, Plus, Sparkles, TriangleExclamationPoint, X } from 'lucide-react'
import { NODE_TYPE_MAP } from '@hzc/core'
import { HzcNode } from './CanvasNode'
import { FloatingToolbar, Lightbox, Rail } from './Chrome'
import { CommandPalette } from './CommandPalette'
import { DND_MIME, readDrag } from './dnd'
import { CATEGORY_COLOR, NODE_ICON, PORT_COLOR } from './icons'
import { Inspector } from './Inspector'
import { Assets, Library } from './LeftPanel'
import { enterMenu, enterOverlay, enterToast } from './motion'
import { Settings } from './Settings'
import { Starfield } from './Starfield'
import { TEMPLATES } from './templates'
import { inspectorPref, setInspectorPref } from './theme'
import { useAddNode } from './useAddNode'
import { useStore } from './store'
import { api } from './api'
import type { ProjectGraph } from '@hzc/core'

export const APP_VERSION = 'v1.0.0-rc.1'

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
                <div className="txt"><div className="nm">{i.label}</div><div className="ds">{i.profileName ?? '未绑定模型'}{i.generative ? ' · 生成类调用' : ''}</div></div>
                <span className="price">{i.cost ? fmt(i.cost.amount, i.cost.currency) : '未设置单价'}</span>
              </div>
            ))}
          </div>
          <div className="est-total"><span>预估费用</span><span className="num" data-testid="estimate-total">{totals.length ? totals.map(([c, n]) => fmt(n, c)).join(' + ') : '—'}</span></div>
          {estimate.unpriced > 0 && <div className="hint" style={{ marginTop: 8 }}><Info aria-hidden="true" />{estimate.unpriced} 次调用未设置单价，可在「设置 → 模型档案」为模型填写每次调用的费用。</div>}
        </div>
        <div className="foot">
          <button className="btn" onClick={dismiss} data-testid="confirm-cancel">取消</button>
          <button className="btn primary" onClick={() => void runNodes(pending.nodeIds, pending.force, true)} data-testid="confirm-run"><Play />确认运行</button>
        </div>
      </div>
    </div>
  )
}

/** Centre of the top bar: the canvas name (inline rename) with a menu to switch or create canvases. */
function ProjectMenu() {
  const { projects, projectId, projectName, openProject, newProject, renameProject } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    enterMenu(menuRef.current)
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="project" ref={ref}>
      <input className="pname" value={projectName} onChange={(e) => renameProject(e.target.value)} aria-label="画布名称" title="点击重命名" />
      <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="import-file" onChange={(e) => { const f = e.target.files?.[0]; setOpen(false); if (f) void importCanvas(f); e.target.value = '' }} />
      <button className="btn ghost xs icon" onClick={() => setOpen((o) => !o)} aria-label="切换或新建画布" aria-expanded={open} data-testid="project-menu"><ChevronDown /></button>
      {open && (
        <div className="menu" role="menu" ref={menuRef}>
          <div className="menu-label">我的画布</div>
          {projects.map((p) => (
            <button key={p.id} role="menuitem" className={`menu-item${p.id === projectId ? ' on' : ''}`} onClick={() => { setOpen(false); if (p.id !== projectId) void openProject(p.id) }}>
              <span className="grow">{p.id === projectId ? projectName : p.name}</span>{p.id === projectId && <Check aria-hidden="true" />}
            </button>
          ))}
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); void newProject() }} data-testid="new-project"><Plus aria-hidden="true" />新建画布</button>
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); exportCanvas() }} data-testid="export-canvas"><Download aria-hidden="true" />导出画布文件（.json）</button>
          <button role="menuitem" className="menu-item" onClick={() => fileRef.current?.click()} data-testid="import-canvas"><FileUp aria-hidden="true" />导入画布文件…</button>
        </div>
      )}
    </div>
  )
}

/** Keeps a rendering fault from blanking the window: shows what happened and a way back. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="canvas-empty" role="alert" style={{ position: 'relative' }}>
        <div className="empty-card">
          <div className="eyebrow">出错了</div>
          <h2>界面遇到了一个问题</h2>
          <p>你的画布已经自动保存在本机。重新加载即可继续；如果反复出现，请把下面这行信息告诉我们。</p>
          <pre className="err" style={{ marginBottom: 16 }}>{this.state.error.message}</pre>
          <button className="btn primary" onClick={() => location.reload()}>重新加载</button>
        </div>
      </div>
    )
  }
}

/** A portable copy of the current canvas (graph only — media stays in the local asset store). */
function exportCanvas() {
  const { projectName, nodes, edges } = useStore.getState()
  const graph: ProjectGraph = {
    version: 1,
    nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? 'text', position: n.position, data: n.data })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? 'out', target: e.target, targetHandle: e.targetHandle ?? 'in' })),
  }
  const blob = new Blob([JSON.stringify({ format: 'haizhu-canvas', version: 1, name: projectName, exportedAt: new Date().toISOString(), graph }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${projectName || 'canvas'}.haizhu.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

async function importCanvas(file: File) {
  const s = useStore.getState()
  try {
    const j = JSON.parse(await file.text()) as { format?: string; name?: string; graph?: ProjectGraph }
    if (j.format !== 'haizhu-canvas' || j.graph?.version !== 1 || !Array.isArray(j.graph.nodes) || !Array.isArray(j.graph.edges)) throw new Error('不是 Haizhu 画布文件')
    const p = await api.createProject(`${j.name ?? '导入的画布'}（导入）`, j.graph)
    useStore.setState({ projects: await api.listProjects() })
    await s.openProject(p.id)
    s.showToast('已导入画布。素材文件需要在本机素材库中存在才能显示。')
  } catch (e) { s.showToast(`导入失败：${(e as Error).message}`) }
}

function SaveIndicator() {
  const state = useStore((s) => s.saveState)
  const label = { idle: '', dirty: '未保存', saving: '保存中…', saved: '已保存', error: '保存失败' }[state]
  return (
    <span className={`save ${state}`} data-testid="save-state" role="status">
      {state === 'saving' && <LoaderCircle className="spin" aria-hidden="true" />}
      {state === 'saved' && <CloudCheck aria-hidden="true" />}
      {state === 'error' && <TriangleExclamationPoint aria-hidden="true" />}
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
        <div className="eyebrow">Haizhu Infinity Canvas</div>
        <h2>从一个想法，到一部成片。</h2>
        <p>把你的模型当作创作团队：导演拆分镜，画师出图，摄影成片，配音收尾。挑一个起点：</p>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button key={t.id} className="tpl" onClick={() => addTemplate(t.graph())} data-testid={`template-${t.id}`}>
              <span className="flow" aria-hidden="true">
                {t.flow.map((type, i) => {
                  const Icon = NODE_ICON[type]!
                  const d = NODE_TYPE_MAP[type]!
                  return (
                    <span key={i} style={{ display: 'contents' }}>
                      {i > 0 && <ArrowRight />}
                      <span className="chip-ico sm" style={{ '--c': CATEGORY_COLOR[d.category] } as React.CSSProperties}><Icon /></span>
                    </span>
                  )
                })}
              </span>
              <span className="nm">{t.name}</span>
              <span className="ds">{t.description}</span>
            </button>
          ))}
        </div>
        <div className="empty-actions">
          {!hasProfiles && <button className="btn primary" onClick={() => setSettingsOpen(true)}><Plus />接入第一个模型</button>}
          <button className="btn" onClick={() => openPalette()}><Sparkles />浏览全部节点 <kbd>/</kbd></button>
          <span>或从左侧拖入 · 双击空白处添加</span>
        </div>
      </div>
    </div>
  )
}

function Canvas() {
  const s = useStore()
  const { screenToFlowPosition } = useReactFlow()
  const [fitOnOpen] = useState(() => useStore.getState().nodes.length > 0)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const p = readDrag(e)
    if (!p) return
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    if ('assetId' in p) s.addNode(p.type, pos, undefined, { assetId: p.assetId, mime: p.mime, label: p.name })
    else s.addNode(p.type, pos, p.profileId)
  }, [s, screenToFlowPosition])

  // colour each edge by its source port's data type; animate it while its target runs
  const edges = useMemo<Edge[]>(() => {
    const types = new Map(s.nodes.map((n) => [n.id, n.type ?? '']))
    return s.edges.map((e) => {
      const def = NODE_TYPE_MAP[types.get(e.source) ?? '']
      const port = def?.outputs.find((p) => p.id === (e.sourceHandle ?? 'out'))
      const stroke = port ? PORT_COLOR[port.type] : undefined
      return { ...e, animated: s.runStates[e.target]?.status === 'running', style: stroke ? { stroke, strokeOpacity: 0.8 } : undefined }
    })
  }, [s.edges, s.nodes, s.runStates])

  return (
    <div className="canvas" onDrop={onDrop} onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return
        s.openPalette(screenToFlowPosition({ x: e.clientX - 150, y: e.clientY - 40 }))
      }}>
      <ReactFlow
        nodes={s.nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={s.onNodesChange} onEdgesChange={s.onEdgesChange}
        onConnect={s.onConnect} isValidConnection={s.isValidConnection}
        onMove={(_, vp) => {
          const r = document.documentElement.style
          r.setProperty('--pan-x', String(vp.x)); r.setProperty('--pan-y', String(vp.y))
          window.dispatchEvent(new Event('hzc:pan'))
        }}
        fitView={fitOnOpen} fitViewOptions={{ maxZoom: 1, minZoom: 0.6, padding: 0.12 }}
        zoomOnDoubleClick={false} onlyRenderVisibleElements={s.nodes.length > 60}
        deleteKeyCode={['Backspace', 'Delete']} minZoom={0.1} maxZoom={2}
        colorMode="system" proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} />
        {s.nodes.length > 0 && (
          <MiniMap pannable zoomable nodeBorderRadius={8} style={{ width: 168, height: 112 }}
            nodeColor={(n) => { const d = NODE_TYPE_MAP[n.type ?? '']; return d ? CATEGORY_COLOR[d.category] : '#555' }} />
        )}
      </ReactFlow>
      {s.nodes.length > 0 && <FloatingToolbar />}
      {s.nodes.length === 0 && <EmptyState />}
    </div>
  )
}

/** Fresh React Flow instance (and viewport) per opened project; panels and palette share it. */
function ProjectWorkspace({ inspector, setInspector }: { inspector: boolean; setInspector: (v: boolean) => void }) {
  const projectId = useStore((s) => s.projectId)
  const leftPanel = useStore((s) => s.leftPanel)
  return (
    <ReactFlowProvider key={projectId ?? 'none'}>
      <div className="workspace" style={{ gridTemplateColumns: `52px ${leftPanel ? 'auto' : '0'} 1fr ${inspector ? 'auto' : '0'}` }}>
        <Rail />
        <div style={{ display: 'contents' }}>
          {leftPanel && <aside className="lpanel" aria-label={leftPanel === 'assets' ? '素材库' : '组件库'}>{leftPanel === 'assets' ? <Assets /> : <Library />}</aside>}
          {!leftPanel && <span />}
        </div>
        <Canvas />
        {inspector ? <Inspector onClose={() => setInspector(false)} /> : <span />}
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
  return <div className="toast" role="status" ref={ref}><Sparkles aria-hidden="true" />{toast}</div>
}

export function App() {
  const s = useStore()
  const [inspector, setInspectorState] = useState(inspectorPref())
  const setInspector = (v: boolean) => { setInspectorState(v); setInspectorPref(v) }

  useEffect(() => { void s.init().catch((e) => s.showToast(`连接服务失败：${(e as Error).message}`)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (s.saveState !== 'dirty') return
    const t = setTimeout(() => void s.save(), 800)
    return () => clearTimeout(t)
  }, [s.saveState, s.nodes, s.edges, s.projectName]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="tb-left">
            <div className="brand">
              <span className="logo" aria-hidden="true"><InfinityIcon /></span>
              <span className="brand-name">Haizhu <span>Infinity Canvas</span></span>
              <span className="ver">{APP_VERSION}</span>
            </div>
          </div>
          <ProjectMenu />
          <div className="tb-right">
            <SaveIndicator />
            {s.runId
              ? <button className="btn danger running sm" onClick={() => void s.cancelRun()} data-testid="stop-run"><CircleStop />停止</button>
              : <button className="btn primary sm" onClick={() => void s.runNodes()} disabled={s.nodes.length === 0} data-testid="run-all"><Play />运行全部</button>}
            <button className="btn ghost sm icon" onClick={() => setInspector(!inspector)} aria-label={inspector ? '收起属性面板' : '打开属性面板'} aria-pressed={inspector} data-testid="toggle-inspector"><PanelRightOpen /></button>
            <button className="btn ghost sm" onClick={() => s.setSettingsOpen(true)} data-testid="open-settings">设置</button>
          </div>
        </header>
        <ErrorBoundary><ProjectWorkspace inspector={inspector} setInspector={setInspector} /></ErrorBoundary>
        {s.settingsOpen && <Settings />}
        <ConfirmRun />
        <Lightbox />
        <Toast />
      </div>
    </>
  )
}

export default function Root() {
  return <App />
}
