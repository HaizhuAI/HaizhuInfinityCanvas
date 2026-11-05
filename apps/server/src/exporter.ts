import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MediaError, probe, requireFfmpeg, run, withTemp, type Probe } from './media'

export interface ExportClip { file: string }
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
export async function exportFilm(o: ExportOptions): Promise<{ bytes: Buffer; srt: string; duration: number; size: string }> {
  if (!o.clips.length) throw new MediaError('至少连接一个视频片段')
  const ff = await requireFfmpeg()
  const infos: Probe[] = []
  for (const c of o.clips) infos.push(await probe(c.file, o.signal))
  const voiceInfos: Probe[] = []
  for (const v of o.voices) voiceInfos.push(await probe(v, o.signal))

  const [W, H] = o.size && /^\d+x\d+$/.test(o.size) ? o.size.split('x').map((n) => even(Number(n))) : [even(infos[0]!.width ?? 1280), even(infos[0]!.height ?? 720)]
  const fps = o.fps && o.fps > 0 && o.fps <= 120 ? o.fps : 30
  const durs = infos.map((i) => Math.max(0.1, i.duration))
  const total = durs.reduce((a, b) => a + b, 0)
  const starts = durs.map((_, i) => durs.slice(0, i).reduce((a, b) => a + b, 0))

  return withTemp(o.dataDir, async (dir) => {
    // every -i must come before the output options (-map, codecs, …)
    const srt = o.subtitles.some((s) => s.trim()) ? buildSrt(o.subtitles, durs) : ''
    const args: string[] = ['-hide_banner', '-nostats', '-y']
    for (const c of o.clips) args.push('-i', c.file)
    for (const v of o.voices) args.push('-i', v)
    if (srt) { const srtFile = join(dir, 'subs.srt'); writeFileSync(srtFile, srt); args.push('-i', srtFile) }
    const f: string[] = []
    o.clips.forEach((_, i) => {
      f.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,trim=duration=${durs[i]!.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`)
      if (o.keepAudio !== 'drop' && infos[i]!.hasAudio) f.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${durs[i]!.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`)
      else f.push(`aevalsrc=0:c=stereo:s=48000:d=${durs[i]!.toFixed(3)}[a${i}]`)
    })
    f.push(`${o.clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${o.clips.length}:v=1:a=1[vout][abase]`)
    let aout = '[abase]'
    if (o.voices.length) {
      const aligned = o.voices.length === o.clips.length
      let cursor = 0
      o.voices.forEach((_, j) => {
        const ci = o.voiceClip?.[j]
        const at = o.voiceStarts?.[j] ?? (ci !== undefined && ci >= 0 ? starts[ci]! : aligned ? starts[j]! : cursor)
        cursor += voiceInfos[j]!.duration
        const ms = Math.round(at * 1000)
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
    return { bytes: readFileSync(out), srt, duration: total, size: `${W}x${H}` }
  })
}
