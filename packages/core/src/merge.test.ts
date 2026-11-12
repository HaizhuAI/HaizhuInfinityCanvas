import { describe, expect, it } from 'vitest'
import { mergeGraphs } from './merge'
import type { GraphNode, ProjectGraph } from './graph'

const node = (id: string, type = 'text', text = '', extra: Partial<GraphNode> = {}): GraphNode => ({ id, type, position: { x: 0, y: 0 }, data: { text }, ...extra })
const g = (nodes: GraphNode[], edges: ProjectGraph['edges'] = []): ProjectGraph => ({ version: 1, nodes, edges })
const edge = (source: string, target: string, targetHandle = 'prompt') => ({ id: `${source}-${target}`, source, sourceHandle: 'out', target, targetHandle })

describe('mergeGraphs', () => {
  it('keeps what each side added and edited', () => {
    const base = g([node('a', 'text', 'hi'), node('b', 'image-gen')])
    const mine = g([node('a', 'text', 'hi there'), node('b', 'image-gen'), node('c', 'text', 'mine')])
    const theirs = g([node('a', 'text', 'hi'), node('b', 'image-gen', '', { data: { text: '', params: { count: 2 } } }), node('d', 'video-gen')], [edge('a', 'd')])
    const r = mergeGraphs(base, mine, theirs)
    expect(r.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(r.nodes[0]!.data.text).toBe('hi there')
    expect(r.nodes[1]!.data.params).toEqual({ count: 2 })
    expect(r.edges).toHaveLength(1)
  })

  it('merges field by field when both sides changed a node; the page wins on the same field', () => {
    const base = g([node('a', 'image-gen', 'cat', { data: { text: 'cat', params: { count: 1, aspect_ratio: '1:1' } } })])
    const mine = g([{ ...node('a', 'image-gen'), position: { x: 50, y: 0 }, data: { text: 'a cat', params: { count: 1, aspect_ratio: '1:1' } } }])
    const theirs = g([node('a', 'image-gen', '', { data: { text: 'a dog', params: { count: 3, aspect_ratio: '1:1' } } })])
    const r = mergeGraphs(base, mine, theirs).nodes[0]!
    expect(r.data.text).toBe('a cat')
    expect(r.data.params).toEqual({ count: 3, aspect_ratio: '1:1' })
    expect(r.position).toEqual({ x: 50, y: 0 })
  })

  it('deletions: removed on one side and untouched on the other is gone; edited here is kept', () => {
    const base = g([node('a'), node('b'), node('c')], [edge('a', 'b', 'in')])
    const mine = g([node('a'), node('b', 'text', 'edited')], [edge('a', 'b', 'in')])
    const theirs = g([node('a'), node('c')])
    const r = mergeGraphs(base, mine, theirs)
    expect(r.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(r.edges).toEqual([]) // the agent removed the wire, the page did not touch it
  })

  it('an input that takes one wire keeps the page’s', () => {
    const base = g([node('t1'), node('t2'), node('v', 'video-gen')])
    const mine = g(base.nodes, [edge('t1', 'v')])
    const theirs = g(base.nodes, [edge('t2', 'v')])
    expect(mergeGraphs(base, mine, theirs).edges.map((e) => e.source)).toEqual(['t1'])
  })
})
