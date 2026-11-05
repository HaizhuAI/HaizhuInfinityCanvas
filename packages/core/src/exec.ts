import type { GraphEdge, GraphNode, ProjectGraph } from './graph'
import type { PortType } from './ports'
import { storyboardToText, type Shot } from './storyboard'

/** A value flowing along an edge. Media is passed by asset reference, never inline. */
export type PortValue =
  | { type: 'text'; text: string }
  | { type: 'image'; assetId: string; mime: string }
  | { type: 'video'; assetId: string; mime: string }
  | { type: 'audio'; assetId: string; mime: string }
  | { type: 'storyboard'; title?: string; shots: Shot[] }
  | { type: 'file'; assetId: string; mime: string; name?: string }

/** Outputs of one node, keyed by output port id. */
export type NodeOutputs = Record<string, PortValue[]>

export type NodeStatus = 'idle' | 'queued' | 'running' | 'done' | 'cached' | 'error' | 'skipped' | 'cancelled'

export interface NodeRunState {
  status: NodeStatus
  error?: string
  /** human-readable progress of a long provider job, e.g. "排队中（第 3 位）" */
  progress?: string
  outputs?: NodeOutputs
  startedAt?: string
  finishedAt?: string
}

/** Events streamed to the client while a run progresses. */
export type RunEvent =
  | { kind: 'run-start'; runId: string; nodeIds: string[] }
  | { kind: 'node'; runId: string; nodeId: string; state: NodeRunState }
  | { kind: 'run-end'; runId: string; status: 'done' | 'error' | 'cancelled' }

/** All ancestors of `targets` (inclusive). */
export function ancestorsOf(graph: Pick<ProjectGraph, 'edges'>, targets: string[]): Set<string> {
  const prev = new Map<string, string[]>()
  for (const e of graph.edges) prev.set(e.target, [...(prev.get(e.target) ?? []), e.source])
  const out = new Set<string>()
  const stack = [...targets]
  while (stack.length) {
    const cur = stack.pop()!
    if (out.has(cur)) continue
    out.add(cur)
    for (const p of prev.get(cur) ?? []) stack.push(p)
  }
  return out
}

/**
 * Kahn topological order restricted to `subset` (default: all nodes).
 * Ties are broken by canvas position (left→right, top→bottom) so runs are deterministic.
 * Throws if the graph contains a cycle.
 */
export function topoOrder(graph: ProjectGraph, subset?: Set<string>): string[] {
  const nodes = graph.nodes.filter((n) => !subset || subset.has(n.id))
  const ids = new Set(nodes.map((n) => n.id))
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  const indeg = new Map(nodes.map((n) => [n.id, 0]))
  for (const e of edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  const pos = new Map(nodes.map((n) => [n.id, n.position]))
  const byPos = (a: string, b: string) => {
    const pa = pos.get(a)!, pb = pos.get(b)!
    return pa.x - pb.x || pa.y - pb.y || a.localeCompare(b)
  }
  let ready = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id).sort(byPos)
  const order: string[] = []
  while (ready.length) {
    const cur = ready.shift()!
    order.push(cur)
    for (const e of edges) {
      if (e.source !== cur) continue
      const d = indeg.get(e.target)! - 1
      indeg.set(e.target, d)
      if (d === 0) ready = [...ready, e.target].sort(byPos)
    }
  }
  if (order.length !== nodes.length) throw new Error('graph contains a cycle')
  return order
}

/** Collect a node's inputs from upstream outputs, keyed by input port id. Edge order = connection order. */
export function collectInputs(
  edges: GraphEdge[],
  nodeId: string,
  outputs: Map<string, NodeOutputs>,
): Record<string, PortValue[]> {
  const res: Record<string, PortValue[]> = {}
  for (const e of edges) {
    if (e.target !== nodeId) continue
    const vals = outputs.get(e.source)?.[e.sourceHandle] ?? []
    res[e.targetHandle] = [...(res[e.targetHandle] ?? []), ...vals]
  }
  return res
}

/** Render values as text for text-typed consumers (storyboard → JSON, media → placeholder). */
export function valuesToText(vals: PortValue[] | undefined): string {
  return (vals ?? [])
    .map((v) => (v.type === 'text' ? v.text : v.type === 'storyboard' ? storyboardToText(v) : `[${v.type}:${v.assetId}]`))
    .join('\n\n')
}

export function valuesOfType<T extends PortType>(vals: PortValue[] | undefined, type: T): Extract<PortValue, { type: T }>[] {
  return (vals ?? []).filter((v): v is Extract<PortValue, { type: T }> => v.type === type)
}

export type { GraphNode }

/** One line of the pre-run estimate. */
export interface EstimateItem {
  nodeId: string
  type: string
  label: string
  profileName?: string
  /** a result with the same inputs/params already exists and will be reused (no provider call) */
  cached: boolean
  /** calls a paid generation API (image / video / speech) */
  generative: boolean
  cost?: { amount: number; currency: string } | null
}

export interface Estimate {
  items: EstimateItem[]
  /** totals by currency over the non-cached items that have a known cost */
  totals: Record<string, number>
  /** non-cached provider calls without a configured price */
  unpriced: number
}
