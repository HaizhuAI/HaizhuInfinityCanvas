import { NODE_TYPE_MAP } from './nodes'
import { canConnect } from './ports'

/** Persisted project graph (framework-agnostic; the web app maps it to React Flow). */
export interface GraphNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: {
    label?: string
    profileId?: string
    params?: Record<string, unknown>
    text?: string
  }
}

export interface GraphEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

export interface ProjectGraph {
  version: 1
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export const EMPTY_GRAPH: ProjectGraph = { version: 1, nodes: [], edges: [] }

export interface ConnectionCandidate {
  source: string
  sourceHandle: string | null
  target: string
  targetHandle: string | null
}

export type ConnectionCheck = { ok: true } | { ok: false; reason: string }

/** Would adding source->target create a cycle in the existing edges? */
export function wouldCreateCycle(edges: Pick<GraphEdge, 'source' | 'target'>[], source: string, target: string): boolean {
  if (source === target) return true
  const next = new Map<string, string[]>()
  for (const e of edges) next.set(e.source, [...(next.get(e.source) ?? []), e.target])
  const seen = new Set<string>()
  const stack = [target]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === source) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const n of next.get(cur) ?? []) stack.push(n)
  }
  return false
}

export function checkConnection(
  nodes: Pick<GraphNode, 'id' | 'type'>[],
  edges: GraphEdge[],
  c: ConnectionCandidate,
): ConnectionCheck {
  const s = nodes.find((n) => n.id === c.source)
  const t = nodes.find((n) => n.id === c.target)
  if (!s || !t) return { ok: false, reason: '节点不存在' }
  const sDef = NODE_TYPE_MAP[s.type]
  const tDef = NODE_TYPE_MAP[t.type]
  if (!sDef || !tDef) return { ok: false, reason: '未知节点类型' }
  const out = sDef.outputs.find((p) => p.id === (c.sourceHandle ?? 'out'))
  const inp = tDef.inputs.find((p) => p.id === (c.targetHandle ?? tDef.inputs[0]?.id))
  if (!out || !inp) return { ok: false, reason: '端口不存在' }
  if (!canConnect(out.type, inp.type)) return { ok: false, reason: `类型不兼容：${out.type} → ${inp.type}` }
  if (!inp.multiple && edges.some((e) => e.target === c.target && e.targetHandle === inp.id))
    return { ok: false, reason: '该输入端口只接受一条连线' }
  if (wouldCreateCycle(edges, c.source, c.target)) return { ok: false, reason: '不允许形成环' }
  return { ok: true }
}
