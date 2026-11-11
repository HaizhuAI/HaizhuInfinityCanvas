import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, useStore as useFlowStore, type Edge, type NodeMouseHandler, type OnConnectEnd, type OnMove, type OnNodeDrag } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowRight, Check, ChevronDown, Download, FileUp, CircleStop, CloudCheck, Infinity as InfinityIcon, Info, LoaderCircle, Package, PanelRightOpen, Play, Plus, Sparkles, TriangleExclamationPoint, Keyboard, LayoutGrid, Moon, Sun, X } from 'lucide-react'
import { NODE_TYPE_MAP } from '@hzc/core'
import { HzcNode } from './CanvasNode'
import { FloatingToolbar, Lightbox, Rail } from './Chrome'
import { CanvasHelpers, ContextMenu, PreflightDialog, ShortcutsSheet, ToastView, useEscape, type CtxMenu } from './Overlays'
import { copySelection, duplicateSelection, leaveCopies, paste } from './clipboard'
import { initHistory, redo, undo } from './history'
import { CommandPalette } from './CommandPalette'
import { DND_MIME, readDrag } from './dnd'
import { CATEGORY_COLOR, NODE_ICON, PORT_COLOR } from './icons'
import { Inspector } from './Inspector'
import { Assistant } from './Assistant'
import { CompareSetup, CompareView } from './Compare'
import { Projects } from './Projects'
import { Assets, Library, PromptLibrary } from './LeftPanel'
import { enterMenu, enterOverlay } from './motion'
import { Settings } from './Settings'
import { Starfield, setParallax } from './Starfield'
import { TEMPLATES } from './templates'
import { inspectorPref, setInspectorPref, resolvedTheme, setThemePref } from './theme'
import { useAddNode } from './useAddNode'
import { useStore, type CanvasNode, type State } from './store'
import { useShallow } from 'zustand/react/shallow'
import { api, bundleUrl } from './api'
import type { ProjectGraph } from '@hzc/core'

export const APP_VERSION = 'v1.0.0-rc.7'

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
  useEscape(dismiss, !!pending)
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
          <button className="btn primary" onClick={() => void runNodes(pending.nodeIds, pending.force, { confirmed: true, checked: true })} data-testid="confirm-run"><Play />确认运行</button>
        </div>
      </div>
    </div>
  )
}

/** Centre of the top bar: the canvas name (inline rename) with a menu to switch or create canvases. */
function ProjectMenu() {
  const { projects, projectId, projectName } = useStore(useShallow((s) => ({ projects: s.projects, projectId: s.projectId, projectName: s.projectName })))
  const { openProject, newProject, renameProject } = useStore.getState()
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
      <input ref={fileRef} type="file" accept=".hzc,.zip,.json,application/json,application/zip" hidden data-testid="import-file" onChange={(e) => { const f = e.target.files?.[0]; setOpen(false); if (f) void importCanvas(f); e.target.value = '' }} />
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
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); useStore.getState().setProjectsOpen(true) }} data-testid="manage-projects"><LayoutGrid aria-hidden="true" />管理全部画布…</button>
          <div className="menu-sep" />
          <div className="menu-label">备份与分享</div>
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); void exportBundle() }} data-testid="export-bundle"><Package aria-hidden="true" /><span className="grow">导出项目包<small>.hzc · 含素材与生成结果</small></span></button>
          <button role="menuitem" className="menu-item" onClick={() => { setOpen(false); exportCanvas() }} data-testid="export-canvas"><Download aria-hidden="true" /><span className="grow">仅导出画布结构<small>.json · 不含素材，适合当模板</small></span></button>
          <button role="menuitem" className="menu-item" onClick={() => fileRef.current?.click()} data-testid="import-canvas"><FileUp aria-hidden="true" />导入项目包或画布文件…</button>
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

