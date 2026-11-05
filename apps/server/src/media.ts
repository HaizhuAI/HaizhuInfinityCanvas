import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * FFmpeg integration. The app does not ship FFmpeg (GPL/LGPL redistribution is the user's/packager's
 * choice, see docs/00-research/02-license-audit.md): it uses `ffmpeg`/`ffprobe` from PATH, or the
 * paths in HZC_FFMPEG / HZC_FFPROBE. Every call passes an argument array — never a shell string.
 */

export class MediaError extends Error {}

export interface FfmpegInfo { ok: boolean; version?: string; ffmpeg: string; ffprobe: string; h264: boolean; aac: boolean; error?: string }

const bin = () => ({ ffmpeg: process.env.HZC_FFMPEG || 'ffmpeg', ffprobe: process.env.HZC_FFPROBE || 'ffprobe' })

export function run(cmd: string, args: string[], opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let child
    try { child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) } catch (e) { return reject(new MediaError(`无法启动 ${cmd}：${(e as Error).message}`)) }
    let stdout = '', stderr = ''
    child.stdout.on('data', (d) => { stdout += d; if (stdout.length > 8_000_000) stdout = stdout.slice(-4_000_000) })
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 8_000_000) stderr = stderr.slice(-4_000_000) })
    const kill = () => child.kill('SIGKILL')
    const timer = opts.timeoutMs ? setTimeout(kill, opts.timeoutMs) : undefined
    opts.signal?.addEventListener('abort', kill, { once: true })
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new MediaError(e.code === 'ENOENT' ? `未找到 ${cmd}` : `${cmd} 运行失败：${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', kill)
      if (opts.signal?.aborted) return reject(opts.signal.reason ?? new Error('aborted'))
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

let cached: FfmpegInfo | undefined
export async function ffmpegInfo(refresh = false): Promise<FfmpegInfo> {
  if (cached && !refresh) return cached
  const b = bin()
  try {
    const v = await run(b.ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 10_000 })
    await run(b.ffprobe, ['-hide_banner', '-version'], { timeoutMs: 10_000 })
    const enc = await run(b.ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs: 10_000 })
    cached = { ok: v.code === 0, version: /ffmpeg version (\S+)/.exec(v.stdout)?.[1], ...b, h264: /\blibx264\b/.test(enc.stdout), aac: /\baac\b/.test(enc.stdout) }
  } catch (e) {
    cached = { ok: false, ...b, h264: false, aac: false, error: (e as Error).message }
  }
  return cached
}

export async function requireFfmpeg() {
  const i = await ffmpegInfo()
  if (!i.ok) throw new MediaError('未找到 FFmpeg。请安装 FFmpeg 并加入 PATH（Windows：winget install ffmpeg；Ubuntu：sudo apt install ffmpeg），或设置环境变量 HZC_FFMPEG / HZC_FFPROBE 指向可执行文件，然后重启应用。')
  return i
}

export interface Probe { duration: number; width?: number; height?: number; hasAudio: boolean; fps?: number }

export async function probe(file: string, signal?: AbortSignal): Promise<Probe> {
  const { ffprobe } = await requireFfmpeg()
  const r = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file], { signal, timeoutMs: 60_000 })
  if (r.code !== 0) throw new MediaError(`无法读取媒体信息：${r.stderr.slice(-300)}`)
  const j = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[] }
  const v = j.streams?.find((s) => s.codec_type === 'video')
  const [num, den] = (v?.r_frame_rate ?? '').split('/').map(Number)
  return {
    duration: Number(j.format?.duration ?? 0),
    width: v?.width, height: v?.height,
    hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio'),
    fps: num && den ? num / den : undefined,
  }
}

/** Timestamps (s) where the picture changes by more than `threshold` (0–1), via the scene filter. */
export async function detectScenes(file: string, threshold: number, signal?: AbortSignal): Promise<number[]> {
  const { ffmpeg } = await requireFfmpeg()
  const r = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-an', '-filter:v', `select='gt(scene,${threshold.toFixed(3)})',showinfo`, '-f', 'null', '-'], { signal, timeoutMs: 15 * 60_000 })
  if (r.code !== 0) throw new MediaError(`镜头检测失败：${r.stderr.slice(-300)}`)
  return [...r.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).filter((t) => Number.isFinite(t))
}

/** One JPEG frame at `t` seconds, scaled to at most `maxW` wide. */
export async function extractFrame(file: string, t: number, out: string, maxW = 768, signal?: AbortSignal) {
  const { ffmpeg } = await requireFfmpeg()
  const r = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale='min(${maxW},iw)':-2`, '-q:v', '3', out], { signal, timeoutMs: 60_000 })
  if (r.code !== 0) throw new MediaError(`提取关键帧失败：${r.stderr.slice(-300)}`)
}

/**
 * Turn scene cuts into shot segments: drop slivers shorter than `minLen`, then merge the shortest
 * neighbours until at most `maxShots` remain. With no cuts in a long clip, split it evenly.
 */
export function segmentsFromCuts(cuts: number[], duration: number, maxShots: number, minLen = 0.4): { start: number; end: number }[] {
  const pts = [0, ...cuts.filter((c) => c > 0 && c < duration).sort((a, b) => a - b), duration]
  let segs: { start: number; end: number }[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const s = { start: pts[i]!, end: pts[i + 1]! }
    if (segs.length && s.end - s.start < minLen) segs[segs.length - 1]!.end = s.end
    else segs.push(s)
  }
  if (segs.length > 1 && segs[0]!.end - segs[0]!.start < minLen) { segs[1]!.start = 0; segs.shift() }
  if (segs.length === 1 && duration > 10) {
    const n = Math.min(maxShots, Math.ceil(duration / 5))
    segs = Array.from({ length: n }, (_, i) => ({ start: (duration * i) / n, end: (duration * (i + 1)) / n }))
  }
  while (segs.length > maxShots) {
    let k = 0, best = Infinity
    for (let i = 0; i < segs.length - 1; i++) { const len = segs[i + 1]!.end - segs[i]!.start; if (len < best) { best = len; k = i } }
    segs.splice(k, 2, { start: segs[k]!.start, end: segs[k + 1]!.end })
  }
  return segs
}

/** A scratch folder under the data dir, removed when `fn` settles. */
export async function withTemp<T>(dataDir: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = join(dataDir, 'tmp', randomUUID())
  mkdirSync(dir, { recursive: true })
  try { return await fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
