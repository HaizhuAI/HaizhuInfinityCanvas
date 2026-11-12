import { describe, expect, it } from 'vitest'
import { isSubjectName, mentionedSubjects, resolveMentions, subjectOf, subjectsOf, type Subject } from './subjects'

const s = (name: string, description = '', images = 0): Subject => ({ nodeId: name, name, kind: 'character', description, images: Array.from({ length: images }, (_, i) => ({ assetId: `a${i}`, mime: 'image/png' })) })

describe('subjects', () => {
  it('reads a subject node; bad names and other nodes are not subjects', () => {
    const n = { id: 'n', type: 'subject', position: { x: 0, y: 0 }, data: { text: ' 橘色短毛猫 ', params: { name: '小橘', kind: 'character', images: [{ assetId: 'x', mime: 'image/png' }, { bogus: 1 }] } } }
    expect(subjectOf(n)).toEqual({ nodeId: 'n', name: '小橘', kind: 'character', description: '橘色短毛猫', images: [{ assetId: 'x', mime: 'image/png' }] })
    expect(subjectOf({ ...n, data: { params: { name: 'has space' } } })).toBeUndefined()
    expect(subjectOf({ ...n, type: 'text' })).toBeUndefined()
    expect(isSubjectName('@x')).toBe(false)
    expect(isSubjectName('Lily')).toBe(true)
    const g = { nodes: [n, { ...n, id: 'm' }] }
    expect(subjectsOf(g)).toHaveLength(1) // the first of two with the same name wins
  })

  it('finds mentions, longest name first, in order of appearance', () => {
    const subs = [s('小橘'), s('小橘猫'), s('灯塔')]
    expect(mentionedSubjects('@灯塔下的@小橘猫', subs).map((x) => x.name)).toEqual(['灯塔', '小橘猫'])
    expect(mentionedSubjects('@小橘 和 @小橘猫', subs).map((x) => x.name)).toEqual(['小橘', '小橘猫'])
    expect(mentionedSubjects('没有提到', subs)).toEqual([])
    expect(mentionedSubjects('邮箱 a@b.com', subs)).toEqual([])
  })

  it('replaces mentions with names and adds each description once', () => {
    const r = resolveMentions('@小橘 坐在 @灯塔 下，@小橘 抬头', [s('小橘', '橘色短毛猫，绿眼睛', 2), s('灯塔')])
    expect(r.text).toBe('小橘 坐在 灯塔 下，小橘 抬头\n\n设定：\n- 小橘（人物）：橘色短毛猫，绿眼睛')
    expect(r.used.map((x) => x.name)).toEqual(['小橘', '灯塔'])
    expect(resolveMentions('plain', [s('小橘')])).toEqual({ text: 'plain', used: [] })
  })
})
