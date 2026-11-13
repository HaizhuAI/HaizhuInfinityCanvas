/**
 * 短剧工坊 (rc.19): what this canvas learned from shuohao-skills (https://github.com/eternityspring/shuohao-skills,
 * Copyright 2026 烁皓, Apache License 2.0 — see THIRD_PARTY_NOTICES.md). Three parts:
 *
 *  1. Reference sets for subjects — the character-refs method: one front full-body anchor generated from
 *     text, every other view generated from the anchor only (never chained), with the view prompts and
 *     the anime / realistic looks that skill tested. Adapted: the canvas has one free-text description
 *     per subject instead of the skill's structured intake, and neutral pronouns.
 *  2. The Seedance segment prompt — the novel-storyboard composer: reference declarations, blocking,
 *     per-cut quantified composition fields, dialogue in {}, sound in <>, music in （）, numbered
 *     constraints (no subtitles; no identical twins when several people share the frame).
 *  3. An importer: the JSON files the shuohao pipeline writes (outline / cast / art / script /
 *     storyboard) become canvas nodes — subjects for characters, scenes and props, one group per
 *     segment with a keyframe image node per cut and one video node, and an export node in order.
 */
import type { GraphEdge, GraphNode } from './graph'
import { GROUP_TYPE } from './graph'
import { isSubjectName, type SubjectKind } from './subjects'

// ------------------------------------------------------------------ 1. reference sets

export const REF_LOOKS = ['anime', 'realistic'] as const
export type RefLook = (typeof REF_LOOKS)[number]
export const REF_LOOK_LABEL: Record<RefLook, string> = { anime: '动漫', realistic: '写实照片' }

/** how the picture is drawn; who it shows comes from the subject (character-refs looks.mjs) */
const LOOKS: Record<RefLook, { style: string; clean: string; neg: string }> = {
  anime: {
    style: 'A clean 2D Japanese anime illustration, like official character art for a TV anime: crisp confident line art of even weight, ' +
      'cel shading with one soft shadow tone and a few sharp highlights, flat clean colors, anime-style eyes with clear highlights, ' +
      'a small simplified nose and mouth, hair drawn in smooth clumps with glossy highlight bands. Fabric folds drawn as simple lines.',
    clean: 'Plain pure white background, evenly lit, with at most a faint soft shadow under the feet. Exactly one character, empty hands, no props, no text, no watermark.',
    neg: 'photograph, photorealistic, realistic skin texture, pores, film grain, 3D render, CGI, semi-realistic, painterly, watercolor, ' +
      'sketch, rough lines, messy lines, heavy shading, gradient background, character sheet, multiple views, chibi, super deformed',
  },
  realistic: {
    style: 'A real photograph, not a render: shot on a full-frame digital camera with an 85mm portrait lens at f/5.6, natural true-to-life ' +
      "colors and white balance. Natural skin texture with the pores and fine lines the person's age calls for, a no-makeup look, " +
      'no retouching, no beauty filter. Real fabric with natural creases. Subtle film grain.',
    clean: 'White seamless paper backdrop lit to pure white. A soft directional key light from the front-left with a weaker fill, so the face ' +
      'and clothes have gentle natural shadows and volume. Exactly one person, empty hands, no props, no text, no watermark.',
    neg: 'CGI, 3D render, digital painting, illustration, anime, airbrushed skin, smooth plastic skin, waxy skin, doll face, ' +
      'beauty filter, overly symmetrical face, oversharpened, HDR, glossy, over-saturated, flat lighting, porcelain skin, big anime eyes',
  },
}
const BASE_NEG = 'text, watermark, border, multiple people, extra limbs, deformed hands, props, scenery, colored background, oversaturated colors'
const FACE_NEG = `${BASE_NEG}, waist, torso, arms, hands, full body, legs, feet, wide shot, medium shot`

/** one picture of a reference set: its prompt, what to avoid, and which views it is generated from */
export interface RefView { id: string; label: string; prompt: string; negative: string; aspect: string; from: string[] }

