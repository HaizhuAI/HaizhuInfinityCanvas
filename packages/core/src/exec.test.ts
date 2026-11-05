import { describe, expect, it } from 'vitest'
import { ancestorsOf, collectInputs, reversePromptInstruction, topoOrder, valuesToText, type NodeOutputs, type ProjectGraph } from './index'

const g: ProjectGraph = {
  version: 1,
  nodes: [
    { id: 'c', type: 'llm', position: { x: 400, y: 0 }, data: {} },
    { id: 'a', type: 'text', position: { x: 0, y: 0 }, data: {} },
    { id: 'b', type: 'text', position: { x: 0, y: 100 }, data: {} },
    { id: 'd', type: 'preview', position: { x: 800, y: 0 }, data: {} },
    { id: 'x', type: 'text', position: { x: 0, y: 500 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'a', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
    { id: 'e2', source: 'b', sourceHandle: 'out', target: 'c', targetHandle: 'in' },
    { id: 'e3', source: 'c', sourceHandle: 'out', target: 'd', targetHandle: 'in' },
  ],
}

describe('topoOrder', () => {
  it('orders dependencies first, ties by position', () => {
    expect(topoOrder(g)).toEqual(['a', 'b', 'x', 'c', 'd'])
  })
  it('restricts to a subset', () => {
    expect(topoOrder(g, new Set(['c', 'a']))).toEqual(['a', 'c'])
  })
  it('throws on cycles', () => {
    const cyc: ProjectGraph = { ...g, edges: [...g.edges, { id: 'e4', source: 'd', sourceHandle: 'out', target: 'a', targetHandle: 'in' }] }
    expect(() => topoOrder(cyc)).toThrow(/cycle/)
  })
})

describe('ancestorsOf', () => {
  it('includes the target and all upstream nodes only', () => {
    expect([...ancestorsOf(g, ['c'])].sort()).toEqual(['a', 'b', 'c'])
    expect([...ancestorsOf(g, ['x'])]).toEqual(['x'])
  })
})

describe('collectInputs', () => {
  it('merges multiple edges into one port in connection order', () => {
    const outs = new Map<string, NodeOutputs>([
      ['a', { out: [{ type: 'text', text: 'A' }] }],
      ['b', { out: [{ type: 'text', text: 'B' }] }],
    ])
    const inp = collectInputs(g.edges, 'c', outs)
    expect(valuesToText(inp.in)).toBe('A\n\nB')
  })
})

describe('reversePromptInstruction', () => {
  it('varies by style and language', () => {
    expect(reversePromptInstruction('midjourney', 'en')).toMatch(/--ar/)
    expect(reversePromptInstruction('general', 'zh')).toMatch(/Simplified Chinese/)
    expect(reversePromptInstruction('sdxl', 'en')).toMatch(/Negative:/)
  })
})
