import type { Edge } from '@xyflow/react'
import { useStore, type CanvasNode } from './store'

/**
 * Undo / redo for canvas edits (nodes, connections, positions, text, parameters, model choice).
 * Adding, removing or connecting is one step each, recorded at once; drags and typing are recorded
 * once they settle (a drag or a burst of typing becomes one step). Selection, measuring and run
 * results are not edits. History is per canvas and resets when another canvas opens.
 */
type Snap = { nodes: CanvasNode[]; edges: Edge[]; sig: string }
const LIMIT = 100
const SETTLE_MS = 400

let past: Snap[] = []
let future: Snap[] = []
let committed: Snap | null = null
let project: string | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let restoring = false

const signature = (nodes: CanvasNode[], edges: Edge[]) => JSON.stringify([
  nodes.map((n) => [n.id, n.type, Math.round(n.position.x), Math.round(n.position.y), n.data]),
  edges.map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle]),
])

function snap(nodes = useStore.getState().nodes, edges = useStore.getState().edges): Snap {
  return {
    nodes: nodes.map(({ selected: _s, dragging: _d, ...n }) => n as CanvasNode),
    edges: edges.map(({ selected: _s, ...e }) => e as Edge),
    sig: signature(nodes, edges),
  }
}

const publish = (pending = false) => useStore.setState({ canUndo: past.length > 0 || pending, canRedo: future.length > 0 })

/** record `cur` (default: the current canvas) as a step if it differs from the last recorded one */
function commit(cur: Snap = snap()) {
  clearTimeout(timer)
  timer = undefined
  if (!committed) { committed = cur; return publish() }
  if (cur.sig === committed.sig) return publish()
  past.push(committed)
  if (past.length > LIMIT) past.shift()
  committed = cur
  future = []
  publish()
}

function apply(s: Snap) {
  restoring = true
  useStore.setState({ nodes: s.nodes.map((n) => ({ ...n, selected: false })), edges: s.edges, saveState: 'dirty' })
  restoring = false
  publish()
}

export function undo(): boolean {
  commit()
  const prev = past.pop()
  if (!prev || !committed) return false
  future.push(committed)
  committed = prev
  apply(prev)
  return true
}

export function redo(): boolean {
  commit()
  const next = future.pop()
  if (!next || !committed) return false
  past.push(committed)
  committed = next
  apply(next)
  return true
}

let started = false
export function initHistory() {
  if (started) return
  started = true
  useStore.subscribe((state, prev) => {
    if (state.projectId !== project) {
      // another canvas: start a fresh history once its graph is in the store
      project = state.projectId
      past = []; future = []; clearTimeout(timer); timer = undefined
      committed = snap()
      return publish()
    }
    if (restoring || (state.nodes === prev.nodes && state.edges === prev.edges)) return
    if (state.nodes.length !== prev.nodes.length || state.edges.length !== prev.edges.length) {
      // a discrete edit: close any drag/typing in progress as its own step, then record this one
      if (timer) commit(snap(prev.nodes, prev.edges))
      commit()
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => commit(), SETTLE_MS)
    if (!state.canUndo) publish(true)
  })
}