/** the views of a subject's reference set, anchor first (it is the only one made from text alone) */
export function subjectRefViews(s: { name: string; kind: SubjectKind; description: string }, look: RefLook = 'anime'): RefView[] {
  const L = LOOKS[look]
  const desc = s.description.trim() || s.name
  if (s.kind === 'scene') {
    // a scene sheet: the place itself, empty — people come from their own subjects (novel-art's white plates)
    return [{
      id: 'scene-wide', label: '场景全景', aspect: '16:9', from: [],
      prompt: `An establishing wide view of this place, empty, with no people and no hands in frame: ${desc}. ${look === 'anime' ? 'Clean 2D anime background art, crisp lines, flat clean colors.' : 'A real photograph with natural light, not a render.'} No text, no watermark.`,
      negative: 'people, human figures, characters, crowds, silhouettes of people, text, watermark, warped perspective, melted geometry',
    }]
  }
  if (s.kind === 'product') {
    const clean = 'Plain pure white background, evenly lit, exactly one object, no hands, no people, no text, no watermark.'
    const keep = `Keep exactly the same object as in the reference image: same shape, materials, colors and markings. ${clean}`
    return [
      { id: 'product-front', label: '正面（锚点）', aspect: '1:1', from: [], prompt: `A front view of one object, centered and whole, with margin on every side: ${desc}. ${look === 'anime' ? 'Clean 2D anime illustration, crisp line art, flat clean colors.' : 'A real product photograph, not a render.'} ${clean}`, negative: `${BASE_NEG}, hands, people, cropped object` },
      { id: 'product-side', label: '侧面', aspect: '1:1', from: ['product-front'], prompt: `Rotate the camera 90 degrees around this same object: a side view, centered and whole. ${keep}`, negative: `${BASE_NEG}, front view, hands, people` },
      { id: 'product-detail', label: '细节特写', aspect: '1:1', from: ['product-front'], prompt: `Zoom in to an extreme close-up of only the most recognizable detail of this same object; it fills the entire frame. Same object, same materials as in the reference image. ${clean}`, negative: `${BASE_NEG}, whole object, wide shot, hands, people` },
    ]
  }
  // a character: front full-body anchor, then a passport-style headshot, a 90° profile and the back view
  const who = 'this same character'
  const keep = (items: string) => `Keep them exactly the same person as in the reference image: ${items}. ${L.style} ${L.clean}`
  const tight = 'Framing: the top of the head is just below the top edge of the image, the chin sits at the vertical middle of the image, and the bottom edge of the image cuts across the collarbones.'
  return [
    {
      id: 'front-full', label: '正面全身（锚点）', aspect: '3:4', from: [],
      prompt: 'Full-body front view: the character stands straight and faces the camera squarely, shoulders, hips and feet square to the camera, ' +
        'the face pointing straight at the camera with the nose on the vertical centre line of the face and both ears equally visible, ' +
        'arms relaxed at the sides, the whole figure from head to feet visible and centered, with margin above the head and below the feet. ' +
        `The character: ${desc}. ${L.style} ${L.clean}`,
      negative: `${BASE_NEG}, ${L.neg}, cropped feet, cropped head, three-quarter view, turned body, head turned to the side, contrapposto, dynamic pose`,
    },
    {
      id: 'face-front', label: '正脸大头照', aspect: '3:4', from: ['front-full'],
      prompt: `Zoom in to an extreme close-up head-and-shoulders portrait, passport-photo framing, of ${who} facing the camera squarely. ${tight} ` +
        'The character faces straight at the camera: the nose is on the vertical centre line of the image and both ears are equally visible. ' +
        `${keep('the same face, eyes and eyebrows, the same hair, the same top')} Framing reminder: the bottom edge of the image cuts across the collarbones, so the arms, sleeves and cuffs are out of frame.`,
      negative: `${FACE_NEG}, ${L.neg}, three-quarter view, head turned to the side, profile, tilted head`,
    },
    {
      id: 'side-full', label: '侧面 90°（朝右）', aspect: '3:4', from: ['front-full'],
      prompt: `Full-body side profile of ${who}: the whole body and the head both face the right edge of the image, looking straight ahead to the right, not at the camera. ` +
        `Only the right side of the face is visible. Head to feet in frame. ${keep('the same face, eyes and eyebrows, the same hair, the same clothing')}`,
      negative: `${BASE_NEG}, ${L.neg}, looking at camera, front view, three-quarter view, both eyes visible, cropped feet`,
    },
    {
      id: 'back-full', label: '背面', aspect: '3:4', from: ['front-full'],
      prompt: `Rotate the camera 180 degrees around ${who}: a full-body back view. The character stands with their back to the camera and the face is completely hidden. ` +
        `We see the back of the head and the hair as seen from behind, the back of the clothing, and the heels. Head to feet in frame. ${keep('the same hair, the same clothing')}`,
      negative: `${BASE_NEG}, ${L.neg}, face, eyes, nose, front view, buttons, pockets, looking at camera`,
    },
  ]
}

