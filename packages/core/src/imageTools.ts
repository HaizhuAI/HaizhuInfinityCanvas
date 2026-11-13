/**
 * Image tools (rc.20): new pictures made from one on the canvas by an image model that takes a
 * reference picture — 换角度 (the same scene from another camera position) and 重新打光 (the same
 * picture under other light). Each makes an image-generation node wired to the picture, with the
 * prompt written here; it runs like any other node (estimate, cache, versions).
 *
 * The prompt builders are adapted from Toonflow (MIT, Copyright (c) 2026 HBAI-Ltd),
 * packages/nodes/imageNode/src/imageMultiAngle.ts and imageLighting.ts: the coordinate system,
 * presets and wording are theirs; `{{ref 1}}` became "the reference image" because the canvas sends
 * the wired picture as the model's only reference. See THIRD_PARTY_NOTICES.md.
 */

export interface AngleSettings {
  /** degrees around the subject: 0 = the reference camera, ±90 = its sides, ±180 = behind */
  azimuth: number
  /** degrees above (+) or below (−) the reference viewing plane */
  elevation: number
  /** camera distance, 2–10; the reference camera is at 4.8 */
  distance: number
  lens: 'standard' | 'wide'
}

export const ANGLE_PRESETS: { id: string; label: string; azimuth: number; elevation: number }[] = [
  { id: 'front', label: '正面', azimuth: 0, elevation: 0 },
  { id: 'back', label: '背面', azimuth: -180, elevation: 0 },
  { id: 'leftFront', label: '左前', azimuth: -45, elevation: 0 },
  { id: 'rightFront', label: '右前', azimuth: 45, elevation: 0 },
  { id: 'left', label: '左侧', azimuth: -90, elevation: 0 },
  { id: 'right', label: '右侧', azimuth: 90, elevation: 0 },
  { id: 'leftBack', label: '左后', azimuth: -135, elevation: 0 },
  { id: 'rightBack', label: '右后', azimuth: 135, elevation: 0 },
  { id: 'high', label: '俯拍', azimuth: 0, elevation: 60 },
  { id: 'low', label: '仰拍', azimuth: 0, elevation: -60 },
]

export const ANGLE_DISTANCES: { id: string; label: string; distance: number }[] = [
  { id: 'close', label: '近景', distance: 3 },
  { id: 'medium', label: '中景', distance: 4.8 },
  { id: 'wide', label: '远景', distance: 7.5 },
]

const wrapDeg = (v: number) => ((((Number(v) || 0) + 180) % 360) + 360) % 360 - 180
const clampN = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d)
const r3 = (n: number) => Number(n.toFixed(3))

export function readAngle(v: Partial<AngleSettings> | undefined): AngleSettings {
  return {
    azimuth: wrapDeg(v?.azimuth ?? 0),
    elevation: clampN(v?.elevation ?? 0, -80, 80, 0),
    distance: clampN(v?.distance ?? 4.8, 2, 10, 4.8),
    lens: v?.lens === 'wide' ? 'wide' : 'standard',
  }
}

/** a short Chinese name for the result node, e.g. 「左前 · 中景」 */
export function angleLabel(v: Partial<AngleSettings>): string {
  const s = readAngle(v)
  const preset = ANGLE_PRESETS.find((p) => p.azimuth === s.azimuth && p.elevation === s.elevation)
  const shot = s.distance <= 3.5 ? '近景' : s.distance >= 7 ? '远景' : '中景'
  return `${preset?.label ?? `${s.azimuth}° / ${s.elevation}°`} · ${shot}`
}

