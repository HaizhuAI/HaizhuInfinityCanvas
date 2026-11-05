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

import { extractJson, normalizeStoryboard, storyboardToText } from './index'

describe('storyboard parsing', () => {
  it('extracts JSON from fenced or chatty replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('好的，以下是分镜：{"shots":[{"visual":"x"}]} 希望有帮助')).toEqual({ shots: [{ visual: 'x' }] })
    expect(() => extractJson('抱歉，我无法完成')).toThrow(/JSON/)
  })

  it('normalises key styles, fills prompts and clamps durations', () => {
    const sb = normalizeStoryboard({
      title: '雨夜机械猫',
      shots: [
        { title: '开场', visual: '霓虹街道', camera: '缓慢推进', dialogue: '', duration: '4s', image_prompt: 'neon street, rain' },
        { 画面: '猫跳上屋顶', 运镜: '跟拍', 台词: '回家吧', 时长: 99 },
      ],
    })
    expect(sb.title).toBe('雨夜机械猫')
    expect(sb.shots[0]).toMatchObject({ index: 1, duration: 4, imagePrompt: 'neon street, rain', videoPrompt: '霓虹街道，缓慢推进' })
    expect(sb.shots[1]).toMatchObject({ index: 2, title: '镜头 2', visual: '猫跳上屋顶', camera: '跟拍', dialogue: '回家吧', duration: 60, imagePrompt: '猫跳上屋顶' })
    expect(storyboardToText(sb)).toContain('镜头 2｜镜头 2（60s）')
  })

  it('accepts a bare array and rejects empty or visual-less boards', () => {
    expect(normalizeStoryboard([{ visual: 'a' }]).shots).toHaveLength(1)
    expect(() => normalizeStoryboard({ shots: [] })).toThrow(/没有镜头/)
    expect(() => normalizeStoryboard({ shots: [{ dialogue: 'hi' }] })).toThrow(/画面/)
  })
})
