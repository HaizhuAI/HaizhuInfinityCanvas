import { describe, expect, it } from 'vitest'
import { pickReversed, splitReversedPrompt } from './prompts'

// Sample answers written for these tests in the shapes reverse skills and templates produce.
describe('splitReversedPrompt', () => {
  it('splits a bilingual answer with a negative section (markdown headings)', () => {
    const text = [
      '### 1. 正向 Prompt',
      '',
      '中文：清晨的海边灯塔位于画面右侧三分线，低机位仰视，柔和逆光勾出白色塔身轮廓。',
      '',
      'English: A white lighthouse on the right third of the frame at dawn, low angle, soft backlight rimming the tower.',
      '',
      '### 2. Negative Prompt',
      '',
      'cartoon, 3d render, oversaturated, extra towers, watermark, blurry',
    ].join('\n')
    const r = splitReversedPrompt(text)
    expect(r.zh).toBe('清晨的海边灯塔位于画面右侧三分线，低机位仰视，柔和逆光勾出白色塔身轮廓。')
    expect(r.en).toMatch(/^A white lighthouse/)
    expect(r.en).not.toMatch(/Negative/)
    expect(r.negative).toBe('cartoon, 3d render, oversaturated, extra towers, watermark, blurry')
    expect(pickReversed(r, 'zh')).toBe(r.zh)
    expect(pickReversed(r, 'en')).toBe(r.en)
  })

  it('handles bold labels and a negative on the same line as its label', () => {
    const r = splitReversedPrompt('**正向提示词**\n**中文：** 雨夜霓虹街头\n**English:** neon street on a rainy night\n\n**负面词：** daylight, people, text')
    expect(r.zh).toBe('雨夜霓虹街头')
    expect(r.en).toBe('neon street on a rainy night')
    expect(r.negative).toBe('daylight, people, text')
  })

  it('splits the SDXL template answer (tags, then "Negative:")', () => {
    const r = splitReversedPrompt('1girl, red scarf, snowy street, cinematic lighting, masterpiece\nNegative: lowres, bad hands, watermark')
    expect(r.en).toBe('1girl, red scarf, snowy street, cinematic lighting, masterpiece')
    expect(r.zh).toBeUndefined()
    expect(r.negative).toBe('lowres, bad hands, watermark')
    expect(pickReversed(r, 'zh')).toBe(r.en) // falls back to the language there is
  })

  it('a plain one-paragraph answer is the prompt, in the language it is written in', () => {
    const zh = splitReversedPrompt('一只橘猫趴在窗台上晒太阳，暖色调，浅景深。')
    expect(zh).toMatchObject({ zh: '一只橘猫趴在窗台上晒太阳，暖色调，浅景深。', en: undefined, negative: undefined })
    const en = splitReversedPrompt('```\nAn orange cat on a sunny windowsill, warm tones, shallow depth of field.\n```')
    expect(en.en).toBe('An orange cat on a sunny windowsill, warm tones, shallow depth of field.')
    expect(pickReversed(splitReversedPrompt(''), 'zh')).toBe('')
  })

  it('"Negative space" in the prompt is not the negative section', () => {
    const r = splitReversedPrompt('Negative space on the left, a lone tree on the right, minimalist.\nNegative prompt: clutter, text')
    expect(r.en).toBe('Negative space on the left, a lone tree on the right, minimalist.')
    expect(r.negative).toBe('clutter, text')
  })
})
