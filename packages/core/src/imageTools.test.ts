import { describe, expect, it } from 'vitest'
import { angleLabel, buildAnglePrompt, buildRelightPrompt, gridCells, readRelight, relightLabel } from './imageTools'

describe('image tools (prompts adapted from Toonflow, MIT)', () => {
  it('换角度: the camera moves, the subject does not; rear views reveal hidden surfaces', () => {
    const p = buildAnglePrompt({ azimuth: 45, elevation: 0, distance: 4.8, lens: 'standard' })
    expect(p).toMatch(/^Photograph the scene in the reference image from a NEW CAMERA POSITION/)
    expect(p).toContain('Move the CAMERA 45 degrees around the subject toward the RIGHT edge')
    expect(p).toContain('the new camera is (3.394, 0, 3.394)')
    expect(p).not.toContain('{{ref')
    expect(buildAnglePrompt({ azimuth: -180 })).toContain('REVERSE VIEW')
    expect(buildAnglePrompt({ azimuth: 135 })).toContain('REAR VIEW')
    expect(buildAnglePrompt({ elevation: 60 })).toContain('with the lens aimed DOWN')
    expect(buildAnglePrompt({ lens: 'wide' })).toContain('24mm equivalent wide-angle lens')
    expect(angleLabel({ azimuth: -45, distance: 3 })).toBe('左前 · 近景')
    // out-of-range input is brought back in range
    expect(buildAnglePrompt({ azimuth: 540, elevation: 200, distance: 99 })).toContain('Camera distance: 10.0')
  })

  it('重新打光: keeps the picture, moves the light; presets set direction, colour and rim', () => {
    const neon = readRelight({ preset: 'neon' })
    expect(neon).toMatchObject({ azimuth: 90, color: '#52e5ec', rim: true, rimColor: '#ff67ca' })
    const p = buildRelightPrompt({ preset: 'neon', note: '更冷一点' })
    expect(p).toMatch(/^Relight the reference image while keeping its original scene/)
    expect(p).toContain('contrasting cyan and pink light')
    expect(p).toContain('更冷一点')
    expect(p).toContain('directly to reference-image RIGHT of the subject')
    expect(p).toContain('tinted toward #ff67ca')
    expect(buildRelightPrompt({ azimuth: -180, elevation: 20 })).toContain('This is backlighting')
    expect(relightLabel({ preset: 'noir' })).toBe('暗影悬疑')
    expect(relightLabel({ azimuth: 0, elevation: 85 })).toBe('顶光')
  })

  it('宫格切分: equal cells, row by row', () => {
    const c = gridCells(3, 3)
    expect(c).toHaveLength(9)
    expect(c[4]).toMatchObject({ row: 1, col: 1, x: 1 / 3, y: 1 / 3 })
    expect(gridCells(0, 99)).toHaveLength(8)
  })
})