// ------------------------------------------------------------------ 2. the Seedance segment prompt

export const SHOT_SIZE_ZH: Record<string, string> = { 'extreme-wide': '大远景', wide: '全景', medium: '中景', close: '特写', 'extreme-close': '大特写' }
/** H3's camera vocabulary in Chinese (Seedance takes the full Chinese phrase) */
export const CAMERA_MOVE_ZH: Record<string, string> = {
  'Static Shot': '固定镜头', 'Push In': '推镜', 'Pull Out': '拉镜', 'Zoom In': '变焦推', 'Zoom Out': '变焦拉', 'Pan Left': '左摇', 'Pan Right': '右摇',
  'Truck Left': '左移', 'Truck Right': '右移', 'Tilt Up': '仰摇', 'Tilt Down': '俯摇', 'Pedestal Up': '升', 'Pedestal Down': '降', 'Arc Shot': '环绕',
  'Tracking Shot': '跟拍', 'Shake Slightly': '轻微晃动', 'Shake Strongly': '强烈晃动', POV: '主观视角', 'Roll Clockwise': '顺旋', 'Roll Counterclockwise': '逆旋',
}
const STABILITY_ZH: Record<string, string> = { stable: '稳定', 'slight-shake': '微晃', handheld: '手持' }
export const SEEDANCE_NO_SUBTITLES = '保持无字幕，避免生成任何文字或字幕'
export const SEEDANCE_NO_TWINS = '视频全程禁止出现外形、着装、配饰完全一致的人物'

export interface DramaCut {
  beats?: [number, number]; seconds?: number; size?: string; camera?: string; characters?: string[]; props?: string[]
  frame?: string; shot?: string; lens?: string; cameraPosition?: string; composition?: string; eyeline?: string; focus?: string
  stability?: string; sfx?: string; lighting?: string
}
export interface DramaSegment { id: string; sceneIndex?: number; cuts: DramaCut[]; h3Prompt?: string; blocking?: string; soundscape?: string; music?: string }
export interface DramaLine { speaker?: string; text: string }

/**
 * The prompt for one segment in Seedance's structure. `refs` are the labels of the pictures attached
 * in order (@[图片k]); `frameRef[ci]` is the picture number of cut ci's keyframe, if attached. Dialogue
 * goes in {} word for word ("以画外音说" for voice-over), never the characters' names in the shot text.
 */
export function seedanceSegmentPrompt(seg: DramaSegment, o: { refs?: string[]; frameRef?: (number | undefined)[]; lines?: DramaLine[][]; constraints?: string[] } = {}): string {
  const out: string[] = (o.refs ?? []).map((label, i) => `@[图片${i + 1}] = ${label}`)
  if (out.length) out.push('')
  const blocking = (seg.blocking ?? '').trim()
  if (blocking) out.push('【人物关系与构图逻辑】', blocking, '')
  seg.cuts.forEach((cut, ci) => {
    const line = (k: string, v: unknown) => { const t = String(v ?? '').trim(); if (t) out.push(`${k}：${t}`) }
    out.push(`【镜头${ci + 1}】`)
    line('焦距', cut.lens)
    line('机位', cut.cameraPosition)
    line('构图', cut.composition)
    line('运镜', CAMERA_MOVE_ZH[cut.camera ?? ''] ?? cut.camera)
    line('景别', SHOT_SIZE_ZH[cut.size ?? ''] ?? cut.size)
    const shot = (cut.shot ?? '').trim()
    const ref = o.frameRef?.[ci]
    if (shot) out.push(`画面：${shot}${ref ? `（构图参考 @图片${ref}）` : ''}`)
    line('光影', cut.lighting)
    const spoken = o.lines?.[ci] ?? []
    out.push(`台词：${spoken.length ? spoken.map((b) => `${b.speaker === 'VO' ? '以画外音说' : ''}{${b.text}}`).join(' ') : '{}'}`)
    line('视线落点', cut.eyeline)
    line('焦点', cut.focus)
    line('稳定性', STABILITY_ZH[cut.stability ?? ''] ?? cut.stability)
    line('音效', cut.sfx)
    out.push('')
  })
  const soundscape = (seg.soundscape ?? '').trim(), music = (seg.music ?? '').trim()
  if (soundscape) out.push(`<${soundscape}>`)
  if (music) out.push(`（${music}）`)
  if (soundscape || music) out.push('')
  const rules = (o.constraints ?? []).map((c) => c.trim()).filter(Boolean)
  if (!rules.includes(SEEDANCE_NO_SUBTITLES)) rules.push(SEEDANCE_NO_SUBTITLES)
  const crowded = seg.cuts.some((c) => (c.characters ?? []).filter((id) => id !== 'VO').length >= 2)
  if (crowded && !rules.includes(SEEDANCE_NO_TWINS)) rules.push(SEEDANCE_NO_TWINS)
  out.push('【约束】', ...rules.map((r, i) => `${i + 1}. ${r}`))
  return out.join('\n')
}

