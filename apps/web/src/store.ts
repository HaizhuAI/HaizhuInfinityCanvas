import { create } from 'zustand'
import {
  applyEdgeChanges, applyNodeChanges, addEdge,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react'
import { NODE_TYPE_MAP, checkConnection, type Estimate, type GraphEdge, type GraphNode, type ModelProfilePublic, type NodeRunState, type ProjectGraph } from '@hzc/core'
import { api, type AssetMeta, type ProjectSummary, type SkillMeta } from './api'

export type CanvasNodeData = { label?: string; profileId?: string; text?: string; params?: Record<string, unknown>; assetId?: string; mime?: string }
export type CanvasNode = Node<CanvasNodeData>

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

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
  toast: string | null
  settingsOpen: boolean
  /** latest run state per node (live during a run, restored from saved outputs on open) */
  runStates: Record<string, NodeRunState>
  runId: string | null
  skills: SkillMeta[]
  assets: AssetMeta[]
  /** left panel shown next to the rail; null = collapsed */
  leftPanel: 'library' | 'assets' | null
  lightbox: { assetId: string; mime: string; name?: string } | null
  /** command palette; `at` = flow position to add at (double-click), else the view centre */
  palette: { open: boolean; at?: { x: number; y: number } }
  /** a run waiting for the user to confirm paid generation calls */
  pendingRun: { nodeIds?: string[]; force?: boolean; estimate: Estimate } | null

  init: () => Promise<void>
  loadProfiles: () => Promise<void>
  openProject: (id: string) => Promise<void>
  newProject: () => Promise<void>
  renameProject: (name: string) => void
  save: () => Promise<void>
  setSettingsOpen: (o: boolean) => void
  showToast: (m: string) => void

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
  openPalette: (at?: { x: number; y: number }) => void
  closePalette: () => void
  /** turn a director node's storyboard into per-shot image → video (→ voice) rows; returns new node ids */
  expandStoryboard: (directorId: string) => string[]
  runNodes: (nodeIds?: string[], force?: boolean, confirmed?: boolean) => Promise<void>
  dismissPendingRun: () => void
  cancelRun: () => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  profiles: [], projects: [], projectId: null, projectName: '', nodes: [], edges: [],
  saveState: 'idle', toast: null, settingsOpen: false, runStates: {}, runId: null, pendingRun: null,
  skills: [], palette: { open: false }, assets: [], leftPanel: 'library', lightbox: null,

  showToast: (m) => { set({ toast: m }); setTimeout(() => get().toast === m && set({ toast: null }), 2500) },
  setSettingsOpen: (o) => set({ settingsOpen: o }),

  async loadProfiles() { set({ profiles: await api.listProfiles() }) },

  async loadSkills() { set({ skills: await api.listSkills() }) },
  async loadAssets() { set({ assets: await api.listAssets() }) },
  setLeftPanel: (p) => set({ leftPanel: p }),
  openLightbox: (a) => set({ lightbox: a }),
  selectNode: (id) => set((s) => ({ nodes: s.nodes.map((n) => (!!n.selected === (n.id === id) ? n : { ...n, selected: n.id === id })) })),
  openPalette: (at) => set({ palette: { open: true, at } }),
  closePalette: () => set({ palette: { open: false } }),

  expandStoryboard: (directorId) => {
    const { nodes, runStates, profiles } = get()
    const dir = nodes.find((n) => n.id === directorId)
    const sb = runStates[directorId]?.outputs?.out?.find((v) => v.type === 'storyboard')
    if (!dir || !sb || sb.type !== 'storyboard') return []
    const first = (kind: ModelProfilePublic['kind']) => profiles.find((p) => p.kind === kind)
    const img = first('image'), vid = first('video'), tts = first('tts')
    const aspect = dir.data.params?.aspect_ratio
    const ROW = 480, X0 = dir.position.x + 400
    const newNodes: CanvasNode[] = []
    const newEdges: Edge[] = []
    sb.shots.forEach((shot, i) => {
      const y = dir.position.y + i * ROW
      const tag = `镜头 ${shot.index}`
      const imgId = `n_${uid()}`, vidId = `n_${uid()}`
      newNodes.push({ id: imgId, type: 'image-gen', position: { x: X0, y }, data: { label: `${tag} · 画面`, text: shot.imagePrompt, profileId: img?.id, params: aspect ? { aspect_ratio: aspect } : {} } })
      newNodes.push({ id: vidId, type: 'video-gen', position: { x: X0 + 400, y }, data: { label: `${tag} · 视频`, text: shot.videoPrompt, profileId: vid?.id, params: { ...(aspect ? { aspect_ratio: aspect } : {}) } } })
      newEdges.push({ id: `e_${uid()}`, source: imgId, sourceHandle: 'out', target: vidId, targetHandle: 'first' })
      if (shot.dialogue) {
        const ttsId = `n_${uid()}`
        newNodes.push({ id: ttsId, type: 'tts', position: { x: X0 + 800, y }, data: { label: `${tag} · 配音`, text: shot.dialogue, profileId: tts?.id, params: {} } })
      }
    })
    set((s) => ({ nodes: [...s.nodes, ...newNodes], edges: [...s.edges, ...newEdges], saveState: 'dirty' }))
    return newNodes.map((n) => n.id)
  },

  async init() {
    void get().loadSkills().catch(() => undefined)
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
    for (const o of outs) runStates[o.nodeId] = { status: 'done', outputs: o.outputs, finishedAt: o.finishedAt }
    set({ projectId: p.id, projectName: p.name, ...fromGraph(p.graph), saveState: 'saved', runStates, runId: null })
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
    const node: CanvasNode = {
      id: `n_${uid()}`, type, position,
      data: { label: profile?.name ?? def.label, profileId, text: '', ...data },
    }
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
    set((s) => ({ nodes: [...s.nodes, ...nodes], edges: [...s.edges, ...edges], saveState: 'dirty' }))
  },

  dismissPendingRun: () => set({ pendingRun: null }),

  async runNodes(nodeIds, force, confirmed) {
    const { projectId } = get()
    if (!projectId) return
    set({ pendingRun: null })
    await get().save() // the server runs the saved graph
    if (get().saveState === 'error') return
    try {
      if (!confirmed) {
        // ask before anything that generates media or has a configured price
        const estimate = await api.estimate(projectId, { nodeIds, force })
        const paid = estimate.items.some((i) => !i.cached && (i.generative || (i.cost?.amount ?? 0) > 0))
        if (paid) { set({ pendingRun: { nodeIds, force, estimate } }); return }
      }
      const { runId } = await api.run(projectId, { nodeIds, force })
      set({ runId })
      await api.streamRun(runId, (e) => {
        if (get().runId !== runId) return
        if (e.kind === 'node') set((s) => ({ runStates: { ...s.runStates, [e.nodeId]: e.state } }))
        if (e.kind === 'run-end') {
          set({ runId: null })
          if (e.status === 'error') get().showToast('运行结束：有节点失败，详情见节点')
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

  setNodeData: (id, patch) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), saveState: 'dirty' })),
}))
