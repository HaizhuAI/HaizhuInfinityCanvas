import { NODE_TYPE_MAP } from './nodes'
import type { GraphEdge, GraphNode, ProjectGraph } from './graph'

/**
 * Three-way merge of a canvas edited in two places at once — the open page and an agent (or another
 * tab). `base` is the version both started from, `mine` the page's current canvas, `theirs` what the
 * server has now. What only one side changed is taken from that side; when both changed the same
 * node, each field (label, text, model, every parameter, position) is taken from whoever changed it,
 * and the page wins where both changed the same field (the person at the screen is typing there).
 * A node deleted on one side and left alone on the other is deleted; deleted on one side and edited
 * on the other, the person at the screen decides: their edit or their deletion is kept.
 */
export function mergeGraphs(base: ProjectGraph, mine: ProjectGraph, theirs: ProjectGraph): ProjectGraph {
  const b = new Map(base.nodes.map((n) => [n.id, n]))
  const t = new Map(theirs.nodes.map((n) => [n.id, n]))
  const m = new Map(mine.nodes.map((n) => [n.id, n]))
  const nodes: GraphNode[] = []
  for (const mn of mine.nodes) {
    const bn = b.get(mn.id), tn = t.get(mn.id)
    if (!bn) { nodes.push(mn); continue } // added here
    if (!tn) { if (same(mn, bn)) continue; nodes.push(mn); continue } // deleted there: kept only if edited here
    nodes.push(same(mn, bn) ? tn : same(tn, bn) ? mn : mergeNode(bn, mn, tn))
  }
  // added there (a node deleted here stays deleted)
  for (const tn of theirs.nodes) if (!m.has(tn.id) && !b.has(tn.id)) nodes.push(tn)

  const keep = new Set(nodes.map((n) => n.id))
  const be = new Set(base.edges.map((e) => edgeKey(e)))
  const te = new Set(theirs.edges.map((e) => edgeKey(e)))
  const me = new Set(mine.edges.map((e) => edgeKey(e)))
  const candidates: GraphEdge[] = []
  const seen = new Set<string>()
  // an edge stays when neither side removed it; a new edge from either side is added
  for (const e of [...mine.edges, ...theirs.edges]) {
    const k = edgeKey(e)
    if (seen.has(k)) continue
    seen.add(k)
    const inBase = be.has(k)
    const ok = inBase ? me.has(k) && te.has(k) : true
    if (ok && keep.has(e.source) && keep.has(e.target)) candidates.push(e)
  }
  // an input that takes one wire keeps the first one (the page's, since its edges come first)
  const types = new Map(nodes.map((n) => [n.id, n.type]))
  const taken = new Set<string>()
  const edges = candidates.filter((e) => {
    const port = NODE_TYPE_MAP[types.get(e.target) ?? '']?.inputs.find((p) => p.id === e.targetHandle)
    if (!port || port.multiple) return true
    const k = `${e.target}\u0000${e.targetHandle}`
    if (taken.has(k)) return false
    taken.add(k)
    return true
  })
  return { version: 1, nodes, edges }
}

const edgeKey = (e: GraphEdge) => [e.source, e.sourceHandle, e.target, e.targetHandle].join('\u0000')

/** both sides changed this node: field by field */
function mergeNode(b: GraphNode, m: GraphNode, t: GraphNode): GraphNode {
  const pick = <T>(bv: T, mv: T, tv: T): T => (same(mv, bv) ? tv : mv)
  const data: GraphNode['data'] = {}
  const keys = new Set([...Object.keys(b.data), ...Object.keys(m.data), ...Object.keys(t.data)]) as Set<keyof GraphNode['data']>
  for (const k of keys) {
    if (k === 'params') continue
    const v = pick(b.data[k], m.data[k], t.data[k])
    if (v !== undefined) (data as Record<string, unknown>)[k] = v
  }
  const bp = b.data.params ?? {}, mp = m.data.params ?? {}, tp = t.data.params ?? {}
  const pkeys = new Set([...Object.keys(bp), ...Object.keys(mp), ...Object.keys(tp)])
  if (pkeys.size) {
    const params: Record<string, unknown> = {}
    for (const k of pkeys) {
      const v = pick(bp[k], mp[k], tp[k])
      if (v !== undefined) params[k] = v
    }
    data.params = params
  }
  return { id: m.id, type: m.type, position: pick(b.position, m.position, t.position), data }
}

/** structural equality, key order ignored */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => same(v, (b as unknown[])[i]))
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
