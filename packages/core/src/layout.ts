/** anything with an id, a position and (once drawn) a measured size */
export interface LayoutNode { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } }

/**
 * "整理画布": a left-to-right layered layout. Each node goes in the column of its longest path from
 * a source; columns keep the current top-to-bottom order (pulled towards the order of their
 * parents, so wires cross less). Positions only — undo restores the previous arrangement.
 */
const GAP_X = 90, GAP_Y = 36, W = 300, H = 220

export function tidyLayout<N extends LayoutNode>(nodes: N[], edges: { source: string; target: string }[]): Map<string, { x: number; y: number }> {
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

  const cols: N[][] = []
  for (const n of nodes) (cols[depth.get(n.id)!] ??= []).push(n)
  const x0 = Math.min(...nodes.map((n) => n.position.x)), y0 = Math.min(...nodes.map((n) => n.position.y))
  const order = new Map<string, number>()
  const out = new Map<string, { x: number; y: number }>()
  let x = x0
  for (const col of cols) {
    if (!col) continue
    const key = (n: N) => {
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

/** the box a node takes up on the canvas: its measured size, a frame's own size, or a typical node's */
export function nodeBox(n: { type?: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; data?: Record<string, unknown> }) {
  const size = (n.data as { size?: { w?: number; h?: number } } | undefined)?.size
  const w = n.measured?.width ?? size?.w ?? 340
  const h = n.measured?.height ?? size?.h ?? (n.type === 'text' || n.type === 'audio' ? 260 : 440)
  return { x: n.position.x, y: n.position.y, w, h }
}

/**
 * Where a block of w × h can go near (x, y) without covering what is on the canvas (rc.20): moves it
 * down past whatever it would overlap, a few times, keeping its left edge. Nodes listed in `ignore`
 * (e.g. members the block will hold) do not count.
 */
export function findFreeSpot(
  nodes: { id: string; type?: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; data?: Record<string, unknown> }[],
  at: { x: number; y: number }, size: { w: number; h: number }, ignore: Set<string> = new Set(), gap = 40,
): { x: number; y: number } {
  const boxes = nodes.filter((n) => !ignore.has(n.id)).map(nodeBox)
  let y = at.y
  for (let i = 0; i < 200; i++) {
    const hit = boxes.filter((b) => at.x < b.x + b.w + gap && b.x < at.x + size.w + gap && y < b.y + b.h + gap && b.y < y + size.h + gap)
    if (!hit.length) return { x: at.x, y }
    y = Math.max(...hit.map((b) => b.y + b.h)) + gap
  }
  return { x: at.x, y }
}
