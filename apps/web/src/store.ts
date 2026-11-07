import { create } from 'zustand'
import {
  applyEdgeChanges, applyNodeChanges, addEdge,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react'
import { NODE_TYPE_MAP, checkConnection, type Estimate, type GraphEdge, type GraphNode, type ModelKind, type ModelProfilePublic, type NodeRunState, type NodeVersion, type ProjectGraph } from '@hzc/core'
import { api, type AssetMeta, type ProjectSummary, type SkillMeta } from './api'
import { preflight } from './preflight'
import { tidyLayout } from './layout'

export type CanvasNodeData = { label?: string; profileId?: string; text?: string; params?: Record<string, unknown>; assetId?: string; mime?: string }
export type CanvasNode = Node<CanvasNodeData>

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

/** the profile a new node of `type` should use: the one last chosen for that kind, else the first */
const LAST_PROFILE = 'hzc.lastProfile'
function lastProfiles(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LAST_PROFILE) ?? '{}') as Record<string, string> } catch { return {} }
}
export function defaultProfileFor(type: string | undefined, profiles: ModelProfilePublic[]): string | undefined {
  const kind = type ? NODE_TYPE_MAP[type]?.modelKind : undefined
  if (!kind) return undefined
  const ofKind = profiles.filter((p) => p.kind === kind)
  return (ofKind.find((p) => p.id === lastProfiles()[kind]) ?? ofKind[0])?.id
}
function rememberProfile(kind: ModelKind, id: string) {
  try { localStorage.setItem(LAST_PROFILE, JSON.stringify({ ...lastProfiles(), [kind]: id })) } catch { /* ignore */ }
}
const withDefaultProfile = (n: CanvasNode, profiles: ModelProfilePublic[]): CanvasNode =>
  n.data.profileId || !NODE_TYPE_MAP[n.type ?? '']?.modelKind ? n : { ...n, data: { ...n.data, profileId: defaultProfileFor(n.type, profiles) } }

export interface Toast { id: number; text: string; tone?: 'info' | 'error'; action?: { label: string; run: () => void } }
export type SettingsTab = 'profiles' | 'skills' | 'appearance' | 'access' | 'about'
export interface SettingsIntent { tab?: SettingsTab; addKind?: ModelKind }
/** a wire dropped on empty canvas: the quick-add palette offers nodes that fit and connects the pick */
export interface ConnectFrom { nodeId: string; handleId: string; handleType: 'source' | 'target' }

const toGraph = (nodes: CanvasNode[], edges: Edge[]): ProjectGraph => ({
  version: 1,
  nodes: nodes.map((n): GraphNode => ({ id: n.id, type: n.type ?? 'text', position: n.position, data: n.data })),
  edges: edges.map((e): GraphEdge => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? 'out', target: e.target, targetHandle: e.targetHandle ?? 'in' })),
})

