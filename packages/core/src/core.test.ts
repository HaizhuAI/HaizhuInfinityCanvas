import { describe, expect, it } from 'vitest'
import { canConnect, checkConnection, validateProfileInput, wouldCreateCycle } from './index'

describe('canConnect', () => {
  it('allows same types and any', () => {
    expect(canConnect('text', 'text')).toBe(true)
    expect(canConnect('image', 'any')).toBe(true)
    expect(canConnect('any', 'video')).toBe(true)
  })
  it('rejects mismatches', () => {
    expect(canConnect('image', 'video')).toBe(false)
    expect(canConnect('audio', 'text')).toBe(false)
  })
  it('flattens storyboard to text but not the reverse', () => {
    expect(canConnect('storyboard', 'text')).toBe(true)
    expect(canConnect('text', 'storyboard')).toBe(false)
  })
})

describe('wouldCreateCycle', () => {
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }]
  it('detects cycles and self loops', () => {
    expect(wouldCreateCycle(edges, 'c', 'a')).toBe(true)
    expect(wouldCreateCycle(edges, 'a', 'a')).toBe(true)
    expect(wouldCreateCycle(edges, 'a', 'c')).toBe(false)
  })
})

describe('checkConnection', () => {
  const nodes = [
    { id: 't', type: 'text' },
    { id: 'i', type: 'image' },
    { id: 'g', type: 'image-gen' },
    { id: 'v', type: 'video-gen' },
    { id: 'p', type: 'preview' },
  ]
  it('accepts text -> image-gen prompt', () => {
    expect(checkConnection(nodes, [], { source: 't', sourceHandle: 'out', target: 'g', targetHandle: 'prompt' }).ok).toBe(true)
  })
  it('rejects image -> prompt (type mismatch)', () => {
    const r = checkConnection(nodes, [], { source: 'i', sourceHandle: 'out', target: 'g', targetHandle: 'prompt' })
    expect(r.ok).toBe(false)
  })
  it('rejects second edge into a single-input port but allows multi ports', () => {
    const e = [{ id: 'e1', source: 't', sourceHandle: 'out', target: 'g', targetHandle: 'prompt' }]
    expect(checkConnection(nodes, e, { source: 't', sourceHandle: 'out', target: 'g', targetHandle: 'prompt' }).ok).toBe(false)
    const m = [{ id: 'e2', source: 'i', sourceHandle: 'out', target: 'g', targetHandle: 'ref' }]
    expect(checkConnection(nodes, m, { source: 'i', sourceHandle: 'out', target: 'g', targetHandle: 'ref' }).ok).toBe(true)
  })
  it('lets anything into preview', () => {
    expect(checkConnection(nodes, [], { source: 'i', sourceHandle: 'out', target: 'p', targetHandle: 'in' }).ok).toBe(true)
  })
})

describe('validateProfileInput', () => {
  const base = { name: 'Kling', kind: 'video', adapter: 'replicate', endpoint: 'https://api.replicate.com', model: 'kwaivgi/kling' }
  it('accepts valid input', () => {
    expect(validateProfileInput(base).ok).toBe(true)
  })
  it('rejects bad kind, endpoint and missing fields', () => {
    expect(validateProfileInput({ ...base, kind: 'foo' }).ok).toBe(false)
    expect(validateProfileInput({ ...base, endpoint: 'ftp://x' }).ok).toBe(false)
    expect(validateProfileInput({ ...base, model: '' }).ok).toBe(false)
    expect(validateProfileInput(null).ok).toBe(false)
  })
})