// ------------------------------------------------------------------ 3. importing a shuohao project

export const DRAMA_FILE_KINDS = ['outline', 'cast', 'art', 'script', 'storyboard'] as const
export type DramaFileKind = (typeof DRAMA_FILE_KINDS)[number]
export const DRAMA_FILE_LABEL: Record<DramaFileKind, string> = { outline: '大纲', cast: '角色', art: '场景与道具', script: '剧本', storyboard: '分镜' }
export type DramaFiles = Partial<Record<DramaFileKind, unknown>>
export class DramaImportError extends Error {}

type O = Record<string, unknown>
const obj = (v: unknown): O => (v && typeof v === 'object' && !Array.isArray(v) ? (v as O) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const txt = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '')

/** which of the five files a parsed JSON is (by its shape), or undefined */
export function detectDramaFile(v: unknown): DramaFileKind | undefined {
  const o = obj(v)
  const eps = arr(o.episodes).map(obj)
  if (eps.some((e) => Array.isArray(e.segments))) return 'storyboard'
  if (eps.some((e) => arr(e.scenes).some((s) => Array.isArray(obj(s).flow)))) return 'script'
  const chars = arr(o.characters).map(obj)
  if (chars.length && chars.some((c) => c.persona || c.image) && !chars.some((c) => typeof c.id === 'string')) return 'cast'
  if (o.adaptation || (chars.some((c) => typeof c.id === 'string') && Array.isArray(o.episodes))) return 'outline'
  if (arr(o.scenes).some((s) => Array.isArray(obj(s).anchors)) || arr(o.props).some((p) => Array.isArray(obj(p).anchors))) return 'art'
  return undefined
}

/** a usable @name from a name in the files */
const subjectName = (name: string) => name.replace(/[\s@]+/g, '').slice(0, 24)

export interface DramaImportOptions {
  /** which video prompt goes into the segment nodes: the composed Seedance prompt, or the file's H3 prompt */
  protocol?: 'seedance' | 'h3'
  /** top-left of the imported block */
  origin?: { x: number; y: number }
  /** new ids (the canvas and the server each have their own) */
  newId: (prefix: 'n' | 'e' | 'g') => string
  /** names of subjects already on the canvas: not created again */
  existingSubjects?: string[]
  /** at most this many segments (keeps a huge storyboard from flooding the canvas) */
  maxSegments?: number
}
export interface DramaImportResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
  counts: { subjects: number; segments: number; cuts: number; groups: number; skippedSegments: number }
  warnings: string[]
}