/** Saves first (the server bundles the saved graph), then lets the browser download the .hzc. */
async function exportBundle() {
  const s = useStore.getState()
  if (!s.projectId) return
  await s.save()
  if (useStore.getState().saveState === 'error') return
  const a = document.createElement('a')
  a.href = bundleUrl(s.projectId)
  a.download = `${s.projectName || 'canvas'}.hzc`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function importCanvas(file: File) {
  const s = useStore.getState()
  try {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
    if (head[0] === 0x50 && head[1] === 0x4b) { // "PK": a project bundle
      s.showToast('正在导入项目包…')
      const r = await api.importBundle(file)
      useStore.setState({ projects: await api.listProjects() })
      await s.openProject(r.project.id)
      void s.loadAssets()
      s.showToast(`已导入：${r.assets} 个素材、${r.results} 个生成结果${r.missing ? `；${r.missing} 个文件无法导入` : ''}`)
      return
    }
    const j = JSON.parse(await file.text()) as { format?: string; name?: string; graph?: ProjectGraph }
    if (j.format !== 'haizhu-canvas' || j.graph?.version !== 1 || !Array.isArray(j.graph.nodes) || !Array.isArray(j.graph.edges)) throw new Error('不是 Haizhu 画布文件')
    const p = await api.createProject(`${j.name ?? '导入的画布'}（导入）`, j.graph)
    useStore.setState({ projects: await api.listProjects() })
    await s.openProject(p.id)
    s.showToast('已导入画布。素材文件需要在本机素材库中存在才能显示。')
  } catch (e) { s.showToast(`导入失败：${(e as Error).message}`) }
}

const MOD_LABEL = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'

/** Upload media files (dropped on the canvas or pasted) and add one input node per file. */
async function addMediaFiles(files: File[], at?: { x: number; y: number }) {
  const s = useStore.getState()
  const media = files.filter((f) => /^(image|video|audio)\//.test(f.type)).slice(0, 12)
  if (!media.length) { s.showToast('只能放入图片、视频或音频文件', { tone: 'error' }); return }
  const el = document.querySelector('.react-flow__viewport') as HTMLElement | null
  // without a drop point, place near the top-left of the visible canvas
  const m = el ? new DOMMatrixReadOnly(getComputedStyle(el).transform) : new DOMMatrixReadOnly()
  const base = at ?? { x: (80 - m.e) / (m.a || 1), y: (80 - m.f) / (m.a || 1) }
  s.showToast(`正在上传 ${media.length} 个文件…`)
  let i = 0
  for (const f of media) {
    try {
      const a = await api.uploadAsset(f)
      const kind = f.type.split('/')[0]!
      s.addNode(kind, { x: base.x + (i % 4) * 320, y: base.y + Math.floor(i / 4) * 300 }, undefined, { assetId: a.id, mime: a.mime, label: f.name || '粘贴的' + ({ image: '图片', video: '视频', audio: '音频' }[kind] ?? '文件') })
      i++
    } catch (e) { s.showToast(`上传失败：${(e as Error).message}`, { tone: 'error' }) }
  }
  if (i) { void s.loadAssets(); s.showToast(`已添加 ${i} 个素材节点`) }
}

/** quick light / dark switch (Settings › 外观 still offers "follow the system") */
function ThemeToggle() {
  const [theme, setTheme] = useState(resolvedTheme())
  useEffect(() => { const on = (e: Event) => setTheme((e as CustomEvent<'dark' | 'light'>).detail); window.addEventListener('hzc:theme', on); return () => window.removeEventListener('hzc:theme', on) }, [])
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button className="btn ghost sm icon" onClick={() => setThemePref(next)} aria-label={next === 'light' ? '切换到浅色' : '切换到深色'} title={next === 'light' ? '切换到浅色' : '切换到深色'} data-testid="theme-toggle">
      {theme === 'dark' ? <Sun /> : <Moon />}
    </button>
  )
}

/** "运行中 2 / 5" while a run is in progress */
function RunProgress() {
  const ids = useStore((s) => s.runNodeIds)
  const done = useStore((s) => ids.filter((id) => ['done', 'cached', 'error', 'skipped', 'cancelled'].includes(s.runStates[id]?.status ?? '')).length)
  // independent nodes run at the same time: say how many are going right now
  const active = useStore((s) => ids.filter((id) => s.runStates[id]?.status === 'running').length)
  if (!ids.length) return null
  return (
    <span className="run-progress" role="status" data-testid="run-progress" title={active > 1 ? `${active} 个节点正在同时运行` : undefined}>
      <span className="bar" style={{ '--p': `${Math.round((done / ids.length) * 100)}%` } as React.CSSProperties} aria-hidden="true" />
      运行中 {done} / {ids.length}{active > 1 && <span className="par" data-testid="run-parallel">· 同时 {active} 个</span>}
    </span>
  )
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
  const openSettings = useStore((s) => s.openSettings)
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
          {TEMPLATES.filter((t) => t.featured).map((t) => (
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
          {!hasProfiles && <button className="btn primary" onClick={() => openSettings({ addKind: 'llm' })} data-testid="empty-add-model"><Plus />接入第一个模型</button>}
          <button className="btn" onClick={() => openPalette()}><Sparkles />浏览全部节点 <kbd>/</kbd></button>
          <span>或从左侧拖入 · 双击空白处添加</span>
        </div>
      </div>
    </div>
  )
}

/** ids of running nodes as one string (a stable selector value): their incoming wires animate */
const runningKey = (st: State) => Object.keys(st.runStates).filter((id) => st.runStates[id]!.status === 'running').sort().join(',')
const miniColor = (n: { type?: string }) => { const d = NODE_TYPE_MAP[n.type ?? '']; return d ? CATEGORY_COLOR[d.category] : '#555' }
const MINIMAP_STYLE = { width: 168, height: 112 }
const FAR_ZOOM = 0.4
const FIT_ON_OPEN = { maxZoom: 1, minZoom: 0.6, padding: 0.12 }
const SNAP_GRID: [number, number] = [24, 24]
const PAN_BUTTONS = [0, 1]
const DELETE_KEYS = ['Backspace', 'Delete']
const PRO_OPTIONS = { hideAttribution: true }
type StyledEdge = { src: Edge; stroke?: string; animated: boolean; out: Edge }

function Canvas() {
  // subscribe to what the canvas draws, not the whole store: typing in a node must not re-render the app
  const nodes = useStore((st) => st.nodes)
  const rawEdges = useStore((st) => st.edges)
  const snap = useStore((st) => st.snap)
  const minimap = useStore((st) => st.minimap)
  const running = useStore(runningKey)
  const s = useStore.getState() // actions only (they never change)
  // zoomed far out the text is unreadable: skip painting it (layout unchanged, so nothing moves)
  const far = useFlowStore((st) => st.transform[2] < FAR_ZOOM)
  const { screenToFlowPosition } = useReactFlow()
  const [fitOnOpen] = useState(() => useStore.getState().nodes.length > 0)
  const [ctx, setCtx] = useState<CtxMenu>(null)
  const closeCtx = useCallback(() => setCtx(null), [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    if (e.dataTransfer.files.length && !e.dataTransfer.types.includes(DND_MIME)) { void addMediaFiles(Array.from(e.dataTransfer.files), pos); return }
    const p = readDrag(e)
    if (!p) return
    if ('assetId' in p) s.addNode(p.type, pos, undefined, { assetId: p.assetId, mime: p.mime, label: p.name })
    else if ('text' in p) s.addNode('text', pos, undefined, { text: p.text, label: p.label ?? '提示词' })
    else s.addNode(p.type, pos, p.profileId)
  }, [s, screenToFlowPosition])

  // Handlers passed to React Flow must keep their identity: some (e.g. onNodeContextMenu) are handed to
  // every node, and a new function each render would re-render all nodes on every keystroke.
  const onConnectEnd = useCallback<OnConnectEnd>((e, c) => {
    // a wire dropped on empty canvas: offer the nodes that fit, connect the one picked
    if (c.toNode || !c.fromNode || !c.fromHandle) return
    const p = 'changedTouches' in e ? e.changedTouches[0]! : e
    const at = screenToFlowPosition({ x: p.clientX, y: p.clientY })
    const out = c.fromHandle.type === 'source'
    useStore.getState().openPalette({ x: out ? at.x + 10 : at.x - 310, y: at.y - 60 }, { nodeId: c.fromNode.id, handleId: c.fromHandle.id ?? (out ? 'out' : 'in'), handleType: c.fromHandle.type })
  }, [screenToFlowPosition])
  const onNodeContextMenu = useCallback<NodeMouseHandler<CanvasNode>>((e, node) => {
    e.preventDefault()
    if (!node.selected) useStore.getState().selectNode(node.id)
    setCtx({ x: e.clientX, y: e.clientY, nodeId: node.id })
  }, [])
  const onPaneContextMenu = useCallback((e: MouseEvent | React.MouseEvent) => {
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY, at: screenToFlowPosition({ x: e.clientX - 150, y: e.clientY - 40 }) })
  }, [screenToFlowPosition])
  const onMove = useCallback<OnMove>((_, vp) => setParallax(vp.x, vp.y), [])
  const onNodeDragStart = useCallback<OnNodeDrag<CanvasNode>>((e, _n, dragged) => {
    if (e.altKey && leaveCopies(dragged.map((d) => d.id))) useStore.getState().showToast('已复制（按住 Alt 拖动）', { action: { label: '撤销', run: () => void undo() } })
  }, [])

  // colour each edge by its source port's data type; animate it while its target runs. Unchanged edges
  // keep their object, so editing one node doesn't make React Flow redraw every wire.
  const edgeCache = useRef(new Map<string, StyledEdge>())
  const edges = useMemo<Edge[]>(() => {
    const types = new Map(nodes.map((n) => [n.id, n.type ?? '']))
    const live = new Set(running ? running.split(',') : [])
    const next = new Map<string, StyledEdge>()
    const out = rawEdges.map((e) => {
      const def = NODE_TYPE_MAP[types.get(e.source) ?? '']
      const port = def?.outputs.find((p) => p.id === (e.sourceHandle ?? 'out'))
      const stroke = port ? PORT_COLOR[port.type] : undefined
      const animated = live.has(e.target)
      const c = edgeCache.current.get(e.id)
      const hit = c && c.src === e && c.stroke === stroke && c.animated === animated
        ? c : { src: e, stroke, animated, out: { ...e, animated, style: stroke ? { stroke, strokeOpacity: 0.8 } : undefined } }
      next.set(e.id, hit)
      return hit.out
    })
    edgeCache.current = next
    return out
  }, [rawEdges, nodes, running])

  return (
    <div className={`canvas${far ? ' far' : ''}`} onDrop={onDrop} onDragOver={(e) => { if (e.dataTransfer.types.includes(DND_MIME) || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDoubleClick={(e) => {
        if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return
        s.openPalette(screenToFlowPosition({ x: e.clientX - 150, y: e.clientY - 40 }))
      }}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={s.onNodesChange} onEdgesChange={s.onEdgesChange}
        onConnect={s.onConnect} isValidConnection={s.isValidConnection}
        onConnectEnd={onConnectEnd} onNodeContextMenu={onNodeContextMenu} onPaneContextMenu={onPaneContextMenu}
        onMove={onMove} onNodeDragStart={onNodeDragStart}
        fitView={fitOnOpen} fitViewOptions={FIT_ON_OPEN}
        zoomOnDoubleClick={false} onlyRenderVisibleElements={nodes.length > 60}
        snapToGrid={snap} snapGrid={SNAP_GRID} panOnDrag={PAN_BUTTONS}
        deleteKeyCode={DELETE_KEYS} minZoom={0.1} maxZoom={2}
        colorMode="system" proOptions={PRO_OPTIONS}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} />
        {nodes.length > 0 && minimap && <MiniMap pannable zoomable nodeBorderRadius={8} style={MINIMAP_STYLE} nodeColor={miniColor} />}
      </ReactFlow>
      {nodes.length > 0 && <FloatingToolbar />}
      {ctx && <ContextMenu menu={ctx} onClose={closeCtx} />}
      {nodes.length === 0 && <EmptyState />}
    </div>
  )
}

/** Right side: the selected node's properties, or the canvas assistant. */
function RightPanel({ onClose }: { onClose: () => void }) {
  const tab = useStore((s) => s.rightTab)
  const setTab = useStore((s) => s.setRightTab)
  const busy = useStore((s) => s.assistantBusy)
  return (
    <div className="rpanel">
      <div className="rtabs" role="tablist" aria-label="右侧面板">
        <button role="tab" aria-selected={tab === 'inspector'} className={tab === 'inspector' ? 'on' : ''} onClick={() => setTab('inspector')} data-testid="tab-inspector">属性</button>
        <button role="tab" aria-selected={tab === 'assistant'} className={tab === 'assistant' ? 'on' : ''} onClick={() => setTab('assistant')} data-testid="tab-assistant">
          {busy ? <span className="orbit" style={{ '--s': '12px' } as React.CSSProperties} aria-hidden="true" /> : <Sparkles aria-hidden="true" />}助手
        </button>
      </div>
      {tab === 'inspector' ? <Inspector onClose={onClose} /> : <Assistant />}
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
          {leftPanel && <aside className="lpanel" aria-label={leftPanel === 'assets' ? '素材库' : leftPanel === 'prompts' ? '提示词库' : '组件库'}>{leftPanel === 'assets' ? <Assets /> : leftPanel === 'prompts' ? <PromptLibrary /> : <Library />}</aside>}
          {!leftPanel && <span />}
        </div>
        <Canvas />
        {inspector ? <RightPanel onClose={() => setInspector(false)} /> : <span />}
      </div>
      <CommandPalette />
      <CanvasHelpers />
    </ReactFlowProvider>
  )
}

/** save 0.8 s after the last edit (subscribes outside React: edits must not re-render the app) */
function useAutosave() {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const unsub = useStore.subscribe((st, prev) => {
      if (st.saveState === prev.saveState && st.nodes === prev.nodes && st.edges === prev.edges && st.projectName === prev.projectName) return
      clearTimeout(t)
      if (st.saveState === 'dirty') t = setTimeout(() => void useStore.getState().save(), 800)
    })
    return () => { clearTimeout(t); unsub() }
  }, [])
}

export function App() {
  const settingsOpen = useStore((st) => st.settingsOpen)
  const runId = useStore((st) => st.runId)
  const hasNodes = useStore((st) => st.nodes.length > 0)
  const rightTab = useStore((st) => st.rightTab)
  const s = useStore.getState() // actions only
  const [inspector, setInspectorState] = useState(inspectorPref())
  const setInspector = (v: boolean) => { setInspectorState(v); setInspectorPref(v) }

  useEffect(() => { void s.init().catch((e) => s.showToast(`连接服务失败：${(e as Error).message}`)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useAutosave()

  useEffect(() => {
    initHistory()
    const pasteNodes = () => {
      const n = paste()
      if (n) useStore.getState().showToast(`已粘贴 ${n} 个节点`, { action: { label: '撤销', run: () => void undo() } })
      return n
    }
    // Ctrl+V normally arrives as a paste event (which can carry files); if none follows, paste nodes
    let pasteSeen = false
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState()
      const editing = !!(e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')
      const overlay = st.settingsOpen || st.palette.open || !!st.pendingRun || !!st.pendingCheck || st.shortcutsOpen || !!st.lightbox || st.projectsOpen || !!st.compareSetup || !!st.compareView
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'Enter' && !overlay) { e.preventDefault(); if (!st.runId && st.nodes.length) void st.runNodes(); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void st.save().then(() => { if (useStore.getState().saveState === 'saved') st.showToast('已保存') }); return }
      if (editing || overlay || e.altKey) return
      if (e.key === 'Escape' && !mod) { if (st.nodes.some((n) => n.selected)) useStore.setState({ nodes: st.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)) }); return }
      if (e.key === '/' && !mod) { e.preventDefault(); st.openPalette(); return }
      if (e.key === '?' && !mod) { e.preventDefault(); st.setShortcutsOpen(true); return }
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (!undo()) st.showToast('没有可以撤销的操作'); return }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); if (!redo()) st.showToast('没有可以重做的操作'); return }
      if (k === 'c') {
        if (window.getSelection()?.toString()) return // copying selected text: leave it to the browser
        const n = copySelection()
        if (n) { e.preventDefault(); st.showToast(`已复制 ${n} 个节点，${MOD_LABEL} V 粘贴`) }
        return
      }
      if (k === 'v') { pasteSeen = false; setTimeout(() => { if (!pasteSeen) pasteNodes() }, 80); return }
      if (k === 'd') { e.preventDefault(); const n = duplicateSelection(); if (n) st.showToast(`已创建 ${n} 个副本`, { action: { label: '撤销', run: () => void undo() } }); return }
      if (k === 'a') { e.preventDefault(); useStore.setState({ nodes: st.nodes.map((n) => (n.selected ? n : { ...n, selected: true })) }) }
    }
    // paste: media files from the system clipboard become nodes; otherwise copied nodes are pasted
    const onPaste = (e: ClipboardEvent) => {
      pasteSeen = true
      const st = useStore.getState()
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]') || st.settingsOpen || st.palette.open) return
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => /^(image|video|audio)\//.test(f.type))
      if (files.length) { e.preventDefault(); void addMediaFiles(files); return }
      if (pasteNodes()) e.preventDefault()
    }
    // arrow keys nudge the selection: 1 px, Shift 10 px, one grid step while snapping. Captured on the
    // window so the canvas's own (focused-node-only, 5 px) arrow handling doesn't move it a second time.
    const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const onArrow = (e: KeyboardEvent) => {
      const dir = ARROWS[e.key]
      if (!dir || e.metaKey || e.ctrlKey || e.altKey) return
      const st = useStore.getState()
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], .assistant, .lpanel, [role="menu"]')) return
      if (st.settingsOpen || st.palette.open || st.pendingRun || st.pendingCheck || st.shortcutsOpen || st.lightbox || st.projectsOpen || st.compareSetup || st.compareView) return
      const step = st.snap ? 24 : e.shiftKey ? 10 : 1
      if (st.nudge(dir[0] * step, dir[1] * step)) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onArrow, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    return () => { window.removeEventListener('keydown', onArrow, true); window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste) }
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
            {runId && <RunProgress />}
            {runId
              ? <button className="btn danger running sm" onClick={() => void s.cancelRun()} data-testid="stop-run"><CircleStop />停止</button>
              : <button className="btn primary sm" onClick={() => void s.runNodes()} disabled={!hasNodes} data-testid="run-all"><Play />运行全部</button>}
            <button className="btn ghost sm icon" onClick={() => setInspector(!inspector)} aria-label={inspector ? '收起属性面板' : '打开属性面板'} aria-pressed={inspector} data-testid="toggle-inspector"><PanelRightOpen /></button>
            <button className={`btn sm${inspector && rightTab === 'assistant' ? ' on' : ''}`} onClick={() => { if (inspector && rightTab === 'assistant') setInspector(false); else { setInspector(true); s.setRightTab('assistant') } }} aria-pressed={inspector && rightTab === 'assistant'} title="画布助手：一句话搭节点" data-testid="open-assistant"><Sparkles />助手</button>
            <ThemeToggle />
            <button className="btn ghost sm icon" onClick={() => s.setShortcutsOpen(true)} aria-label="快捷键" title="快捷键（?）" data-testid="open-shortcuts"><Keyboard /></button>
            <button className="btn ghost sm" onClick={() => s.setSettingsOpen(true)} data-testid="open-settings">设置</button>
          </div>
        </header>
        <ErrorBoundary><ProjectWorkspace inspector={inspector} setInspector={setInspector} /></ErrorBoundary>
        <PreflightDialog />
        {settingsOpen && <Settings />}
        <ConfirmRun />
        <ShortcutsSheet />
        <Projects />
        <Lightbox />
        <CompareSetup />
        <CompareView />
        <ToastView />
      </div>
    </>
  )
}

export default function Root() {
  return <App />
}
