import type { Edge } from '@xyflow/react'
import { uid, useStore, type CanvasNode } from './store'

/**
 * Copy / paste / duplicate of canvas nodes (with the connections between them). Kept in the page
 * and in localStorage, so a copy can be pasted into another canvas. Results are not copied.
 */
interface Clip { nodes: CanvasNode[]; edges: Edge[] }
const KEY = 'hzc.clipboard'
let clip: Clip | null = null
let pasteCount = 0

function selection(): Clip | null {
  const { nodes, edges } = useStore.getState()
  const picked = nodes.filter((n) => n.selected)
  if (!picked.length) return null
  const ids = new Set(picked.map((n) => n.id))
  return {
    nodes: picked.map(({ id, type, position, data }) => ({ id, type, position, data }) as CanvasNode),
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

function insert(c: Clip, offset: number): number {
  const map = new Map(c.nodes.map((n) => [n.id, `n_${uid()}`]))
  const nodes = c.nodes.map((n) => ({ ...n, id: map.get(n.id)!, position: { x: n.position.x + offset, y: n.position.y + offset }, data: { ...n.data } }))
  const edges = c.edges.map((e) => ({ ...e, id: `e_${uid()}`, source: map.get(e.source)!, target: map.get(e.target)! }))
  useStore.getState().insertGraph(nodes, edges)
  return nodes.length
}

export function paste(): number {
  if (!clip) { try { clip = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Clip | null } catch { clip = null } }
  if (!clip?.nodes?.length) return 0
  pasteCount++
  return insert(clip, 40 * pasteCount)
}

export function duplicateSelection(): number {
  const c = selection()
  return c ? insert(c, 40) : 0
}
