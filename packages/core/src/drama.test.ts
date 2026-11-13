import { describe, expect, it } from 'vitest'
import { DRAMA_FILE_KINDS, detectDramaFile, dramaToGraph, seedanceSegmentPrompt, subjectRefViews, SEEDANCE_NO_SUBTITLES, SEEDANCE_NO_TWINS, type DramaFiles } from './drama'
import { resolveMentions, subjectsOf } from './subjects'
// the sample project that ships with shuohao-skills (Apache-2.0), see e2e/fixtures/shuohao-dukou
import outline from '../../../e2e/fixtures/shuohao-dukou/outline.json'
import cast from '../../../e2e/fixtures/shuohao-dukou/cast.json'
import art from '../../../e2e/fixtures/shuohao-dukou/art.json'
import script from '../../../e2e/fixtures/shuohao-dukou/script.json'
import storyboard from '../../../e2e/fixtures/shuohao-dukou/storyboard.json'

const files = { outline, cast, art, script, storyboard } as unknown as DramaFiles
let n = 0
const newId = (p: string) => `${p}_${++n}`

describe('short-drama import (shuohao-skills files)', () => {
  it('recognises each file by its shape', () => {
    for (const k of DRAMA_FILE_KINDS) expect(detectDramaFile(files[k])).toBe(k)
    expect(detectDramaFile({ nodes: [] })).toBeUndefined()
  })

  it('turns the whole project into subjects, one group per segment, keyframes, videos and an export', () => {
    const r = dramaToGraph(files, { newId })
    expect(r.counts).toMatchObject({ segments: 10, cuts: 34, groups: 10, skippedSegments: 0 })
    const subjects = subjectsOf({ nodes: r.nodes })
    expect(subjects.map((s) => s.name)).toEqual(expect.arrayContaining(['沈知微', '老周', '渡船船舱', '旧皮箱']))
    expect(subjects.find((s) => s.name === '沈知微')).toMatchObject({ kind: 'character' })
    expect(subjects.find((s) => s.name === '旧皮箱')).toMatchObject({ kind: 'product' })
    // groups are first (drawn under the nodes)
    expect(r.nodes[0]!.type).toBe('group')
    // the first segment: four keyframes as reference pictures in order, a 15-second video
    const v1 = r.nodes.find((x) => x.type === 'video-gen' && x.data.label === 'E01-01')!
    expect(v1.data.params).toMatchObject({ aspect_ratio: '16:9', duration: 15 })
    const into = r.edges.filter((e) => e.target === v1.id)
    expect(into.map((e) => e.targetHandle)).toEqual(['ref', 'ref', 'ref', 'ref'])
    // Seedance structure: picture declarations, per-cut fields, dialogue from the script, constraints
    const p = v1.data.text!
    expect(p.startsWith('@[图片1] = 分镜图 #1\n@[图片2] = 分镜图 #2')).toBe(true)
    expect(p).toContain('【镜头1】\n焦距：35mm 广角，中景深')
    expect(p).toContain('运镜：跟拍')
    expect(p).toContain('（构图参考 @图片1）')
    expect(p).toMatch(/台词：\{上船喽——过河的抓紧，雾要变天。\}/)
    expect(p).toContain(`【约束】\n1. ${SEEDANCE_NO_SUBTITLES}`)
    // the shot text (画面) uses generic identities; names may appear in blocking (as the source writes it)
    expect(p.split('\n').filter((l) => l.startsWith('画面：')).some((l) => l.includes('沈知微'))).toBe(false)
    // the keyframe prompt names the character: on the canvas that is an @mention with its description
    const k1 = r.nodes.find((x) => x.type === 'image-gen' && x.data.label === 'E01-01 · 分镜图 1')!
    expect(k1.data.text).toContain('@沈知微')
    expect(resolveMentions(k1.data.text!, subjects).used.map((s) => s.name)).toContain('沈知微')
    // the export takes every segment, in storyboard order
    const ex = r.nodes.find((x) => x.type === 'export')!
    expect((ex.data.params!.order as string[]).length).toBe(10)
    expect(r.edges.filter((e) => e.target === ex.id)).toHaveLength(10)
  })

  it('H3: uses the file’s own prompt; existing subjects are not created twice; a limit on segments', () => {
    const r = dramaToGraph(files, { newId, protocol: 'h3', existingSubjects: ['沈知微'], maxSegments: 3 })
    expect(r.counts.segments).toBe(3)
    expect(r.counts.skippedSegments).toBe(7)
    expect(r.warnings[0]).toMatch(/只导入前 3 段/)
    expect(subjectsOf({ nodes: r.nodes }).some((s) => s.name === '沈知微')).toBe(false)
    const v = r.nodes.find((x) => x.type === 'video-gen')!
    expect(v.data.text).toMatch(/^How the reference pictures align with the target video/)
  })

  it('only the cast: character subjects; nothing at all is refused', () => {
    const r = dramaToGraph({ cast: files.cast }, { newId })
    expect(r.nodes.every((x) => x.type === 'subject')).toBe(true)
    expect(r.nodes.length).toBeGreaterThan(2)
    expect(() => dramaToGraph({}, { newId })).toThrow(/没有可导入的内容/)
  })
})

describe('Seedance segment prompt', () => {
  it('one cut, no pictures; two people on screen add the no-twins rule', () => {
    const p = seedanceSegmentPrompt({ id: 'E01-01', blocking: '甲在左，乙在右', cuts: [{ shot: '一名老人抬头', camera: 'Push In', size: 'close', characters: ['C01', 'C02'] }] }, { lines: [[{ speaker: 'VO', text: '走吧。' }]] })
    expect(p).toContain('【人物关系与构图逻辑】\n甲在左，乙在右')
    expect(p).toContain('运镜：推镜\n景别：特写\n画面：一名老人抬头\n台词：以画外音说{走吧。}')
    expect(p).toContain(`2. ${SEEDANCE_NO_TWINS}`)
    expect(p).not.toContain('@[图片')
  })
})

describe('reference sets (character-refs method)', () => {
  it('a character: an anchor from text, then views that only reference the anchor', () => {
    const v = subjectRefViews({ name: '小橘', kind: 'character', description: '橘色短毛猫' })
    expect(v.map((x) => x.id)).toEqual(['front-full', 'face-front', 'side-full', 'back-full'])
    expect(v[0]!.from).toEqual([])
    expect(v.slice(1).every((x) => x.from.join() === 'front-full')).toBe(true)
    expect(v[0]!.prompt).toMatch(/^Full-body front view/)
    expect(v[0]!.prompt).toContain('橘色短毛猫')
    expect(v[1]!.prompt).toMatch(/^Zoom in to an extreme close-up head-and-shoulders portrait/)
    expect(v[3]!.negative).toContain('face')
    // the look changes how it is drawn, not who it is
    expect(subjectRefViews({ name: 'x', kind: 'character', description: 'd' }, 'realistic')[0]!.prompt).toContain('A real photograph, not a render')
  })

  it('a scene is one empty establishing view; a product is front + side + detail', () => {
    expect(subjectRefViews({ name: 's', kind: 'scene', description: '渡船船舱' }).map((x) => x.id)).toEqual(['scene-wide'])
    expect(subjectRefViews({ name: 'p', kind: 'product', description: '旧皮箱' }).map((x) => x.id)).toEqual(['product-front', 'product-side', 'product-detail'])
  })
})
