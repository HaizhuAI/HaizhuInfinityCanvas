import { create } from 'zustand'
import {
  applyEdgeChanges, applyNodeChanges, addEdge,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react'
import { NODE_TYPE_MAP, checkConnection, type GraphEdge, type GraphNode, type ModelProfilePublic, type ProjectGraph } from '@hzc/core'
import { api, type ProjectSummary } from './api'

export type CanvasNodeData = { label?: string; profileId?: string; text?: string; params?: Record<string, unknown> }
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
  addNode: (type: string, position: { x: number; y: number }, profileId?: string) => void
  setNodeData: (id: string, patch: Partial<CanvasNodeData>) => void
}

export const useStore = create<State>((set, get) => ({
  profiles: [], projects: [], projectId: null, projectName: '', nodes: [], edges: [],
  saveState: 'idle', toast: null, settingsOpen: false,

  showToast: (m) => { set({ toast: m }); setTimeout(() => get().toast === m && set({ toast: null }), 2500) },
  setSettingsOpen: (o) => set({ settingsOpen: o }),

  async loadProfiles() { set({ profiles: await api.listProfiles() }) },

  async init() {
    await get().loadProfiles()
    const projects = await api.listProjects()
    set({ projects })
    if (projects[0]) await get().openProject(projects[0].id)
    else await get().newProject()
  },

  async openProject(id) {
    const p = await api.getProject(id)
    set({ projectId: p.id, projectName: p.name, ...fromGraph(p.graph), saveState: 'saved' })
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

  addNode: (type, position, profileId) => {
    const def = NODE_TYPE_MAP[type]
    if (!def) return
    const profile = profileId ? get().profiles.find((p) => p.id === profileId) : undefined
    const node: CanvasNode = {
      id: `n_${uid()}`, type, position,
      data: { label: profile?.name ?? def.label, profileId, text: '' },
    }
    set((s) => ({ nodes: [...s.nodes, node], saveState: 'dirty' }))
  },

  setNodeData: (id, patch) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), saveState: 'dirty' })),
}))
