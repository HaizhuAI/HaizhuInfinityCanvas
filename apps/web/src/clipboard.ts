import type { Edge } from '@xyflow/react'
import { uid, useStore, type CanvasNode } from './store'

/**
 * Copy / paste / duplicate of canvas nodes (with the connections between them). Kept in the page
 * and in localStorage, so a copy can be pasted into another canvas. Results are not copied.
 */
interface Clip { nodes: CanvasNode[]; edges: Edge[] }
const KEY = 'hzc.clipboard'
/** a copy is a node of its own: it doesn't join the comparison the original is in */
const own = (data: CanvasNode['data']): CanvasNode['data'] => { const { compare: _c, ...rest } = data; return rest }
let clip: Clip | null = null
let pasteCount = 0

function selection(): Clip | null {
  const { nodes, edges } = useStore.getState()
  const picked = nodes.filter((n) => n.selected)
  if (!picked.length) return null
  const ids = new Set(picked.map((n) => n.id))
  return {
    nodes: picked.map(({ id, type, position, data }) => ({ id, type, position, data: own(data) }) as CanvasNode),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map(({ id, source, sourceHandle, target, targetHandle }) => ({ id, source, sourceHandle, target, targetHandle })),
  }
}

export function copySelection(): number {
  const c = selection()
  if (!c) return 0
  clip = c
  pasteCount = 0
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* too large or blocked: page copy still works */ }
  return c.nodes.length
}

function insert(c: Clip, offset: number, at?: { x: number; y: number }): number {
  const map = new Map(c.nodes.map((n) => [n.id, `n_${uid()}`]))
  // at a point (right-click paste): the group's top-left lands there; otherwise offset from the originals
  const minX = Math.min(...c.nodes.map((n) => n.position.x)), minY = Math.min(...c.nodes.map((n) => n.position.y))
  const dx = at ? at.x - minX : offset, dy = at ? at.y - minY : offset
  const nodes = c.nodes.map((n) => ({ ...n, id: map.get(n.id)!, position: { x: n.position.x + dx, y: n.position.y + dy }, data: own(n.data) }))
  const edges = c.edges.map((e) => ({ ...e, id: `e_${uid()}`, source: map.get(e.source)!, target: map.get(e.target)! }))
  useStore.getState().insertGraph(nodes, edges)
  return nodes.length
}

export function paste(at?: { x: number; y: number }): number {
  if (!clip) { try { clip = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Clip | null } catch { clip = null } }
  if (!clip?.nodes?.length) return 0
  pasteCount++
  return insert(clip, 40 * pasteCount, at)
}

export function canPaste(): boolean {
  if (clip?.nodes?.length) return true
  try { return !!(JSON.parse(localStorage.getItem(KEY) ?? 'null') as Clip | null)?.nodes?.length } catch { return false }
}

/** Alt + drag: copies stay where the dragged nodes started; the originals keep moving */
export function leaveCopies(ids: string[]): number {
  const { nodes, edges } = useStore.getState()
  const set = new Set(ids)
  const picked = nodes.filter((n) => set.has(n.id))
  if (!picked.length) return 0
  const map = new Map(picked.map((n) => [n.id, `n_${uid()}`]))
  const copies = picked.map(({ id, type, position, data }) => ({ id: map.get(id)!, type, position: { ...position }, data: own(data) }) as CanvasNode)
  const links = edges.filter((e) => set.has(e.source) && set.has(e.target)).map((e) => ({ id: `e_${uid()}`, source: map.get(e.source)!, sourceHandle: e.sourceHandle, target: map.get(e.target)!, targetHandle: e.targetHandle }))
  useStore.getState().insertGraph(copies, links, false)
  return copies.length
}

export function duplicateSelection(): number {
  const c = selection()
  return c ? insert(c, 40) : 0
}
