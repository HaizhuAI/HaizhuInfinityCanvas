/**
 * Multi-model comparison on the canvas: run one node with several models side by side, then keep
 * the one you like. Pure graph edits (no I/O) so the canvas can apply each as one undo step.
 *
 * A comparison is a group of nodes of the same type sharing `data.compare`. The node it started from
 * stays where it was (it keeps its outgoing wires); each variant is a copy with another model, wired
 * to the same inputs and placed below. Picking a winner moves the winner into the starting node's
 * place, hands it the outgoing wires and removes the other variants.
 */
export interface CompareNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data: { compare?: string; profileId?: string; label?: string }
  measured?: { width?: number; height?: number }
  selected?: boolean
}
export interface CompareEdge { id: string; source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }

/** at most this many models in one comparison (the side-by-side view has room for four) */
export const MAX_COMPARE = 4
const GAP = 40
const size = (n: CompareNode) => ({ w: n.measured?.width ?? 336, h: n.measured?.height ?? 380 })

/** the members of a comparison, in canvas order (the starting node first) */
export function compareMembers<N extends CompareNode>(nodes: N[], group: string | undefined): N[] {
  return group ? nodes.filter((n) => n.data.compare === group) : []
}

/** whether a w×h box at (x, y) overlaps any of the nodes */
const collides = (nodes: CompareNode[], x: number, y: number, w: number, h: number) => nodes.some((n) => {
  const s = size(n)
  return x < n.position.x + s.w + GAP / 2 && n.position.x < x + w + GAP / 2 && y < n.position.y + s.h + GAP / 2 && n.position.y < y + h + GAP / 2
})

/**
 * Add one variant of `nodeId` per model in `variants` (same type, text, parameters and inputs).
 * Models already in the comparison are skipped; the total is capped at MAX_COMPARE.
 * The variants go in a row under the starting node (left to right, a new row when one is taken), so
 * the whole comparison stays on one screen at a readable zoom. `grow` reserves room under each node
 * for what a run adds (a taller result, the version switch), so nothing overlaps once results arrive.
 * Returns the whole new graph; `added` are the new node ids (empty when nothing changed).
 */
export function addCompareVariants<N extends CompareNode, E extends CompareEdge>(
  nodes: N[], edges: E[], nodeId: string, variants: { profileId: string; label: string }[], newId: () => string, grow = 0,
): { nodes: N[]; edges: E[]; group: string; added: string[] } {
  const base = nodes.find((n) => n.id === nodeId)
  if (!base) return { nodes, edges, group: '', added: [] }
  const group = base.data.compare ?? `cmp_${newId()}`
  const members = base.data.compare ? compareMembers(nodes, group) : [base]
  const have = new Set(members.map((m) => m.data.profileId))
  const room = Math.max(0, MAX_COMPARE - members.length)
  const todo = variants.filter((v, i, all) => !have.has(v.profileId) && all.findIndex((x) => x.profileId === v.profileId) === i).slice(0, room)
  if (!todo.length) return { nodes, edges, group: base.data.compare ?? '', added: [] }

  // slots: a grid under the starting node, three across; a slot is free when nothing overlaps it
  const anchor = members[0]!
  const { w } = size(anchor)
  const h = size(anchor).h + grow
  const top = anchor.position.y + h + GAP
  const placed: CompareNode[] = nodes.filter((n) => n.id !== anchor.id)
  let slot = 0
  const fresh: N[] = []
  const wires: E[] = []
  const incoming = edges.filter((e) => e.target === base.id)
  for (const v of todo) {
    const id = `n_${newId()}`
    let x = anchor.position.x, y = top
    for (; slot < 60; slot++) {
      x = anchor.position.x + (slot % 3) * (w + GAP)
      y = top + Math.floor(slot / 3) * (h + GAP)
      if (!collides(placed, x, y, w, h)) break
    }
    slot++
    const node = {
      ...base, id, selected: true, position: { x, y },
      data: { ...base.data, profileId: v.profileId, label: v.label, compare: group },
      measured: base.measured ? { ...base.measured } : undefined,
    } as N
    fresh.push(node)
    placed.push({ ...node, measured: { width: w, height: h } })
    for (const e of incoming) wires.push({ ...e, id: `e_${newId()}`, target: id } as E)
  }
  const out = nodes.map((n) => {
    const selected = members.some((m) => m.id === n.id)
    if (n.id === base.id && !n.data.compare) return { ...n, selected, data: { ...n.data, compare: group } }
    return n.selected === selected ? n : { ...n, selected }
  })
  return { nodes: [...out, ...fresh], edges: [...edges, ...wires], group, added: fresh.map((n) => n.id) }
}

/**
 * Keep `winnerId` and drop the rest of its comparison. The winner takes the starting node's place
 * and its outgoing wires (one per target port); the comparison ends. Null when the node isn't in one.
 */
export function pickCompareWinner<N extends CompareNode, E extends CompareEdge>(
  nodes: N[], edges: E[], winnerId: string,
): { nodes: N[]; edges: E[]; removed: string[] } | null {
  const winner = nodes.find((n) => n.id === winnerId)
  const members = compareMembers(nodes, winner?.data.compare)
  if (!winner || members.length < 2) return null
  const anchor = members[0]!
  const losers = new Set(members.filter((m) => m.id !== winnerId).map((m) => m.id))
  const key = (e: CompareEdge) => `${e.sourceHandle ?? ''}|${e.target}|${e.targetHandle ?? ''}`
  const taken = new Set(edges.filter((e) => e.source === winnerId).map(key))
  const outEdges: E[] = []
  for (const e of edges) {
    if (losers.has(e.target)) continue
    if (losers.has(e.source)) {
      if (taken.has(key(e))) continue
      taken.add(key(e))
      outEdges.push({ ...e, source: winnerId })
    } else outEdges.push(e)
  }
  const outNodes = nodes.filter((n) => !losers.has(n.id)).map((n) => {
    if (n.id !== winnerId) return n
    const { compare: _c, ...data } = n.data
    return { ...n, position: { ...anchor.position }, selected: true, data } as N
  })
  return { nodes: outNodes, edges: outEdges, removed: [...losers] }
}

/** end a comparison but keep every variant on the canvas */
export function dissolveCompare<N extends CompareNode>(nodes: N[], group: string): N[] {
  return nodes.map((n) => {
    if (n.data.compare !== group) return n
    const { compare: _c, ...data } = n.data
    return { ...n, data } as N
  })
}
