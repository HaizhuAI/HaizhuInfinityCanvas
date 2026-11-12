import { create } from 'zustand'
import {
  applyEdgeChanges, applyNodeChanges, addEdge,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from '@xyflow/react'
import { NODE_TYPE_MAP, addCompareVariants, checkConnection, dissolveCompare, pickCompareWinner, type Estimate, type GraphEdge, type GraphNode, type ModelKind, type ModelProfilePublic, type NodeRunState, type NodeVersion, type ProjectGraph } from '@hzc/core'
import { api, auth, markBooted, type Me, type AssetMeta, type Plan, type ProjectSummary, type SavedPrompt, type SkillMeta } from './api'
import { preflight } from './preflight'
import { tidyLayout } from './layout'
import { setViewPref, viewPref } from './theme'
import { clearDraft, readDraft, sameGraph, writeDraft } from './draft'

export type CanvasNodeData = { label?: string; profileId?: string; text?: string; params?: Record<string, unknown>; assetId?: string; mime?: string; /** multi-model comparison group */ compare?: string }
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
export type SettingsTab = 'profiles' | 'skills' | 'appearance' | 'access' | 'account' | 'about'
export interface SettingsIntent { tab?: SettingsTab; addKind?: ModelKind }
/** one turn of the canvas assistant conversation */
export interface AssistantTurn { role: 'user' | 'assistant'; content: string; plan?: Plan | null; warnings?: string[]; applied?: string[]; error?: boolean }

/** a wire dropped on empty canvas: the quick-add palette offers nodes that fit and connects the pick */
export interface ConnectFrom { nodeId: string; handleId: string; handleType: 'source' | 'target' }

/** nodes whose own text is a prompt (the prompt library adds to it) */
const PROMPT_TYPES = new Set(['text', 'image-gen', 'video-gen', 'llm', 'tts', 'director'])
/** the input port that replaces a node's own text when connected */
const PROMPT_PORT: Record<string, string> = { 'image-gen': 'prompt', 'video-gen': 'prompt', llm: 'in', tts: 'in', director: 'in' }

/** the assistant conversation is kept per canvas in this browser */
const turnsKey = (projectId: string) => `hzc.assistant.${projectId}`
function loadTurns(projectId: string): AssistantTurn[] {
  try { return (JSON.parse(localStorage.getItem(turnsKey(projectId)) ?? '[]') as AssistantTurn[]).slice(-40) } catch { return [] }
}
function saveTurns(projectId: string | null, turns: AssistantTurn[]) {
  if (!projectId) return
  try { localStorage.setItem(turnsKey(projectId), JSON.stringify(turns.slice(-40))) } catch { /* full or blocked */ }
}

const toGraph = (nodes: CanvasNode[], edges: Edge[]): ProjectGraph => ({
  version: 1,
  nodes: nodes.map((n): GraphNode => ({ id: n.id, type: n.type ?? 'text', position: n.position, data: n.data })),
  edges: edges.map((e): GraphEdge => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? 'out', target: e.target, targetHandle: e.targetHandle ?? 'in' })),
})