export function buildAnglePrompt(v: Partial<AngleSettings>): string {
  const s = readAngle(v)
  const az = (s.azimuth * Math.PI) / 180, el = (s.elevation * Math.PI) / 180
  const pos = { x: s.distance * Math.cos(el) * Math.sin(az), y: s.distance * Math.sin(el), z: s.distance * Math.cos(el) * Math.cos(az) }
  const cameraSide = s.azimuth < 0 ? 'LEFT' : 'RIGHT', aimSide = s.azimuth < 0 ? 'RIGHT' : 'LEFT'
  const rear = Math.abs(s.azimuth) > 90
  const horizontal = s.azimuth === 0
    ? 'Keep the camera on the original horizontal viewing axis.'
    : s.azimuth === -180
      ? 'REVERSE VIEW: move the camera 180 degrees around the subject to the exact opposite side of the original camera. Show the surfaces facing away from the reference camera.'
      : rear
        ? `REAR VIEW relative to the reference camera: orbit ${Math.abs(s.azimuth)} degrees toward reference-image ${cameraSide}, continuing PAST the side view into the rear hemisphere. The camera is ${180 - Math.abs(s.azimuth)} degrees short of the exact opposite viewpoint, on its ${cameraSide} side, looking back toward the subject center. Reveal the surfaces hidden from the reference camera instead of repeating its front or side view.`
        : `Move the CAMERA ${Math.abs(s.azimuth)} degrees around the subject toward the ${cameraSide} edge of the reference image. The camera is physically on the reference-image ${cameraSide} side, with its lens aimed ${aimSide} toward the subject center. These are camera positions, not instructions to turn the subject or move it within the frame.`
  const vertical = s.elevation === 0
    ? 'Keep the original vertical camera angle.'
    : `Place the camera ${Math.abs(s.elevation)} degrees ${s.elevation > 0 ? 'above the original viewing plane, with the lens aimed DOWN' : 'below the original viewing plane, with the lens aimed UP'} toward the subject center.`
  const lens = s.lens === 'wide' ? 'wide-angle lens without fisheye distortion' : 'standard lens'
  const visibility = rear
    ? "Reconstruct the previously unseen surfaces consistently with the reference. Identity consistency does not require the original face to remain visible: allow the head, body and objects to occlude features naturally. When the reference shows a person from the front, a near-180-degree view shows the back of the head, hair, shoulders and clothing; do not turn the head toward the new camera or copy facial features and front clothing details onto the back. If the reference already shows the person's back, the reverse view may reveal their front."
    : 'Render the requested viewpoint with corresponding changes to visible surfaces, occlusion and background perspective.'
  return [
    `Photograph the scene in the reference image from a NEW CAMERA POSITION. ${horizontal} ${vertical} Move only the camera; keep the subject and scene in their original world orientation.`,
    `Use the reference image as the coordinate basis: +X points to its right edge, +Y points up, +Z points toward the original camera. The subject center is (0, 0, 0), the original camera is (0, 0, 4.8), and the new camera is (${r3(pos.x)}, ${r3(pos.y)}, ${r3(pos.z)}), looking at (0, 0, 0).`,
    `Camera distance: ${s.distance.toFixed(1)} normalized units, where the reference distance is 4.8; use ${(s.distance / 4.8).toFixed(2)} times the reference camera-to-subject distance. Use a ${s.lens === 'wide' ? 24 : 50}mm equivalent ${lens}.`,
    `Preserve the same subjects, identities, number, clothing, hairstyles, colors, materials and visual style. ${visibility} Update the background perspective for the new camera position. Do not mirror the image, swap anatomical left and right, or use a flat perspective warp instead of a new viewpoint. Output one finished image without added cameras, guides or text labels.`,
  ].join('\n')
}

export interface RelightSettings {
  /** a look from RELIGHT_PRESETS (its words and its light positions), or '' */
  preset: string
  /** key light: degrees around the subject (0 = from the camera side) and above the horizon */
  azimuth: number
  elevation: number
  /** 0–100 */
  brightness: number
  /** #rrggbb tint of the key light */
  color: string
  rim: boolean
  rimAzimuth: number
  rimElevation: number
  rimBrightness: number
  rimColor: string
  /** the person's own words about the light, added as they are */
  note?: string
}