const fromGraph = (g: ProjectGraph) => ({
  nodes: g.nodes.map((n): CanvasNode => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
  edges: g.edges.map((e): Edge => ({ ...e })),
})

interface State {
  profiles: ModelProfilePublic[]
  projects: ProjectSummary[]
  projectId: string | null
  projectName: string
  nodes: CanvasNode[]
  edges: Edge[]
  saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  toast: Toast | null
  settingsOpen: boolean
  /** where Settings should open (tab, or straight into "add a model" of a kind) */
  settingsIntent: SettingsIntent | null
  /** FFmpeg availability, for the pre-run check (null until known) */
  ffmpegOk: boolean | null
  /** a run waiting on the pre-run check (missing models, inputs, files) */
  pendingCheck: { nodeIds?: string[]; force?: boolean } | null
  /** ask the canvas to centre on a node (watched inside the React Flow provider) */
  focusRequest: { id: string; n: number } | null
  shortcutsOpen: boolean
  canUndo: boolean
  canRedo: boolean
  /** latest run state per node (live during a run, restored from saved outputs on open) */
  runStates: Record<string, NodeRunState>
  runId: string | null
  skills: SkillMeta[]
  assets: AssetMeta[]
  /** left panel shown next to the rail; null = collapsed */
  leftPanel: 'library' | 'assets' | null
  /** full-screen viewer; with `nodeId`, the node's kept versions can be browsed there */
  lightbox: { assetId: string; mime: string; name?: string; nodeId?: string } | null
  /** command palette; `at` = flow position to add at (double-click), else the view centre */
  palette: { open: boolean; at?: { x: number; y: number }; connect?: ConnectFrom }
  /** kept generations per node, newest first (loaded on demand) */
  versionLists: Record<string, NodeVersion[]>
  /** nodes of the current run, for the progress counter */
  runNodeIds: string[]
  /** a run waiting for the user to confirm paid generation calls */
  pendingRun: { nodeIds?: string[]; force?: boolean; estimate: Estimate } | null

  init: () => Promise<void>
  loadProfiles: () => Promise<void>
  openProject: (id: string) => Promise<void>
  newProject: () => Promise<void>
  renameProject: (name: string) => void
  save: () => Promise<void>
  setSettingsOpen: (o: boolean) => void
  openSettings: (intent?: SettingsIntent) => void
  showToast: (text: string, opts?: { action?: Toast['action']; tone?: Toast['tone']; ms?: number }) => void
  dismissToast: () => void
  /** select a node and centre the canvas on it */
  focusNode: (id: string) => void
  setShortcutsOpen: (o: boolean) => void
  /** give every node of `kind` without a usable model this profile; returns how many changed */
  bindUnbound: (kind: ModelKind, profileId: string) => number
  /** add nodes/edges as one step and select exactly them (paste, duplicate) */
  insertGraph: (nodes: CanvasNode[], edges: Edge[]) => void
  dismissCheck: () => void
  /** lay the canvas out left to right (one undo step); returns how many nodes moved */
  tidy: () => number

  onNodesChange: (c: NodeChange<CanvasNode>[]) => void
  onEdgesChange: (c: EdgeChange[]) => void
  isValidConnection: (c: Connection | Edge) => boolean
  onConnect: (c: Connection) => void
  addNode: (type: string, position: { x: number; y: number }, profileId?: string, data?: Partial<CanvasNodeData>) => string | undefined
  setNodeData: (id: string, patch: Partial<CanvasNodeData>) => void
  setNodeParam: (id: string, key: string, value: unknown) => void
  loadTemplate: (g: ProjectGraph) => void
  loadSkills: () => Promise<void>
  loadAssets: () => Promise<void>
  setLeftPanel: (p: State['leftPanel']) => void
  openLightbox: (a: State['lightbox']) => void
  /** select exactly this node (used by the inspector and keyboard flows) */
  selectNode: (id: string | null) => void
  openPalette: (at?: { x: number; y: number }, connect?: ConnectFrom) => void
  loadVersions: (nodeId: string) => Promise<NodeVersion[]>
  /** make a kept generation the node's current result */
  useVersion: (nodeId: string, seq: number) => Promise<void>
  closePalette: () => void
  /** turn a director node's storyboard into per-shot image → video (→ voice) rows; returns new node ids */
  expandStoryboard: (directorId: string) => string[]
  runNodes: (nodeIds?: string[], force?: boolean, opts?: { confirmed?: boolean; checked?: boolean }) => Promise<void>
  dismissPendingRun: () => void
  cancelRun: () => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  profiles: [], projects: [], projectId: null, projectName: '', nodes: [], edges: [],
  saveState: 'idle', toast: null, settingsOpen: false, runStates: {}, runId: null, pendingRun: null,
  skills: [], palette: { open: false }, assets: [], leftPanel: 'library', lightbox: null,
  versionLists: {}, runNodeIds: [],
  settingsIntent: null, ffmpegOk: null, pendingCheck: null, focusRequest: null, shortcutsOpen: false, canUndo: false, canRedo: false,

  showToast: (text, opts) => {
    const t: Toast = { id: Date.now() + Math.random(), text, tone: opts?.tone, action: opts?.action }
    set({ toast: t })
    setTimeout(() => get().toast?.id === t.id && set({ toast: null }), opts?.ms ?? (opts?.action ? 7000 : 2800))
  },
  dismissToast: () => set({ toast: null }),
  setSettingsOpen: (o) => set({ settingsOpen: o, settingsIntent: null }),
  openSettings: (intent) => set({ settingsOpen: true, settingsIntent: intent ?? null }),
  focusNode: (id) => { get().selectNode(id); set((s) => ({ focusRequest: { id, n: (s.focusRequest?.n ?? 0) + 1 } })) },
  setShortcutsOpen: (o) => set({ shortcutsOpen: o }),
  dismissCheck: () => set({ pendingCheck: null }),

  bindUnbound: (kind, profileId) => {
    const { nodes, profiles } = get()
    const ids = new Set(profiles.map((p) => p.id))
    let n = 0
    const next = nodes.map((nd) => {
      if (NODE_TYPE_MAP[nd.type ?? '']?.modelKind !== kind || (nd.data.profileId && ids.has(nd.data.profileId))) return nd
      n++
      return { ...nd, data: { ...nd.data, profileId } }
    })
    if (n) set({ nodes: next, saveState: 'dirty' })
    return n
  },

  tidy: () => {
    const { nodes, edges } = get()
    if (nodes.length < 2) return 0
    const pos = tidyLayout(nodes, edges)
    let moved = 0
    const next = nodes.map((n) => {
      const p = pos.get(n.id)
      if (!p || (Math.round(p.x) === Math.round(n.position.x) && Math.round(p.y) === Math.round(n.position.y))) return n
      moved++
      return { ...n, position: p }
    })
    if (moved) set({ nodes: next, saveState: 'dirty' })
    return moved
  },

  insertGraph: (nodes, edges) => set((s) => ({
    nodes: [...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...nodes.map((n) => ({ ...n, selected: true }))],
    edges: [...s.edges, ...edges],
    saveState: 'dirty',
  })),

  async loadProfiles() { set({ profiles: await api.listProfiles() }) },

  async loadSkills() { set({ skills: await api.listSkills() }) },
  async loadAssets() { set({ assets: await api.listAssets() }) },
  setLeftPanel: (p) => set({ leftPanel: p }),
  openLightbox: (a) => set({ lightbox: a }),
  selectNode: (id) => set((s) => ({ nodes: s.nodes.map((n) => (!!n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })) })),
  openPalette: (at, connect) => set({ palette: { open: true, at, connect } }),

  async loadVersions(nodeId) {
    const { projectId } = get()
    if (!projectId) return []
    const list = await api.listVersions(projectId, nodeId)
    set((s) => ({ versionLists: { ...s.versionLists, [nodeId]: list } }))
    return list
  },

  async useVersion(nodeId, seq) {
    const { projectId } = get()
    if (!projectId) return
    try {
      const r = await api.useVersion(projectId, nodeId, seq)
      set((s) => ({ runStates: { ...s.runStates, [nodeId]: { status: 'done', outputs: r.outputs, finishedAt: r.finishedAt, versions: r.versions } } }))
    } catch (e) { get().showToast(`切换失败：${(e as Error).message}`, { tone: 'error' }) }
  },
  closePalette: () => set({ palette: { open: false } }),

  expandStoryboard: (directorId) => {
    const { nodes, runStates, profiles } = get()
    const dir = nodes.find((n) => n.id === directorId)
    const sb = runStates[directorId]?.outputs?.out?.find((v) => v.type === 'storyboard')
    if (!dir || !sb || sb.type !== 'storyboard') return []
    const first = (type: string) => { const id = defaultProfileFor(type, profiles); return id ? { id } : undefined }
    const img = first('image-gen'), vid = first('video-gen'), tts = first('tts')
    const aspect = dir.data.params?.aspect_ratio
    const ROW = 480, X0 = dir.position.x + 400
    const newNodes: CanvasNode[] = []
    const newEdges: Edge[] = []
    // shots read from a video (video reverse) carry their keyframe: remake rows start from it
    const remake = sb.shots.some((s) => s.keyframe)
    sb.shots.forEach((shot, i) => {
      const y = dir.position.y + i * ROW
      const tag = `镜头 ${shot.index}`
      const imgId = `n_${uid()}`, vidId = `n_${uid()}`
      const x0 = remake ? X0 + 400 : X0
      if (shot.keyframe) {
        const kfId = `n_${uid()}`
        newNodes.push({ id: kfId, type: 'image', position: { x: X0, y }, data: { label: `${tag} · 原片关键帧`, assetId: shot.keyframe.assetId, mime: shot.keyframe.mime } })
        newEdges.push({ id: `e_${uid()}`, source: kfId, sourceHandle: 'out', target: imgId, targetHandle: 'ref' })
      }
      newNodes.push({ id: imgId, type: 'image-gen', position: { x: x0, y }, data: { label: `${tag} · 画面`, text: shot.imagePrompt, profileId: img?.id, params: aspect ? { aspect_ratio: aspect } : {} } })
      newNodes.push({ id: vidId, type: 'video-gen', position: { x: x0 + 400, y }, data: { label: `${tag} · 视频`, text: shot.videoPrompt, profileId: vid?.id, params: { ...(aspect ? { aspect_ratio: aspect } : {}), ...(shot.keyframe ? { duration: shot.duration <= 7 ? 5 : 10 } : {}) } } })
      newEdges.push({ id: `e_${uid()}`, source: imgId, sourceHandle: 'out', target: vidId, targetHandle: 'first' })
      if (shot.dialogue) {
        const ttsId = `n_${uid()}`
        newNodes.push({ id: ttsId, type: 'tts', position: { x: x0 + 800, y }, data: { label: `${tag} · 配音`, text: shot.dialogue, profileId: tts?.id, params: {} } })
      }
    })
    // one Export node at the end of the rows, wired to every shot's video (canvas order = shot
    // order), every voice line (aligned to its row) and a subtitle node (one line per shot)
    const xEnd = (remake ? X0 + 400 : X0) + 1200
    const subsId = `n_${uid()}`, exportId = `n_${uid()}`
    newNodes.push({ id: subsId, type: 'text', position: { x: xEnd - 400, y: dir.position.y + sb.shots.length * ROW }, data: { label: '字幕（每行对应一个镜头）', text: sb.shots.map((s) => s.dialogue).join('\n') } })
    newNodes.push({ id: exportId, type: 'export', position: { x: xEnd, y: dir.position.y }, data: { label: sb.title ? `成片 · ${sb.title}` : '导出成片', params: { fps: 30 } } })
    for (const n of newNodes) {
      if (n.type === 'video-gen') newEdges.push({ id: `e_${uid()}`, source: n.id, sourceHandle: 'out', target: exportId, targetHandle: 'video' })
      if (n.type === 'tts') newEdges.push({ id: `e_${uid()}`, source: n.id, sourceHandle: 'out', target: exportId, targetHandle: 'audio' })
    }
    if (sb.shots.some((s) => s.dialogue)) newEdges.push({ id: `e_${uid()}`, source: subsId, sourceHandle: 'out', target: exportId, targetHandle: 'subs' })
    set((s) => ({ nodes: [...s.nodes, ...newNodes], edges: [...s.edges, ...newEdges], saveState: 'dirty' }))
    return newNodes.map((n) => n.id)
  },

  async init() {
    void get().loadSkills().catch(() => undefined)
    void api.system().then((sys) => set({ ffmpegOk: sys.ffmpeg.ok })).catch(() => undefined)
    void get().loadAssets().catch(() => undefined)
    await get().loadProfiles()
    const projects = await api.listProjects()
    set({ projects })
    if (projects[0]) await get().openProject(projects[0].id)
    else await get().newProject()
  },

  async openProject(id) {
    const [p, outs] = await Promise.all([api.getProject(id), api.outputs(id)])
    const runStates: Record<string, NodeRunState> = {}
    for (const o of outs) runStates[o.nodeId] = { status: 'done', outputs: o.outputs, finishedAt: o.finishedAt, versions: o.versions }
    set({ projectId: p.id, projectName: p.name, ...fromGraph(p.graph), saveState: 'saved', runStates, runId: null, versionLists: {}, runNodeIds: [] })
  },

  async newProject() {
    const p = await api.createProject('未命名画布')
    set({ projects: await api.listProjects() })
    await get().openProject(p.id)
  },

  renameProject: (name) => set({ projectName: name, saveState: 'dirty' }),

  async save() {
    const { projectId, projectName, nodes, edges } = get()
    if (!projectId) return
    set({ saveState: 'saving' })
    try {
      await api.saveProject(projectId, { name: projectName, graph: toGraph(nodes, edges) })
      set({ saveState: 'saved' })
    } catch (e) {
      set({ saveState: 'error' })
      get().showToast(`保存失败：${(e as Error).message}`)
    }
  },

  onNodesChange: (c) => {
    const structural = c.some((x) => x.type !== 'select' && x.type !== 'dimensions')
    set((s) => ({ nodes: applyNodeChanges(c, s.nodes), saveState: structural ? 'dirty' : s.saveState }))
  },
  onEdgesChange: (c) => {
    const structural = c.some((x) => x.type !== 'select')
    set((s) => ({ edges: applyEdgeChanges(c, s.edges), saveState: structural ? 'dirty' : s.saveState }))
  },

  isValidConnection: (c) => {
    const { nodes, edges } = get()
    const res = checkConnection(
      nodes.map((n) => ({ id: n.id, type: n.type ?? '' })),
      toGraph(nodes, edges).edges,
      { source: c.source, sourceHandle: c.sourceHandle ?? null, target: c.target, targetHandle: c.targetHandle ?? null },
    )
    return res.ok
  },

  onConnect: (c) => set((s) => ({ edges: addEdge({ ...c, id: `e_${uid()}` }, s.edges), saveState: 'dirty' })),

  addNode: (type, position, profileId, data) => {
    const def = NODE_TYPE_MAP[type]
    if (!def) return undefined
    const profile = profileId ? get().profiles.find((p) => p.id === profileId) : undefined
    const node: CanvasNode = withDefaultProfile({
      id: `n_${uid()}`, type, position,
      data: { label: profile?.name ?? def.label, profileId, text: '', ...data },
    }, get().profiles)
    set((s) => ({ nodes: [...s.nodes, node], saveState: 'dirty' }))
    return node.id
  },

  setNodeParam: (id, key, value) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } } : n)),
      saveState: 'dirty',
    })),

  loadTemplate: (g) => {
    const { nodes, edges } = fromGraph(g)
    const bound = nodes.map((n) => withDefaultProfile(n, get().profiles))
    set((s) => ({ nodes: [...s.nodes, ...bound], edges: [...s.edges, ...edges], saveState: 'dirty' }))
  },

  dismissPendingRun: () => set({ pendingRun: null }),

  async runNodes(nodeIds, force, opts) {
    const { projectId } = get()
    if (!projectId) return
    set({ pendingRun: null, pendingCheck: null })
    // missing models / inputs / files: show what to fix first (the dialog can still run anyway)
    if (!opts?.checked && preflight(get(), nodeIds).length) { set({ pendingCheck: { nodeIds, force } }); return }
    await get().save() // the server runs the saved graph
    if (get().saveState === 'error') return
    try {
      if (!opts?.confirmed) {
        // ask before anything that generates media or has a configured price
        const estimate = await api.estimate(projectId, { nodeIds, force })
        const paid = estimate.items.some((i) => !i.cached && (i.generative || (i.cost?.amount ?? 0) > 0))
        if (paid) { set({ pendingRun: { nodeIds, force, estimate } }); return }
      }
      const { runId } = await api.run(projectId, { nodeIds, force })
      set({ runId })
      await api.streamRun(runId, (e) => {
        if (get().runId !== runId) return
        if (e.kind === 'run-start') set({ runNodeIds: e.nodeIds })
        if (e.kind === 'node') set((s) => {
          // keep the known version count while queued/running; a new generation invalidates the loaded list
          const versions = e.state.versions ?? s.runStates[e.nodeId]?.versions
          const fresh = e.state.versions !== undefined && e.state.versions !== s.runStates[e.nodeId]?.versions
          const versionLists = fresh ? Object.fromEntries(Object.entries(s.versionLists).filter(([k]) => k !== e.nodeId)) : s.versionLists
          // the saved result only changes when a run succeeds: keep showing it while (re)running or after a failure
          const outputs = e.state.outputs ?? s.runStates[e.nodeId]?.outputs
          return { runStates: { ...s.runStates, [e.nodeId]: { ...e.state, versions, outputs } }, versionLists }
        })
        if (e.kind === 'run-end') {
          set({ runId: null })
          if (e.status === 'error') {
            const { runStates, nodes } = get()
            const failed = nodes.filter((n) => runStates[n.id]?.status === 'error')
            const firstFailed = failed[0]
            const name = firstFailed ? firstFailed.data.label ?? NODE_TYPE_MAP[firstFailed.type ?? '']?.label ?? '节点' : ''
            get().showToast(failed.length > 1 ? `运行结束：${failed.length} 个节点失败` : `运行结束：「${name}」失败`, {
              tone: 'error',
              action: firstFailed ? { label: '查看原因', run: () => get().focusNode(firstFailed.id) } : undefined,
            })
          }
          if (e.status === 'done') get().showToast('运行完成')
          if (e.status === 'cancelled') get().showToast('已停止')
        }
      })
    } catch (e) {
      set({ runId: null })
      get().showToast(`运行失败：${(e as Error).message}`)
    }
  },

  async cancelRun() {
    const { runId } = get()
    if (runId) await api.cancelRun(runId).catch(() => undefined)
  },

  setNodeData: (id, patch) => {
    if (patch.profileId) {
      const kind = NODE_TYPE_MAP[get().nodes.find((n) => n.id === id)?.type ?? '']?.modelKind
      if (kind) rememberProfile(kind, patch.profileId)
    }
    set((s) => {
      // editing a failed node is usually the fix: drop its stale error (results of other nodes stay)
      const failed = s.runStates[id]?.status === 'error' || s.runStates[id]?.status === 'skipped'
      const runStates = failed ? Object.fromEntries(Object.entries(s.runStates).filter(([k]) => k !== id)) : s.runStates
      return { nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), runStates, saveState: 'dirty' }
    })
  },
}))