const fromGraph = (g: ProjectGraph) => ({
  nodes: g.nodes.map((n): CanvasNode => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
  edges: g.edges.map((e): Edge => ({ ...e })),
})

export interface State {
  profiles: ModelProfilePublic[]
  projects: ProjectSummary[]
  projectId: string | null
  projectName: string
  nodes: CanvasNode[]
  edges: Edge[]
  saveState: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  /** consecutive failed saves (autosave retries with growing pauses; 0 after a success) */
  saveFailures: number
  /** the last failed save cannot succeed by retrying (the canvas was deleted, or is invalid / too large) */
  saveBlocked: boolean
  toast: Toast | null
  settingsOpen: boolean
  /** where Settings should open (tab, or straight into "add a model" of a kind) */
  settingsIntent: SettingsIntent | null
  /** multi-user deployment: the signed-in account (null in a one-person install or until known) */
  account: Me | null
  accounts: boolean
  /** FFmpeg availability, for the pre-run check (null until known) */
  ffmpegOk: boolean | null
  /** how many model calls the server runs at once, over all models */
  maxParallel: number
  /** a run waiting on the pre-run check (missing models, inputs, files) */
  pendingCheck: { nodeIds?: string[]; force?: boolean } | null
  /** ask the canvas to bring nodes into view (watched inside the React Flow provider) */
  focusRequest: { ids: string[]; n: number } | null
  /** multi-model comparison: choosing models for a node, and the side-by-side view */
  compareSetup: { nodeId: string } | null
  compareView: { ids: string[] } | null
  shortcutsOpen: boolean
  projectsOpen: boolean
  /** bottom toolbar toggles, remembered per browser */
  minimap: boolean
  snap: boolean
  canUndo: boolean
  canRedo: boolean
  /** latest run state per node (live during a run, restored from saved outputs on open) */
  runStates: Record<string, NodeRunState>
  runId: string | null
  skills: SkillMeta[]
  assets: AssetMeta[]
  /** left panel shown next to the rail; null = collapsed */
  leftPanel: 'library' | 'assets' | 'prompts' | null
  savedPrompts: SavedPrompt[]
  /** full-screen viewer; with `nodeId`, the node's kept versions can be browsed there */
  lightbox: { assetId: string; mime: string; name?: string; nodeId?: string } | null
  /** command palette; `at` = flow position to add at (double-click), else the view centre */
  palette: { open: boolean; at?: { x: number; y: number }; connect?: ConnectFrom }
  /** kept generations per node, newest first (loaded on demand) */
  versionLists: Record<string, NodeVersion[]>
  /** nodes of the current run, for the progress counter */
  runNodeIds: string[]
  /** right panel: node properties or the canvas assistant */
  rightTab: 'inspector' | 'assistant'
  assistantTurns: AssistantTurn[]
  assistantBusy: boolean
  /** a run waiting for the user to confirm paid generation calls */
  pendingRun: { nodeIds?: string[]; force?: boolean; estimate: Estimate } | null
  /** runs asked for while another one is going (the composer queues instead of cancelling it) */
  runQueue: string[][]
  /** the bottom generate bar (always shown on an empty canvas; otherwise when opened, or once used) */
  composerOpen: boolean

  init: () => Promise<void>
  loadProfiles: () => Promise<void>
  openProject: (id: string) => Promise<void>
  newProject: () => Promise<void>
  renameProject: (name: string) => void
  save: () => Promise<void>
  /** keep the current canvas in this browser (page closing with unsaved edits) */
  keepDraft: () => void
  setSettingsOpen: (o: boolean) => void
  openSettings: (intent?: SettingsIntent) => void
  showToast: (text: string, opts?: { action?: Toast['action']; tone?: Toast['tone']; ms?: number }) => void
  dismissToast: () => void
  /** select a node and centre the canvas on it */
  focusNode: (id: string) => void
  /** bring these nodes into view (without changing the selection) */
  showNodes: (ids: string[]) => void
  openCompareSetup: (nodeId: string | null) => void
  /** add variants of a node with these models (one undo step); returns every node in the comparison */
  addCompareModels: (nodeId: string, profileIds: string[]) => string[]
  /** keep this variant, remove the rest of its comparison (one undo step); returns how many were removed */
  pickCompare: (winnerId: string) => number
  /** end a comparison but keep every variant */
  endCompare: (group: string) => void
  openCompareView: (ids: string[] | null) => void
  setShortcutsOpen: (o: boolean) => void
  setProjectsOpen: (o: boolean) => void
  toggleView: (k: 'minimap' | 'snap') => void
  /** delete a canvas; when it is the open one, open the next (or a new one) */
  deleteProject: (id: string) => Promise<void>
  /** give every node of `kind` without a usable model this profile; returns how many changed */
  bindUnbound: (kind: ModelKind, profileId: string) => number
  /** add nodes/edges as one step and select exactly them (paste, duplicate) */
  insertGraph: (nodes: CanvasNode[], edges: Edge[], select?: boolean) => void
  dismissCheck: () => void
  setRightTab: (t: State['rightTab']) => void
  /** send a request to the canvas assistant (uses the chosen text model) */
  askAssistant: (profileId: string, message: string) => Promise<void>
  clearAssistant: () => void
  /** add an approved assistant plan to the canvas; returns the new node ids */
  applyPlan: (turnIndex: number) => string[]
  /** lay the canvas out left to right (one undo step); returns how many nodes moved */
  tidy: () => number
  /** arrow keys: move the selected nodes by (dx, dy); returns how many moved */
  nudge: (dx: number, dy: number) => number

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
  loadPrompts: () => Promise<void>
  /** save text to the prompt library */
  savePrompt: (text: string, title?: string) => Promise<void>
  /** add a prompt to the selected node's prompt — or to the text node that feeds it; none selected → undefined */
  applyPrompt: (text: string) => { ok: true; where: string } | { ok: false; reason: string } | undefined
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
  /** run these nodes now, or after the current run ends (never cancels it); the caller already showed the cost */
  queueRun: (nodeIds: string[]) => void
  setComposerOpen: (o: boolean) => void
  /** keep one of a node's several results: only it flows downstream */
  pickResult: (nodeId: string, index: number) => Promise<void>
  /** the last frame of a video becomes an image node feeding a new video generation */
  continueFromLastFrame: (sourceNodeId: string, assetId: string) => Promise<string | undefined>
  /** a frame of a video (at `t` seconds) becomes an image node next to the node it came from */
  saveFrame: (assetId: string, t: number, nearNodeId?: string) => Promise<string | undefined>
  dismissPendingRun: () => void
  cancelRun: () => Promise<void>
}

export const useStore = create<State>((set, get) => ({
  profiles: [], projects: [], projectId: null, projectName: '', nodes: [], edges: [],
  saveState: 'idle', saveFailures: 0, saveBlocked: false, toast: null, settingsOpen: false, runStates: {}, runId: null, pendingRun: null, runQueue: [], composerOpen: viewPref('composer', false),
  skills: [], palette: { open: false }, assets: [], leftPanel: 'library', lightbox: null, savedPrompts: [],
  versionLists: {}, runNodeIds: [], rightTab: 'inspector', assistantTurns: [], assistantBusy: false,
  settingsIntent: null, account: null, accounts: false, ffmpegOk: null, maxParallel: 4, pendingCheck: null, focusRequest: null, compareSetup: null, compareView: null, shortcutsOpen: false, projectsOpen: false, minimap: viewPref('minimap', true), snap: viewPref('snap', false), canUndo: false, canRedo: false,

  showToast: (text, opts) => {
    const t: Toast = { id: Date.now() + Math.random(), text, tone: opts?.tone, action: opts?.action }
    set({ toast: t })
    setTimeout(() => get().toast?.id === t.id && set({ toast: null }), opts?.ms ?? (opts?.action ? 7000 : 2800))
  },
  dismissToast: () => set({ toast: null }),
  setSettingsOpen: (o) => set({ settingsOpen: o, settingsIntent: null }),
  openSettings: (intent) => set({ settingsOpen: true, settingsIntent: intent ?? null }),
  focusNode: (id) => { get().selectNode(id); get().showNodes([id]) },
  showNodes: (ids) => set((s) => ({ focusRequest: { ids, n: (s.focusRequest?.n ?? 0) + 1 } })),
  openCompareSetup: (nodeId) => set({ compareSetup: nodeId ? { nodeId } : null }),
  addCompareModels: (nodeId, profileIds) => {
    const { nodes, edges, profiles } = get()
    const variants = profileIds.flatMap((id) => { const p = profiles.find((x) => x.id === id); return p ? [{ profileId: p.id, label: p.name }] : [] })
    // a run makes nodes taller (media up to 300 px instead of the placeholder, version switch): leave room
    const type = nodes.find((n) => n.id === nodeId)?.type
    const r = addCompareVariants(nodes, edges, nodeId, variants, uid, type === 'image-gen' || type === 'video-gen' ? 190 : 140)
    if (r.added.length) set({ nodes: r.nodes, edges: r.edges, saveState: 'dirty' })
    const group = r.group || nodes.find((n) => n.id === nodeId)?.data.compare
    return group ? get().nodes.filter((n) => n.data.compare === group).map((n) => n.id) : [nodeId]
  },
  pickCompare: (winnerId) => {
    const r = pickCompareWinner(get().nodes, get().edges, winnerId)
    if (!r) return 0
    set({ nodes: r.nodes, edges: r.edges, saveState: 'dirty', compareView: null })
    return r.removed.length
  },
  endCompare: (group) => set((s) => ({ nodes: dissolveCompare(s.nodes, group), saveState: 'dirty' })),
  openCompareView: (ids) => set({ compareView: ids && ids.length ? { ids } : null }),
  setShortcutsOpen: (o) => set({ shortcutsOpen: o }),
  setProjectsOpen: (o) => set({ projectsOpen: o }),
  toggleView: (k) => { const on = !get()[k]; setViewPref(k, on); set({ [k]: on } as Pick<State, 'minimap' | 'snap'>) },
  async deleteProject(id) {
    await api.deleteProject(id)
    try { localStorage.removeItem(`hzc.assistant.${id}`) } catch { /* ignore */ }
    const projects = await api.listProjects()
    set({ projects })
    if (get().projectId === id) {
      if (projects[0]) await get().openProject(projects[0].id)
      else await get().newProject()
    }
  },
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

  setRightTab: (t) => set({ rightTab: t }),

  async askAssistant(profileId, message) {
    const { nodes, edges, assistantTurns } = get()
    const history = assistantTurns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content }))
    const turns = [...assistantTurns, { role: 'user' as const, content: message }]
    set({ assistantTurns: turns, assistantBusy: true })
    try {
      const r = await api.assistant({
        profileId, message, history,
        canvas: {
          nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? 'text', label: n.data.label, text: n.data.text?.slice(0, 300) })),
          edges: edges.map((e) => ({ source: e.source, sourceHandle: e.sourceHandle ?? undefined, target: e.target, targetHandle: e.targetHandle ?? undefined })),
        },
      })
      set({ assistantTurns: [...get().assistantTurns, { role: 'assistant', content: r.reply, plan: r.plan, warnings: r.warnings }] })
    } catch (e) {
      set({ assistantTurns: [...get().assistantTurns, { role: 'assistant', content: `没能完成：${(e as Error).message}`, error: true }] })
    } finally {
      set({ assistantBusy: false })
      saveTurns(get().projectId, get().assistantTurns)
    }
  },

  clearAssistant: () => { set({ assistantTurns: [] }); saveTurns(get().projectId, []) },

  applyPlan: (turnIndex) => {
    const { assistantTurns, nodes, profiles } = get()
    const turn = assistantTurns[turnIndex]
    if (!turn?.plan || turn.applied) return []
    const ids = new Map(turn.plan.nodes.map((n) => [n.key, `n_${uid()}`]))
    const fresh: CanvasNode[] = turn.plan.nodes.map((n) => withDefaultProfile({
      id: ids.get(n.key)!, type: n.type, position: { x: 0, y: 0 },
      data: { label: n.label || NODE_TYPE_MAP[n.type]?.label, text: n.text ?? '', params: n.params ?? {} },
    }, profiles))
    const resolve = (k: string) => (k.startsWith('@') ? (nodes.some((n) => n.id === k.slice(1)) ? k.slice(1) : undefined) : ids.get(k))
    const edges: Edge[] = []
    for (const e of turn.plan.edges) {
      const source = resolve(e.from), target = resolve(e.to)
      if (source && target) edges.push({ id: `e_${uid()}`, source, sourceHandle: e.fromPort, target, targetHandle: e.toPort })
    }
    // lay the new nodes out left to right, to the right of what is already on the canvas
    const inner = edges.filter((e) => fresh.some((n) => n.id === e.source) && fresh.some((n) => n.id === e.target))
    const pos = tidyLayout(fresh, inner)
    const x0 = nodes.length ? Math.max(...nodes.map((n) => n.position.x + (n.measured?.width ?? 300))) + 160 : 0
    const y0 = nodes.length ? Math.min(...nodes.map((n) => n.position.y)) : 0
    const minX = Math.min(...[...pos.values()].map((p) => p.x)), minY = Math.min(...[...pos.values()].map((p) => p.y))
    for (const n of fresh) { const p = pos.get(n.id)!; n.position = { x: x0 + p.x - minX, y: y0 + p.y - minY } }
    get().insertGraph(fresh, edges)
    const turns = assistantTurns.map((t, i) => (i === turnIndex ? { ...t, applied: fresh.map((n) => n.id) } : t))
    set({ assistantTurns: turns })
    saveTurns(get().projectId, turns)
    return fresh.map((n) => n.id)
  },

  nudge: (dx, dy) => {
    let moved = 0
    const next = get().nodes.map((n) => {
      if (!n.selected || n.draggable === false) return n
      moved++
      return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
    })
    if (moved) set({ nodes: next, saveState: 'dirty' })
    return moved
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

  insertGraph: (nodes, edges, select = true) => set((s) => ({
    nodes: select ? [...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...nodes.map((n) => ({ ...n, selected: true }))] : [...s.nodes, ...nodes.map((n) => ({ ...n, selected: false }))],
    edges: [...s.edges, ...edges],
    saveState: 'dirty',
  })),

  async loadProfiles() { set({ profiles: await api.listProfiles() }) },

  async loadSkills() { set({ skills: await api.listSkills() }) },
  async loadAssets() { set({ assets: await api.listAssets() }) },
  async loadPrompts() { set({ savedPrompts: await api.listPrompts() }) },
  async savePrompt(text, title) {
    try {
      await api.savePrompt(text, title)
      await get().loadPrompts()
      get().showToast('已收藏到提示词库', { action: { label: '查看', run: () => set({ leftPanel: 'prompts' }) } })
    } catch (e) { get().showToast(`收藏失败：${(e as Error).message}`, { tone: 'error' }) }
  },
  applyPrompt(text) {
    const { nodes, edges } = get()
    const sel = nodes.filter((n) => n.selected && PROMPT_TYPES.has(n.type ?? ''))
    if (sel.length !== 1) return undefined
    let n = sel[0]!
    // when the prompt arrives over a wire, the node's own text is not used: edit the source instead
    const port = PROMPT_PORT[n.type ?? '']
    const feed = port ? edges.find((e) => e.target === n.id && (e.targetHandle ?? 'in') === port) : undefined
    if (feed) {
      const src = nodes.find((x) => x.id === feed.source)
      const srcName = src ? src.data.label ?? NODE_TYPE_MAP[src.type ?? '']?.label ?? '上游节点' : '上游节点'
      if (src?.type !== 'text') return { ok: false, reason: `这个节点的提示词来自「${srcName}」，请在那里修改` }
      n = src
    }
    const cur = n.data.text?.trim() ?? ''
    get().setNodeData(n.id, { text: cur ? `${cur.replace(/[，,。.\s]+$/, '')}，${text}` : text })
    return { ok: true, where: n.data.label ?? NODE_TYPE_MAP[n.type ?? '']?.label ?? '节点' }
  },
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
    void api.system().then((sys) => {
      set({ ffmpegOk: sys.ffmpeg.ok, maxParallel: sys.maxParallel ?? 4, accounts: !!sys.accounts })
      if (sys.accounts) void auth.me().then((account) => set({ account })).catch(() => undefined)
      // the database was damaged and replaced at startup: changes after that backup are missing
      if (sys.recovery) get().showToast(sys.recovery.restoredFrom ? '数据文件损坏，已自动从最近的备份恢复。详情见 设置 → 关于' : '数据文件损坏且没有可用备份，已用空数据启动。详情见 设置 → 关于', { tone: 'error', ms: 15_000, action: { label: '查看', run: () => get().openSettings({ tab: 'about' }) } })
    }).catch(() => undefined)
    void get().loadAssets().catch(() => undefined)
    void get().loadPrompts().catch(() => undefined)
    await get().loadProfiles()
    const projects = await api.listProjects()
    set({ projects })
    if (projects[0]) await get().openProject(projects[0].id)
    else await get().newProject()
    markBooted() // from now on a lost session means "sign in again", not "show the front page"
  },

  async openProject(id) {
    const [p, outs] = await Promise.all([api.getProject(id), api.outputs(id)])
    const runStates: Record<string, NodeRunState> = {}
    for (const o of outs) runStates[o.nodeId] = { status: 'done', outputs: o.outputs, finishedAt: o.finishedAt, versions: o.versions }
    set({ projectId: p.id, projectName: p.name, ...fromGraph(p.graph), saveState: 'saved', saveFailures: 0, saveBlocked: false, runStates, runId: null, versionLists: {}, runNodeIds: [], assistantTurns: loadTurns(p.id), assistantBusy: false })
    // edits that never reached the server last time (it was down, or the page closed first)
    const draft = readDraft(p.id)
    if (draft && (draft.name !== p.name || !sameGraph(draft.graph, p.graph))) {
      const when = new Date(draft.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      get().showToast(`发现 ${when} 未保存到服务的修改`, {
        ms: 30_000,
        action: {
          label: '恢复',
          run: () => {
            if (get().projectId !== p.id) return
            set({ projectName: draft.name, ...fromGraph(draft.graph), saveState: 'dirty' })
            get().showToast('已恢复未保存的修改')
          },
        },
      })
    } else if (draft) clearDraft(p.id)
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
    const graph = toGraph(nodes, edges)
    set({ saveState: 'saving' })
    try {
      await api.saveProject(projectId, { name: projectName, graph })
      clearDraft(projectId)
      const recovered = get().saveFailures > 0
      // an edit made while this save was on its way marked the canvas dirty again: keep it that way
      set({ saveState: get().saveState === 'dirty' ? 'dirty' : 'saved', saveFailures: 0, saveBlocked: false })
      // replaces the "save failed" message, which would otherwise still be on screen
      if (recovered) get().showToast('连接已恢复，修改已保存')
    } catch (e) {
      // the work is kept in this browser until a save succeeds
      const kept = get().projectId === projectId && writeDraft(projectId, projectName, graph)
      const status = (e as { status?: number }).status ?? 0
      const blocked = status === 400 || status === 404 || status === 413
      const failures = get().saveFailures + 1
      set({ saveState: 'error', saveFailures: failures, saveBlocked: blocked })
      // one message per streak of failures (autosave keeps retrying quietly)
      if (failures === 1 || blocked) get().showToast(`保存失败：${(e as Error).message}${kept ? '。修改已保存在本浏览器，' + (blocked ? '可导出备份' : '会自动重试') : ''}`, { tone: 'error', ms: 6000 })
    }
  },

  keepDraft: () => {
    const { projectId, projectName, nodes, edges, saveState } = get()
    if (projectId && (saveState === 'dirty' || saveState === 'saving' || saveState === 'error')) writeDraft(projectId, projectName, toGraph(nodes, edges))
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
          const [next, ...rest] = get().runQueue
          if (next) { set({ runQueue: rest }); setTimeout(() => void get().runNodes(next, false, { confirmed: true, checked: true }), 0) }
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

  queueRun(nodeIds) {
    if (!get().runId) { void get().runNodes(nodeIds, false, { confirmed: true, checked: true }); return }
    set((s) => ({ runQueue: [...s.runQueue, nodeIds] }))
    get().showToast('已加入队列：当前运行结束后开始')
  },

  setComposerOpen(o) { setViewPref('composer', o); set({ composerOpen: o }) },

  async pickResult(nodeId, index) {
    const { projectId } = get()
    if (!projectId) return
    try {
      const r = await api.pickResult(projectId, nodeId, index)
      set((s) => ({
        runStates: { ...s.runStates, [nodeId]: { ...(s.runStates[nodeId] ?? { status: 'done' }), status: 'done', outputs: r.outputs, finishedAt: r.finishedAt, versions: r.versions } },
        versionLists: Object.fromEntries(Object.entries(s.versionLists).filter(([k]) => k !== nodeId)),
      }))
      get().showToast(`已选用第 ${index + 1} 个结果，其余保留在版本里`)
    } catch (e) { get().showToast(`选用失败：${(e as Error).message}`, { tone: 'error' }) }
  },

  async continueFromLastFrame(sourceNodeId, assetId) {
    const src = get().nodes.find((n) => n.id === sourceNodeId)
    if (!src) return undefined
    let frame: { id: string; mime: string }
    try { frame = await api.assetFrame(assetId, 'last') } catch (e) { get().showToast(`取最后一帧失败：${(e as Error).message}`, { tone: 'error' }); return undefined }
    const x = src.position.x + (src.measured?.width ?? 300) + 80
    const fromGen = src.type === 'video-gen'
    const image: CanvasNode = { id: `n_${uid()}`, type: 'image', position: { x, y: src.position.y }, data: { assetId: frame.id, mime: frame.mime, label: '最后一帧' } }
    const params = fromGen ? Object.fromEntries(Object.entries(src.data.params ?? {}).filter(([k]) => k !== 'count')) : {}
    const next = withDefaultProfile({ id: `n_${uid()}`, type: 'video-gen', position: { x: x + 340, y: src.position.y }, data: { label: '下一段', profileId: fromGen ? src.data.profileId : undefined, text: '', params } }, get().profiles)
    const edge: Edge = { id: `e_${uid()}`, source: image.id, sourceHandle: 'out', target: next.id, targetHandle: 'first' }
    get().insertGraph([image, next], [edge])
    get().selectNode(next.id)
    get().showNodes([image.id, next.id])
    get().showToast('已用最后一帧开始下一段：写下接下来发生什么，再运行')
    return next.id
  },

  async saveFrame(assetId, t, nearNodeId) {
    let frame: { id: string; mime: string }
    try { frame = await api.assetFrame(assetId, t) } catch (e) { get().showToast(`保存这一帧失败：${(e as Error).message}`, { tone: 'error' }); return undefined }
    const near = nearNodeId ? get().nodes.find((n) => n.id === nearNodeId) : undefined
    const position = near ? { x: near.position.x + (near.measured?.width ?? 300) + 80, y: near.position.y + (near.measured?.height ?? 240) + 40 } : { x: 0, y: 0 }
    const id = get().addNode('image', position, undefined, { assetId: frame.id, mime: frame.mime, label: `第 ${t.toFixed(1)} 秒` })
    if (id) get().showToast('这一帧已保存为图片节点', { action: { label: '定位', run: () => get().focusNode(id) } })
    void get().loadAssets().catch(() => undefined)
    return id
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
