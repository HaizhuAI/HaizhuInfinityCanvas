import { describe, expect, it } from 'vitest'
import { cleanTrim, timelineOf, timelineOrder, trimmedSpan } from './timeline'

describe('timeline', () => {
  it('orders listed clips first, the rest as they were', () => {
    expect(timelineOrder(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual([2, 0, 1, 3])
    // a node with two clips keeps them together in its slot
    expect(timelineOrder(['a', 'b', 'b', 'c'], ['b'])).toEqual([1, 2, 0, 3])
    expect(timelineOrder(['a', 'b'], [])).toEqual([0, 1])
  })

  it('checks trims and params', () => {
    expect(cleanTrim({ in: 1.234, out: 4 })).toEqual({ in: 1.23, out: 4 })
    expect(cleanTrim({ in: 3, out: 3.05 })).toEqual({ in: 3 }) // too short: out dropped
    expect(cleanTrim({ in: -1 })).toBeUndefined()
    expect(cleanTrim('x')).toBeUndefined()
    expect(timelineOf({ order: ['a', 'a', 5, 'b'], trims: { a: { in: 1 }, b: { in: 0 }, c: 'bad' } })).toEqual({ order: ['a', 'b'], trims: { a: { in: 1 } } })
    expect(timelineOf(undefined)).toEqual({ order: [], trims: {} })
  })

  it('a trim never runs past the clip', () => {
    expect(trimmedSpan({ in: 1, out: 3 }, 5)).toEqual({ start: 1, length: 2 })
    expect(trimmedSpan({ in: 2 }, 5)).toEqual({ start: 2, length: 3 })
    expect(trimmedSpan({ out: 9 }, 5)).toEqual({ start: 0, length: 5 })
    expect(trimmedSpan({ in: 8 }, 5).length).toBeGreaterThanOrEqual(0.1)
  })
})
