import { describe, expect, it } from 'vitest'
import { durationOptions, maxVideoDuration, videoCaps } from './videoCaps'

describe('video model capabilities', () => {
  it('knows Seedance 2.0 / 2.5 and MiniMax H3 by model id; others keep 5 / 10 seconds', () => {
    expect(videoCaps({ adapter: 'ark', model: 'doubao-seedance-2-0-260128' })).toMatchObject({ label: 'Seedance 2.0', resolutions: ['480p', '720p', '1080p'], audio: true, maxRefs: 9 })
    expect(maxVideoDuration({ model: 'doubao-seedance-2-0-260128' })).toBe(15)
    expect(videoCaps({ model: 'doubao-seedance-2-0-fast-260128' }).resolutions).toEqual(['480p', '720p'])
    expect(videoCaps({ model: 'doubao-seedance-2-5' })).toMatchObject({ label: 'Seedance 2.5' })
    expect(maxVideoDuration({ model: 'seedance-2.5' })).toBe(30)
    expect(videoCaps({ adapter: 'minimax', model: 'MiniMax-H3' })).toMatchObject({ label: 'MiniMax H3', resolutions: ['768P', '2K'] })
    expect(maxVideoDuration({ model: 'MiniMax-H3' })).toBe(30)
    expect(videoCaps({ model: 'doubao-seedance-1-0-pro-250528' }).durations).toEqual([5, 10])
    expect(videoCaps({ model: 'MiniMax-Hailuo-02' }).durations).toEqual([5, 10])
    expect(videoCaps(undefined).audio).toBeUndefined()
  })

  it('a length set elsewhere stays in the menu', () => {
    expect(durationOptions({ model: 'kling-v2' }, 15)).toEqual([5, 10, 15])
    expect(durationOptions({ model: 'seedance-2.0' }, 12)).toHaveLength(12)
  })
})