/** the shuohao JSON files → canvas nodes and wires */
export function dramaToGraph(files: DramaFiles, opts: DramaImportOptions): DramaImportResult {
  const warnings: string[] = []
  const outline = obj(files.outline), cast = obj(files.cast), art = obj(files.art), script = obj(files.script), sb = obj(files.storyboard)
  if (!Object.keys(outline).length && !Object.keys(cast).length && !Object.keys(art).length && !Object.keys(sb).length && !Object.keys(script).length) {
    throw new DramaImportError('没有可导入的内容：请选择 shuohao-skills 输出的 outline / cast / art / script / storyboard JSON 文件')
  }
  const x0 = opts.origin?.x ?? 0, y0 = opts.origin?.y ?? 0
  const nodes: GraphNode[] = [], edges: GraphEdge[] = []
  const existing = new Set(opts.existingSubjects ?? [])

  // ids → names (outline is where C01 / S01 / P01 are defined; art repeats scene and prop ids)
  const names = { char: new Map<string, string>(), scene: new Map<string, string>(), prop: new Map<string, string>() }
  for (const c of arr(outline.characters).map(obj)) if (txt(c.id) && txt(c.name)) names.char.set(txt(c.id), txt(c.name))
  for (const s of [...arr(outline.scenes), ...arr(art.scenes)].map(obj)) if (txt(s.id) && txt(s.name)) names.scene.set(txt(s.id), txt(s.name))
  for (const p of [...arr(outline.props), ...arr(art.props)].map(obj)) if (txt(p.id) && txt(p.name)) names.prop.set(txt(p.id), txt(p.name))

  // ---- subjects: characters (cast, else outline), scenes and props (art, else outline)
  type Sub = { name: string; kind: SubjectKind; text: string }
  const subs: Sub[] = []
  const add = (name: string, kind: SubjectKind, text: string) => {
    const n = subjectName(name)
    if (!isSubjectName(n) || subs.some((s) => s.name === n)) return
    subs.push({ name: n, kind, text })
  }
  const castChars = arr(cast.characters).map(obj)
  if (castChars.length) for (const c of castChars) {
    const persona = obj(c.persona), image = obj(c.image)
    add(txt(c.name), 'character', txt(image.prompt) || [txt(persona.appearance), txt(c.oneLiner)].filter(Boolean).join('\n'))
  } else for (const c of arr(outline.characters).map(obj)) add(txt(c.name), 'character', [txt(c.role), txt(c.arc)].filter(Boolean).join('：'))
  const artScenes = arr(art.scenes).map(obj), artProps = arr(art.props).map(obj)
  const anchorsText = (o: O) => arr(o.anchors).map(obj).map((a) => `${txt(a.name)}：${txt(a.desc)}`).filter((t) => t.length > 1).join('；')
  if (artScenes.length) for (const s of artScenes) add(txt(s.name), 'scene', txt(obj(s.image).prompt) || [txt(s.summary), anchorsText(s)].filter(Boolean).join('\n'))
  else for (const s of arr(outline.scenes).map(obj)) add(txt(s.name), 'scene', '')
  if (artProps.length) for (const p of artProps) add(txt(p.name), 'product', txt(obj(p.image).prompt) || [txt(p.summary), anchorsText(p)].filter(Boolean).join('\n'))
  else for (const p of arr(outline.props).map(obj)) add(txt(p.name), 'product', txt(p.function))
  let row = 0
  for (const s of subs) {
    if (existing.has(s.name)) continue
    nodes.push({
      id: opts.newId('n'), type: 'subject', position: { x: x0, y: y0 + row * 460 },
      data: { label: `@${s.name}`, text: s.text, params: { name: s.name, kind: s.kind, images: [] } },
    })
    row++
  }
  const subjectNames = new Set([...existing, ...subs.map((s) => s.name)])

  // ---- the storyboard: one group per segment (keyframes per cut → one video), an export at the end
  const aspect = txt(sb.aspectRatio) === '9:16' ? '9:16' : '16:9'
  const scriptEps = new Map(arr(script.episodes).map(obj).map((e) => [Number(e.ep), arr(e.scenes).map(obj)]))
  const mention = (frame: string) => {
    // the frame prompt names characters directly; on the canvas that is an @mention (description + pictures)
    let t = frame
    for (const n of [...subjectNames].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(`(?<!@)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), `@${n}`)
    return t
  }
  const segs: { ep: number; seg: DramaSegment }[] = []
  for (const e of arr(sb.episodes).map(obj)) for (const s of arr(e.segments).map(obj)) {
    const cuts = arr(s.cuts).map(obj).map((c): DramaCut => ({
      beats: Array.isArray(c.beats) && c.beats.length === 2 ? [Number(c.beats[0]), Number(c.beats[1])] : undefined,
      seconds: Number(c.seconds) > 0 ? Number(c.seconds) : 3,
      size: txt(c.size), camera: txt(c.camera), characters: arr(c.characters).map((x) => txt(x)).filter(Boolean), props: arr(c.props).map((x) => txt(x)).filter(Boolean),
      frame: txt(c.frame), shot: txt(c.shot), lens: txt(c.lens), cameraPosition: txt(c.cameraPosition), composition: txt(c.composition),
      eyeline: txt(c.eyeline), focus: txt(c.focus), stability: txt(c.stability), sfx: txt(c.sfx), lighting: txt(c.lighting),
    }))
    if (!cuts.length) continue
    segs.push({ ep: Number(e.ep) || 1, seg: { id: txt(s.id) || `E${String(e.ep).padStart(2, '0')}-${String(segs.length + 1).padStart(2, '0')}`, sceneIndex: Number(s.sceneIndex) || undefined, cuts, h3Prompt: txt(s.h3Prompt, 12000), blocking: txt(s.blocking), soundscape: txt(s.soundscape), music: txt(s.music) } })
  }
  const max = opts.maxSegments ?? 60
  const skipped = Math.max(0, segs.length - max)
  if (skipped) warnings.push(`分镜有 ${segs.length} 段，这次只导入前 ${max} 段（其余可以分批导入）`)
  const used = segs.slice(0, max)
  if (Object.keys(sb).length && !used.length) warnings.push('分镜文件里没有可用的段（segments）')
  if (used.length && !scriptEps.size) warnings.push('没有剧本（script.json）：视频提示词里的台词留空 {}')
  const protocol = opts.protocol ?? 'seedance'
  if (protocol === 'h3' && used.some(({ seg }) => !seg.h3Prompt)) warnings.push('有的段没有 H3 提示词，这些段改用 Seedance 写法')

  const COL = 400, ROW = 560, PAD = 40, HEAD = 48
  const sx = x0 + (nodes.length ? 520 : 0)
  const videoIds: string[] = []
  let cuts = 0
  used.forEach(({ ep, seg }, si) => {
    const top = y0 + si * ROW
    const scene = seg.sceneIndex ? scriptEps.get(ep)?.[seg.sceneIndex - 1] : undefined
    const flow = arr(scene?.flow).map(obj)
    const sceneName = names.scene.get(txt(scene?.sceneId)) ?? ''
    const imgIds = seg.cuts.map(() => opts.newId('n'))
    seg.cuts.forEach((cut, ci) => {
      nodes.push({
        id: imgIds[ci]!, type: 'image-gen', position: { x: sx + PAD + ci * COL, y: top + HEAD + PAD },
        data: { label: `${seg.id} · 分镜图 ${ci + 1}`, text: mention(cut.frame || cut.shot || ''), params: { aspect_ratio: aspect, count: 1 } },
      })
    })
    cuts += seg.cuts.length
    const lines = seg.cuts.map((cut) => {
      if (!cut.beats || !flow.length) return []
      return flow.slice(cut.beats[0] - 1, cut.beats[1]).filter((b) => typeof b.line === 'string').map((b) => ({ speaker: txt(b.speaker), text: String(b.line) }))
    })
    const many = seg.cuts.length > 1
    const prompt = protocol === 'h3' && seg.h3Prompt ? seg.h3Prompt
      : seedanceSegmentPrompt(seg, many
        ? { refs: seg.cuts.map((_, ci) => `分镜图 #${ci + 1}`), frameRef: seg.cuts.map((_, ci) => ci + 1), lines }
        : { lines })
    const seconds = Math.min(60, Math.max(1, Math.ceil(seg.cuts.reduce((t, c) => t + (c.seconds ?? 0), 0))))
    const vid = opts.newId('n')
    videoIds.push(vid)
    nodes.push({
      id: vid, type: 'video-gen', position: { x: sx + PAD + seg.cuts.length * COL, y: top + HEAD + PAD },
      data: { label: seg.id, text: prompt, params: { aspect_ratio: aspect, duration: seconds, count: 1 } },
    })
    // several cuts: every keyframe is a reference picture, in order (@[图片k] / <Picture k>); one cut: the first frame
    imgIds.forEach((id) => edges.push({ id: opts.newId('e'), source: id, sourceHandle: 'out', target: vid, targetHandle: many ? 'ref' : 'first' }))
    nodes.push({
      id: opts.newId('g'), type: GROUP_TYPE, position: { x: sx, y: top },
      data: { label: [seg.id, sceneName].filter(Boolean).join(' · '), size: { w: PAD * 2 + (seg.cuts.length + 1) * COL - 40, h: ROW - 60 } },
    })
  })
  if (videoIds.length) {
    const exportId = opts.newId('n')
    const widest = Math.max(...used.map(({ seg }) => seg.cuts.length + 1))
    nodes.push({
      id: exportId, type: 'export', position: { x: sx + PAD * 2 + widest * COL + 120, y: y0 },
      data: { label: `${txt(sb.source) || '短剧'} · 成片`, params: { order: videoIds } },
    })
    videoIds.forEach((id) => edges.push({ id: opts.newId('e'), source: id, sourceHandle: 'out', target: exportId, targetHandle: 'video' }))
  }
  const groups = nodes.filter((n) => n.type === GROUP_TYPE).length
  // frames first, so they are drawn under the nodes
  nodes.sort((a, b) => Number(b.type === GROUP_TYPE) - Number(a.type === GROUP_TYPE))
  return { nodes, edges, counts: { subjects: nodes.filter((n) => n.type === 'subject').length, segments: used.length, cuts, groups, skippedSegments: skipped }, warnings }
}
