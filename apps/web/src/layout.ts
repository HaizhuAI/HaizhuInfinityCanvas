import type { Edge } from '@xyflow/react'
import type { CanvasNode } from './store'

/**
 * "整理画布": a left-to-right layered layout. Each node goes in the column of its longest path from
 * a source; columns keep the current top-to-bottom order (pulled towards the order of their
 * parents, so wires cross less). Positions only — undo restores the previous arrangement.
 */
const GAP_X = 90, GAP_Y = 36, W = 300, H = 220

export function tidyLayout(nodes: CanvasNode[], edges: Edge[]): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id))
  const parents = new Map<string, string[]>()
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target)) parents.set(e.target, [...(parents.get(e.target) ?? []), e.source])
  const depth = new Map<string, number>()
  const visit = (id: string, stack: Set<string>): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (stack.has(id)) return 0 // a cycle cannot be connected, but stay safe
    stack.add(id)
    const d = Math.max(-1, ...(parents.get(id) ?? []).map((p) => visit(p, stack))) + 1
    stack.delete(id)
    depth.set(id, d)
    return d
  }
  for (const n of nodes) visit(n.id, new Set())

  const cols: CanvasNode[][] = []
  for (const n of nodes) (cols[depth.get(n.id)!] ??= []).push(n)
  const x0 = Math.min(...nodes.map((n) => n.position.x)), y0 = Math.min(...nodes.map((n) => n.position.y))
  const order = new Map<string, number>()
  const out = new Map<string, { x: number; y: number }>()
  let x = x0
  for (const col of cols) {
    if (!col) continue
    const key = (n: CanvasNode) => {
      const ps = (parents.get(n.id) ?? []).map((p) => order.get(p)).filter((v): v is number => v !== undefined)
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.POSITIVE_INFINITY
    }
    col.sort((a, b) => key(a) - key(b) || a.position.y - b.position.y || a.position.x - b.position.x)
    let y = y0
    col.forEach((n, i) => {
      order.set(n.id, i)
      out.set(n.id, { x, y })
      y += (n.measured?.height ?? H) + GAP_Y
    })
    x += Math.max(...col.map((n) => n.measured?.width ?? W)) + GAP_X
  }
  return out
}
