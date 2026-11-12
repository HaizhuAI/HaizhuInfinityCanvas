import { readFileSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { MediaError, probe, requireFfmpeg, run, withTemp, type Probe } from './media'
import { zipBuffer, type ZipInput } from './zip'
import { trimmedSpan } from '@hzc/core'

/** `in` / `out`: the part of the clip used, in seconds (the timeline's trim); default the whole clip */
export interface ExportClip { file: string; in?: number; out?: number }
export interface ExportOptions {
  clips: ExportClip[]
  voices: string[]
  /** explicit start (s) per voice; when absent, one-voice-per-clip aligns to clip starts, else back-to-back */
  voiceStarts?: number[]
  /** for each voice, the index of the clip it belongs to (same canvas row) */
  voiceClip?: number[]
  /** subtitle lines (one per clip when counts match, otherwise spread over the whole film) */
  subtitles: string[]
  size?: string // "1920x1080"; empty = first clip
  fps?: number
  keepAudio?: 'mix' | 'drop'
  dataDir: string
  signal: AbortSignal
  onProgress?: (pct: number) => void
}

/** The cut as laid out by exportFilm, reused to write an editor project with the same timing. */
export interface Timeline {
  width: number
  height: number
  fps: number
  total: number
  keepAudio: 'mix' | 'drop'
  /** `in`: where in the source file the used part starts (s) */
  clips: { file: string; start: number; duration: number; in?: number }[]
  voices: { file: string; start: number; duration: number }[]
  srt: string
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

function srtTime(t: number) {
  const ms = Math.round(t * 1000)
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`
}

/** SRT cues: line i covers clip i when the counts match; otherwise lines share the timeline evenly. */
export function buildSrt(lines: string[], clipDurations: number[]): string {
  const total = clipDurations.reduce((a, b) => a + b, 0)
  const cues: { a: number; b: number; t: string }[] = []
  if (lines.length === clipDurations.length) {
    let at = 0
    lines.forEach((t, i) => { const d = clipDurations[i]!; if (t.trim()) cues.push({ a: at, b: at + d, t: t.trim() }); at += d })
  } else {
    const step = total / Math.max(1, lines.length)
    lines.forEach((t, i) => { if (t.trim()) cues.push({ a: i * step, b: (i + 1) * step, t: t.trim() }) })
  }
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.a)} --> ${srtTime(Math.max(c.a + 0.5, c.b - 0.05))}\n${c.t}\n`).join('\n')
}

/**
 * Normalise every clip to one size / fps / sample rate, concatenate, lay voice clips over the
 * picture (aligned to clip starts when there is one voice per clip), and mux soft subtitles.
 * Returns the MP4 bytes and the SRT text (empty when there are no subtitles).
 */
export async function exportFilm(o: ExportOptions): Promise<{ bytes: Buffer; srt: string; duration: number; size: string; timeline: Timeline }> {
  if (!o.clips.length) throw new MediaError('至少连接一个视频片段')
  const ff = await requireFfmpeg()
  const infos: Probe[] = []
  for (const c of o.clips) infos.push(await probe(c.file, o.signal))
  const voiceInfos: Probe[] = []
  for (const v of o.voices) voiceInfos.push(await probe(v, o.signal))

  const [W, H] = o.size && /^\d+x\d+$/.test(o.size) ? o.size.split('x').map((n) => even(Number(n))) : [even(infos[0]!.width ?? 1280), even(infos[0]!.height ?? 720)]
  const fps = o.fps && o.fps > 0 && o.fps <= 120 ? o.fps : 30
  // each clip's used part: the timeline's trim, kept inside the file
  const spans = o.clips.map((c, i) => trimmedSpan({ in: c.in, out: c.out }, Math.max(0.1, infos[i]!.duration)))
  const durs = spans.map((sp) => sp.length)
  const total = durs.reduce((a, b) => a + b, 0)
  const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0))
  // where each voice starts: explicit, else its clip's row, else one-per-clip, else back to back
  const aligned = o.voices.length === o.clips.length
  let cursor = 0
  const voiceAt = o.voices.map((_, j) => {
    const ci = o.voiceClip?.[j]
    const at = o.voiceStarts?.[j] ?? (ci !== undefined && ci >= 0 ? starts[ci]! : aligned ? starts[j]! : cursor)
    cursor += voiceInfos[j]!.duration
    return at
  })

  return withTemp(o.dataDir, async (dir) => {
    // every -i must come before the output options (-map, codecs, …)
    const srt = o.subtitles.some((s) => s.trim()) ? buildSrt(o.subtitles, durs) : ''
    const args: string[] = ['-hide_banner', '-nostats', '-y']
    for (const c of o.clips) args.push('-i', c.file)
    for (const v of o.voices) args.push('-i', v)
    if (srt) { const srtFile = join(dir, 'subs.srt'); writeFileSync(srtFile, srt); args.push('-i', srtFile) }
    const f: string[] = []
    o.clips.forEach((_, i) => {
      const cut = spans[i]!.start > 0 ? `trim=start=${spans[i]!.start.toFixed(3)},setpts=PTS-STARTPTS,` : ''
      const acut = spans[i]!.start > 0 ? `atrim=start=${spans[i]!.start.toFixed(3)},asetpts=PTS-STARTPTS,` : ''
      f.push(`[${i}:v]${cut}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,trim=duration=${durs[i]!.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`)
      if (o.keepAudio !== 'drop' && infos[i]!.hasAudio) f.push(`[${i}:a]${acut}aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${durs[i]!.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`)
      else f.push(`aevalsrc=0:c=stereo:s=48000:d=${durs[i]!.toFixed(3)}[a${i}]`)
    })
    f.push(`${o.clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${o.clips.length}:v=1:a=1[vout][abase]`)
    let aout = '[abase]'
    if (o.voices.length) {
      o.voices.forEach((_, j) => {
        const ms = Math.round(voiceAt[j]! * 1000)
        f.push(`[${o.clips.length + j}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[vo${j}]`)
      })
      f.push(`[abase]${o.voices.map((_, j) => `[vo${j}]`).join('')}amix=inputs=${o.voices.length + 1}:normalize=0:duration=first:dropout_transition=0[amix]`)
      aout = '[amix]'
    }
    args.push('-filter_complex', f.join(';'), '-map', '[vout]', '-map', aout)

    if (srt) args.push('-map', `${o.clips.length + o.voices.length}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=chi')
    if (ff.h264) args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20')
    else args.push('-c:v', 'mpeg4', '-q:v', '3')
    args.push('-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', total.toFixed(3), '-progress', 'pipe:1')
    const out = join(dir, 'film.mp4')
    args.push(out)

    const r = await run(ff.ffmpeg, args, {
      signal: o.signal, timeoutMs: 60 * 60_000,
      onStdout: (chunk) => {
        const m = /out_time_us=(\d+)/.exec(chunk.split('\n').reverse().find((l) => l.startsWith('out_time_us=')) ?? '')
        if (m && o.onProgress) o.onProgress(Math.min(99, Math.round((Number(m[1]) / 1e6 / total) * 100)))
      },
    })
    if (r.code !== 0) throw new MediaError(`合成失败：${r.stderr.split('\n').filter(Boolean).slice(-4).join(' / ').slice(0, 500)}`)
    const timeline: Timeline = {
      width: W!, height: H!, fps, total, keepAudio: o.keepAudio === 'drop' ? 'drop' : 'mix', srt,
      clips: o.clips.map((c, i) => ({ file: c.file, start: starts[i]!, duration: durs[i]!, in: spans[i]!.start })),
      voices: o.voices.map((file, j) => ({ file, start: voiceAt[j]!, duration: Math.max(0.05, voiceInfos[j]!.duration) })),
    }
    return { bytes: readFileSync(out), srt, duration: total, size: `${W}x${H}`, timeline }
  })
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/**
 * MLT XML project (the format Shotcut opens, and `melt` renders) with the same cut as the film:
 * V1 holds the clips back to back, A1…An the voice-overs at their start times (overlapping voices
 * go to the next free track), every track mixed into the output. Paths are relative to the file.
 */
export function buildMlt(t: Timeline, files: { clips: string[]; voices: string[] }, title: string): string {
  const fpsNum = Number.isInteger(t.fps) ? t.fps : Math.round(t.fps * 1000)
  const fpsDen = Number.isInteger(t.fps) ? 1 : 1000
  const frames = (sec: number) => Math.max(1, Math.round(sec * t.fps))
  const g = gcd(t.width, t.height)
  // frame positions are cumulative so rounding never drifts across many clips
  const clipIn = t.clips.map((c) => Math.round(c.start * t.fps))
  const clipLen = t.clips.map((c, i) => Math.max(1, Math.round((c.start + c.duration) * t.fps) - clipIn[i]!))
  // a trimmed clip starts this many frames into its file
  const srcIn = t.clips.map((c) => Math.max(0, Math.round((c.in ?? 0) * t.fps)))
  const totalFrames = Math.max(1, clipIn.length ? clipIn[clipIn.length - 1]! + clipLen[clipLen.length - 1]! : frames(t.total))

  // greedy track assignment for voices, in start order, clipped to the end of the film
  const tracks: { at: number; len: number; j: number }[][] = []
  t.voices.map((v, j) => ({ at: Math.round(v.start * t.fps), len: frames(v.duration), j }))
    .filter((v) => v.at < totalFrames)
    .map((v) => ({ ...v, len: Math.min(v.len, totalFrames - v.at) }))
    .sort((a, b) => a.at - b.at || a.j - b.j)
    .forEach((v) => {
      const free = tracks.find((tr) => { const last = tr[tr.length - 1]!; return last.at + last.len <= v.at })
      if (free) free.push(v); else tracks.push([v])
    })

  const L: string[] = []
  L.push('<?xml version="1.0" encoding="utf-8"?>')
  L.push(`<mlt LC_NUMERIC="C" version="7.0.0" title="${xml(title)}">`)
  L.push(`  <profile description="${t.width}x${t.height} ${t.fps} fps" width="${t.width}" height="${t.height}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${t.width / g}" display_aspect_den="${t.height / g}" frame_rate_num="${fpsNum}" frame_rate_den="${fpsDen}" colorspace="709"/>`)
  L.push(`  <producer id="black" in="0" out="${totalFrames - 1}">`)
  for (const [k, v] of [['length', totalFrames], ['eof', 'pause'], ['resource', '0'], ['aspect_ratio', 1], ['mlt_service', 'color'], ['mlt_image_format', 'rgba'], ['set.test_audio', 0]] as const) L.push(`    <property name="${k}">${v}</property>`)
  L.push('  </producer>')
  L.push(`  <playlist id="background">\n    <entry producer="black" in="0" out="${totalFrames - 1}"/>\n  </playlist>`)
  // explicit length/in/out: MLT (and Shotcut) clamp playlist entries to the producer's length
  const producer = (id: string, resource: string, caption: string, len: number) => [
    `  <producer id="${id}" in="0" out="${len - 1}">`,
    `    <property name="length">${len}</property>`,
    '    <property name="eof">pause</property>',
    `    <property name="resource">${xml(resource)}</property>`,
    '    <property name="mlt_service">avformat</property>',
    `    <property name="shotcut:caption">${xml(caption)}</property>`,
    '  </producer>',
  ].join('\n')
  t.clips.forEach((_, i) => L.push(producer(`clip${i}`, files.clips[i]!, `镜头 ${i + 1}`, srcIn[i]! + clipLen[i]!)))
  t.voices.forEach((v, j) => L.push(producer(`voice${j}`, files.voices[j]!, `配音 ${j + 1}`, frames(v.duration))))

  L.push('  <playlist id="video1">')
  L.push('    <property name="shotcut:video">1</property>')
  L.push('    <property name="shotcut:name">V1</property>')
  t.clips.forEach((_, i) => L.push(`    <entry producer="clip${i}" in="${srcIn[i]}" out="${srcIn[i]! + clipLen[i]! - 1}"/>`))
  L.push('  </playlist>')
  tracks.forEach((tr, k) => {
    L.push(`  <playlist id="audio${k + 1}">`)
    L.push('    <property name="shotcut:audio">1</property>')
    L.push(`    <property name="shotcut:name">A${k + 1}</property>`)
    let pos = 0
    for (const v of tr) {
      if (v.at > pos) L.push(`    <blank length="${v.at - pos}"/>`)
      L.push(`    <entry producer="voice${v.j}" in="0" out="${v.len - 1}"/>`)
      pos = v.at + v.len
    }
    L.push('  </playlist>')
  })

  L.push(`  <tractor id="tractor0" title="${xml(title)}" in="0" out="${totalFrames - 1}">`)
  L.push('    <property name="shotcut">1</property>')
  L.push('    <property name="shotcut:projectAudioChannels">2</property>')
  L.push('    <track producer="background"/>')
  L.push(`    <track producer="video1"${t.keepAudio === 'drop' ? ' hide="audio"' : ''}/>`)
  tracks.forEach((_, k) => L.push(`    <track producer="audio${k + 1}" hide="video"/>`))
  for (let b = 1; b <= tracks.length + 1; b++) {
    L.push(`    <transition id="mix${b}">`)
    for (const [k, v] of [['a_track', 0], ['b_track', b], ['mlt_service', 'mix'], ['always_active', 1], ['sum', 1]] as const) L.push(`      <property name="${k}">${v}</property>`)
    L.push('    </transition>')
  }
  L.push('  </tractor>')
  L.push('</mlt>')
  return L.join('\n') + '\n'
}

const README = (title: string) => `\ufeff${title} — 剪辑工程（由 Haizhu Infinity Canvas 导出）

打开方式
  · Shotcut（免费开源，Windows / Linux / macOS，https://shotcut.org）：文件 → 打开文件 → 选择 project.mlt。
    时间线：V1 为全部镜头（按画布顺序），A1… 为配音（与成片中的位置相同）。
  · 字幕：在 Shotcut 的「字幕」面板中导入 subtitles.srt（Shotcut 24.02 及以上）。
  · 也可以用 MLT 命令行直接预览：melt project.mlt

请保持本文件夹的结构不变：project.mlt 使用相对路径引用 clips/ 与 voice/ 里的文件。
`

/** A zip that unpacks to one folder: project.mlt, clips/, voice/, subtitles.srt, README.txt. */
export function editorPackage(t: Timeline, title: string): Buffer {
  const pad = (i: number) => String(i + 1).padStart(2, '0')
  const ext = (f: string) => extname(f).toLowerCase() || '.bin'
  const clips = t.clips.map((c, i) => `clips/shot-${pad(i)}${ext(c.file)}`)
  const voices = t.voices.map((v, j) => `voice/voice-${pad(j)}${ext(v.file)}`)
  const root = 'haizhu-edit/'
  const entries: ZipInput[] = [
    { name: `${root}project.mlt`, data: Buffer.from(buildMlt(t, { clips, voices }, title)) },
    { name: `${root}README.txt`, data: Buffer.from(README(title)) },
    ...(t.srt ? [{ name: `${root}subtitles.srt`, data: Buffer.from(t.srt) }] : []),
    ...t.clips.map((c, i) => ({ name: root + clips[i]!, data: () => readFileSync(c.file) })),
    ...t.voices.map((v, j) => ({ name: root + voices[j]!, data: () => readFileSync(v.file) })),
  ]
  return zipBuffer(entries)
}