export const RELIGHT_PRESETS: { id: string; label: string; prompt: string; settings: Partial<RelightSettings> }[] = [
  { id: 'film', label: '柔曝胶片', prompt: 'airy high-key exposure with gently faded highlights, broad soft illumination and a subtle analogue-film finish', settings: { azimuth: 0, elevation: 25, brightness: 85, color: '#fff3dd', rim: false } },
  { id: 'blue', label: '冰蓝背光', prompt: 'a cool blue backlight separating the silhouette from the scene, restrained frontal fill and a luminous atmospheric edge', settings: { azimuth: 0, elevation: 20, brightness: 25, color: '#ffffff', rim: true, rimAzimuth: -180, rimElevation: 20, rimBrightness: 70, rimColor: '#72a7ff' } },
  { id: 'portrait', label: '经典肖像', prompt: 'a sculpted portrait key light from the upper side, a small triangular highlight on the shadowed cheek and rich painterly tonal depth', settings: { azimuth: -45, elevation: 35, brightness: 50, color: '#ffffff', rim: false } },
  { id: 'neon', label: '霓虹夜色', prompt: 'contrasting cyan and pink light spilling across existing surfaces, vivid nocturnal color separation and a futuristic urban mood', settings: { azimuth: 90, elevation: 10, brightness: 55, color: '#52e5ec', rim: true, rimAzimuth: -135, rimElevation: 15, rimBrightness: 65, rimColor: '#ff67ca' } },
  { id: 'sunset', label: '暮色暖调', prompt: 'low amber sunset illumination, elongated soft shadows and warm nostalgic color with a dreamy dusk atmosphere', settings: { azimuth: -120, elevation: 10, brightness: 65, color: '#ffad69', rim: true, rimAzimuth: 150, rimElevation: 10, rimBrightness: 50, rimColor: '#ffc078' } },
  { id: 'noir', label: '暗影悬疑', prompt: 'restrained low-key illumination, dense shadow areas and selective highlights for a tense monochromatic cinematic mood', settings: { azimuth: -90, elevation: 30, brightness: 15, color: '#ffffff', rim: false } },
  { id: 'golden', label: '金色柔光', prompt: 'gentle late-afternoon golden light, smooth luminous skin highlights and delicate warm reflections with natural shadow detail', settings: { azimuth: -45, elevation: 15, brightness: 65, color: '#ffd28a', rim: false } },
  { id: 'steel', label: '冷灰银幕', prompt: 'muted steel-blue and slate-grey cinematic lighting, controlled saturation, crisp tonal separation and subtle cool shadows', settings: { azimuth: 45, elevation: 25, brightness: 40, color: '#b7c9db', rim: false } },
]

/** where the key light comes from, in words for the menu */
export const LIGHT_DIRECTIONS: { id: string; label: string; azimuth: number; elevation: number }[] = [
  { id: 'front', label: '前光', azimuth: 0, elevation: 25 },
  { id: 'left', label: '左光', azimuth: -90, elevation: 25 },
  { id: 'right', label: '右光', azimuth: 90, elevation: 25 },
  { id: 'back', label: '背光', azimuth: -180, elevation: 20 },
  { id: 'top', label: '顶光', azimuth: 0, elevation: 85 },
  { id: 'bottom', label: '底光', azimuth: 0, elevation: -60 },
]

const HEX = /^#[\da-f]{6}$/i

export function readRelight(v: Partial<RelightSettings> | undefined): RelightSettings {
  const preset = RELIGHT_PRESETS.find((p) => p.id === v?.preset)
  const m = { ...(preset?.settings ?? {}), ...Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x !== undefined)) } as Partial<RelightSettings>
  return {
    preset: preset?.id ?? '',
    azimuth: wrapDeg(m.azimuth ?? 0),
    elevation: clampN(m.elevation ?? 25, -90, 90, 25),
    brightness: clampN(m.brightness ?? 50, 0, 100, 50),
    color: HEX.test(m.color ?? '') ? m.color! : '#ffffff',
    rim: m.rim === true,
    rimAzimuth: wrapDeg(m.rimAzimuth ?? -180),
    rimElevation: clampN(m.rimElevation ?? 20, -90, 90, 20),
    rimBrightness: clampN(m.rimBrightness ?? 50, 0, 100, 50),
    rimColor: HEX.test(m.rimColor ?? '') ? m.rimColor! : '#ffffff',
    note: (m.note ?? '').trim().slice(0, 400) || undefined,
  }
}

