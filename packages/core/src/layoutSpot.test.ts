import { describe, expect, it } from 'vitest'
import { findFreeSpot } from './layout'

describe('findFreeSpot', () => {
  it('keeps a free spot, and moves below whatever it would cover', () => {
    const nodes = [{ id: 'a', position: { x: 0, y: 0 }, measured: { width: 300, height: 200 } }, { id: 'g', type: 'group', position: { x: 400, y: 0 }, data: { size: { w: 800, h: 500 } } }]
    expect(findFreeSpot(nodes, { x: 400, y: 600 }, { w: 300, h: 300 })).toEqual({ x: 400, y: 600 })
    expect(findFreeSpot(nodes, { x: 420, y: 100 }, { w: 300, h: 300 })).toEqual({ x: 420, y: 540 })
    // a node the block will hold does not push it away
    expect(findFreeSpot(nodes, { x: 420, y: 100 }, { w: 300, h: 300 }, new Set(['g']))).toEqual({ x: 420, y: 100 })
  })
})
