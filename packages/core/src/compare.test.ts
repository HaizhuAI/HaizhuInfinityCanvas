import { describe, expect, it } from 'vitest'
import { MAX_COMPARE, addCompareVariants, compareMembers, dissolveCompare, pickCompareWinner, type CompareEdge, type CompareNode } from './compare'

const node = (id: string, x: number, y: number, data: CompareNode['data'] = {}, type = 'image-gen'): CompareNode =>
  ({ id, type, position: { x, y }, data, measured: { width: 336, height: 300 } })
const edge = (id: string, source: string, target: string, targetHandle = 'in', sourceHandle = 'out'): CompareEdge => ({ id, source, sourceHandle, target, targetHandle })

describe('multi-model comparison', () => {
  let n = 0
  const id = () => `id${++n}`
  const graph = () => ({
    nodes: [node('txt', 0, 0, {}, 'text'), node('gen', 400, 0, { profileId: 'p1', label: 'A', text: '雨夜' } as CompareNode['data']), node('view', 800, 0, {}, 'preview'), node('below', 400, 360, {}, 'text')],
    edges: [edge('e1', 'txt', 'gen', 'prompt'), edge('e2', 'gen', 'view')],
  })

  it('adds variants with the other models, wired to the same inputs, below the node and clear of others', () => {
    const g = graph()
    const r = addCompareVariants(g.nodes, g.edges, 'gen', [{ profileId: 'p2', label: 'B' }, { profileId: 'p3', label: 'C' }], id)
    expect(r.added).toHaveLength(2)
    const members = compareMembers(r.nodes, r.group)
    expect(members.map((m) => m.data.profileId)).toEqual(['p1', 'p2', 'p3'])
    expect(members.map((m) => m.data.label)).toEqual(['A', 'B', 'C'])
    expect((members[1]!.data as { text?: string }).text).toBe('雨夜')               // same prompt and parameters
    // each variant gets the node's inputs, not its outputs
    for (const v of r.added) expect(r.edges.filter((e) => e.target === v)).toEqual([expect.objectContaining({ source: 'txt', targetHandle: 'prompt' })])
    expect(r.edges.filter((e) => e.source !== 'txt' && r.added.includes(e.source))).toEqual([])
    // a row under the starting node; the slot where another node sits (400,360) is skipped
    const pos = members.slice(1).map((m) => [m.position.x, m.position.y])
    expect(pos).toEqual([[400 + 376, 340], [400 + 2 * 376, 340]])
    expect(members.every((m) => m.selected)).toBe(true)
    // room for results to grow: the row starts lower, and a taller slot reaches the node below sooner
    const roomy = addCompareVariants(g.nodes, g.edges, 'gen', [{ profileId: 'p2', label: 'B' }], id, 200)
    const v = roomy.nodes.find((x) => x.id === roomy.added[0])!
    expect(v.position.y).toBe(300 + 200 + 40)
    expect(v.position.x).toBe(400 + 376)                                                // (400, 540) would overlap 'below'
    // nothing in the way: the first variant sits right under the starting node
    const free = g.nodes.filter((x) => x.id !== 'below')
    const clear = addCompareVariants(free, g.edges, 'gen', [{ profileId: 'p2', label: 'B' }, { profileId: 'p3', label: 'C' }, { profileId: 'p4', label: 'D' }], id)
    expect(compareMembers(clear.nodes, clear.group).slice(1).map((m) => [m.position.x, m.position.y])).toEqual([[400, 340], [776, 340], [1152, 340]])
    expect(r.nodes.find((x) => x.id === 'txt')!.selected).toBe(false)
  })

  it('extends an existing comparison, skips models already in it and stops at four', () => {
    const g = graph()
    const a = addCompareVariants(g.nodes, g.edges, 'gen', [{ profileId: 'p2', label: 'B' }], id)
    const b = addCompareVariants(a.nodes, a.edges, a.added[0]!, [{ profileId: 'p1', label: 'A' }, { profileId: 'p3', label: 'C' }, { profileId: 'p4', label: 'D' }, { profileId: 'p5', label: 'E' }], id)
    expect(b.group).toBe(a.group)
    expect(compareMembers(b.nodes, b.group).map((m) => m.data.profileId)).toEqual(['p1', 'p2', 'p3', 'p4'])
    expect(compareMembers(b.nodes, b.group)).toHaveLength(MAX_COMPARE)
    const c = addCompareVariants(b.nodes, b.edges, 'gen', [{ profileId: 'p6', label: 'F' }], id)
    expect(c.added).toEqual([])
    expect(c.nodes).toBe(b.nodes)
  })

  it('picking a variant puts it in the original place with the outgoing wires and removes the rest', () => {
    const g = graph()
    const r = addCompareVariants(g.nodes, g.edges, 'gen', [{ profileId: 'p2', label: 'B' }, { profileId: 'p3', label: 'C' }], id)
    const winner = r.added[1]!
    const p = pickCompareWinner(r.nodes, r.edges, winner)!
    expect(p.removed.sort()).toEqual(['gen', r.added[0]!].sort())
    expect(p.nodes.map((x) => x.id)).toEqual(['txt', 'view', 'below', winner])
    const w = p.nodes.find((x) => x.id === winner)!
    expect(w.position).toEqual({ x: 400, y: 0 })
    expect(w.data.compare).toBeUndefined()
    expect(w.data.profileId).toBe('p3')
    expect(p.edges.map((e) => [e.source, e.target, e.targetHandle]).sort()).toEqual([['txt', winner, 'prompt'], [winner, 'view', 'in']].sort())
  })

  it('picking the original keeps its wires; nothing to pick outside a comparison; dissolve keeps all', () => {
    const g = graph()
    const r = addCompareVariants(g.nodes, g.edges, 'gen', [{ profileId: 'p2', label: 'B' }], id)
    const p = pickCompareWinner(r.nodes, r.edges, 'gen')!
    expect(p.edges).toEqual(g.edges)
    expect(p.nodes.map((x) => x.id)).toEqual(['txt', 'gen', 'view', 'below'])
    expect(pickCompareWinner(g.nodes, g.edges, 'gen')).toBeNull()
    const d = dissolveCompare(r.nodes, r.group)
    expect(d).toHaveLength(5)
    expect(d.some((x) => x.data.compare)).toBe(false)
  })

  it('a wire both variants had to the same port is kept once', () => {
    const g = graph()
    const r = addCompareVariants(g.nodes, g.edges, 'gen', [{ profileId: 'p2', label: 'B' }], id)
    const v = r.added[0]!
    const both = [...r.edges, edge('e9', v, 'view')]
    const p = pickCompareWinner(r.nodes, both, v)!
    expect(p.edges.filter((e) => e.target === 'view')).toHaveLength(1)
  })
})