function lightDirection(azimuth: number, elevation: number, source: 'key' | 'rim'): string {
  const a = wrapDeg(azimuth), e = clampN(elevation, -90, 90, 0)
  const h = (a * Math.PI) / 180, v = (e * Math.PI) / 180
  const pos = { x: Math.cos(v) * Math.sin(h), y: Math.sin(v), z: Math.cos(v) * Math.cos(h) }
  const side = a < 0 ? 'LEFT' : 'RIGHT'
  const rear = Math.abs(a) > 90
  const horizontal = a === 0 ? 'on the reference-camera side of the subject'
    : a === -180 ? 'behind the subject, opposite the reference camera'
      : Math.abs(a) === 90 ? `directly to reference-image ${side} of the subject`
        : `${rear ? 'behind the subject' : 'on the reference-camera side'}, toward reference-image ${side}`
  const vertical = e === 0 ? 'at subject-center height' : `${Math.abs(e)} degrees ${e > 0 ? 'above' : 'below'} the horizontal plane through the subject center`
  const placement = Math.abs(e) === 90 ? `directly ${e > 0 ? 'above' : 'below'} the subject center` : `${horizontal}, ${vertical}`
  const effect = rear && Math.abs(e) < 90
    ? 'This is backlighting: illuminate surfaces facing this rear source and visible silhouette edges, not frontal fill from the camera side.'
    : 'Illuminate surfaces facing this source; shadows fall away from the source according to the scene geometry.'
  return `Place the unseen ${source} light source ${placement}, at azimuth ${a} degrees and elevation ${e} degrees. Its normalized source position is (${r3(pos.x)}, ${r3(pos.y)}, ${r3(pos.z)}), where +X is reference-image RIGHT, +Y is UP and +Z points toward the original camera. Light travels FROM this position TOWARD the subject center, not in the named source-side direction. ${effect}`
}

export function relightLabel(v: Partial<RelightSettings>): string {
  const s = readRelight(v)
  const preset = RELIGHT_PRESETS.find((p) => p.id === s.preset)
  const dir = LIGHT_DIRECTIONS.find((d) => d.azimuth === s.azimuth && d.elevation === s.elevation)
  return preset?.label ?? dir?.label ?? `${s.azimuth}° / ${s.elevation}°`
}

export function buildRelightPrompt(v: Partial<RelightSettings>): string {
  const s = readRelight(v)
  const consistency = [
    'Relight the reference image while keeping its original scene, composition, viewpoint and background geometry intact',
    "Retain every person's identity, facial features, hairstyle, clothing, pose and ongoing action",
    'Keep the original subject count, placement and relationships; do not introduce or remove people or objects',
    'Treat all lighting descriptions as illumination effects only; never depict lamps, spotlights, softboxes, reflectors, candles, torches or any lighting equipment',
    'Limit edits to illumination direction, intensity, color, shadow, contrast and atmosphere',
  ].join('. ')
  const brightness = [
    'very subdued exposure with deep shadows and only faint highlights',
    'restrained brightness with soft highlights and readable dark tones',
    'balanced exposure with natural midtones and preserved highlight detail',
    'bright illumination with open shadows and luminous midtones',
    'intense high-key exposure with radiant highlights and a light overall tone',
  ][Math.min(4, Math.floor(s.brightness / 20))]
  const rim = s.rim
    ? `use an independent source for rim and edge highlights where its specified position permits; do not move this source to the opposite side to create a rim; ${lightDirection(s.rimAzimuth, s.rimElevation, 'rim')}; rim intensity ${Math.round(s.rimBrightness)}%, tinted toward ${s.rimColor}`
    : ''
  return [
    consistency,
    RELIGHT_PRESETS.find((p) => p.id === s.preset)?.prompt ?? '',
    s.note ?? '',
    lightDirection(s.azimuth, s.elevation, 'key'),
    brightness,
    rim,
    `tint the key illumination toward ${s.color}, keeping the subject's original surface colors recognizable`,
  ].filter(Boolean).join(', ')
}

/** 宫格切分: the cells of a rows × cols contact sheet, as fractions of the picture (left, top, width, height) */
export function gridCells(rows: number, cols: number): { row: number; col: number; x: number; y: number; w: number; h: number }[] {
  const r = Math.min(8, Math.max(1, Math.round(rows))), c = Math.min(8, Math.max(1, Math.round(cols)))
  return Array.from({ length: r * c }, (_, i) => ({ row: Math.floor(i / c), col: i % c, x: (i % c) / c, y: Math.floor(i / c) / r, w: 1 / c, h: 1 / r }))
}
