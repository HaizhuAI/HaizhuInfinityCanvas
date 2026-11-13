import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GROUP_TYPE, findFreeSpot, isGroup, type GraphNode, type ProjectGraph } from '@hzc/core'
import type { AssetStore } from './assets'
import { CanvasEditError, MAX_NODES } from './agent'
import { detectScenes, extractFrame, ffmpegInfo, MediaError, probe, requireFfmpeg, run, segmentsFromCuts, withTemp } from './media'

/**
 * 拆镜头 (rc.20, after Toonflow's 逐帧拉片): a video's shots become materials on the canvas — a keyframe
 * picture per shot, the shot itself as a clip, and the original soundtrack — each kind in its own group
 * beside the video. Done locally with FFmpeg; no model is called and nothing is paid for. The
 * keyframes and clips then work as references, first frames or timeline material like any upload.
 */
export interface SplitOptions { threshold?: number; maxShots?: number; clips?: boolean; audio?: boolean }
interface Ref { assetId: string; mime: string }
export interface ShotSplit {
  duration: number
  /** the video's frame size, for laying out its nodes */
  width?: number
  height?: number
  shots: { start: number; end: number; keyframe: Ref; clip?: Ref }[]
  audio?: Ref
  warnings: string[]
}

export const SPLIT_MAX_SHOTS = 60

const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }

export async function splitShots(assets: AssetStore, file: string, opts: SplitOptions = {}, signal?: AbortSignal, report?: (s: string) => void): Promise<ShotSplit> {
  const { ffmpeg } = await requireFfmpeg()
  const info = await probe(file, signal)
  if (!info.duration) throw new MediaError('无法读取视频时长')
  const threshold = clamp(opts.threshold, 0.05, 0.9, 0.3)
  const maxShots = Math.round(clamp(opts.maxShots, 1, SPLIT_MAX_SHOTS, 30))
  report?.('检测镜头切换…')
  const segs = segmentsFromCuts(await detectScenes(file, threshold, signal), info.duration, maxShots)
  const caps = await ffmpegInfo()
  const warnings: string[] = []
  const wantClips = opts.clips !== false && segs.length > 1
  if (wantClips && !caps.h264) warnings.push('这台电脑的 FFmpeg 没有 H.264 编码器：只提取了关键帧，没有切出片段')
  const audio = opts.audio !== false && info.hasAudio
  return withTemp(assets.dataDir, async (dir) => {
    const shots: ShotSplit['shots'] = []
    for (const [i, s] of segs.entries()) {
      report?.(`镜头 ${i + 1}/${segs.length}`)
      const f = join(dir, `k${i}.jpg`)
      // a frame near the middle of the shot: clear of the cut's transition
      await extractFrame(file, s.start + (s.end - s.start) / 2, f, 1920, signal)
      const k = assets.put(readFileSync(f), 'image/jpeg', `镜头${i + 1}-关键帧.jpg`)
      const shot: ShotSplit['shots'][number] = { start: s.start, end: s.end, keyframe: { assetId: k.id, mime: k.mime } }
      if (wantClips && caps.h264) {
        const c = join(dir, `c${i}.mp4`)
        const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', s.start.toFixed(3), '-i', file, '-t', (s.end - s.start).toFixed(3),
          '-map', '0:v:0', ...(info.hasAudio && caps.aac ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', c]
        const r = await run(ffmpeg, args, { signal, timeoutMs: 10 * 60_000 })
        if (r.code !== 0) throw new MediaError(`切出第 ${i + 1} 个镜头失败：${r.stderr.slice(-300)}`)
        const a = assets.put(readFileSync(c), 'video/mp4', `镜头${i + 1}.mp4`)
        shot.clip = { assetId: a.id, mime: a.mime }
      }
      shots.push(shot)
    }
    let track: Ref | undefined
    if (audio) {
      report?.('提取原音轨…')
      const out = join(dir, 'audio.m4a')
      const r = caps.aac
        ? await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '192k', out], { signal, timeoutMs: 10 * 60_000 })
        : { code: 1, stderr: '没有 AAC 编码器', stdout: '' }
      if (r.code === 0) { const a = assets.put(readFileSync(out), 'audio/mp4', '原音轨.m4a'); track = { assetId: a.id, mime: a.mime } }
      else warnings.push(`原音轨没有提取出来：${r.stderr.slice(-160)}`)
    }
    return { duration: info.duration, width: info.width, height: info.height, shots, audio: track, warnings }
  })
}

const stamp = (t: number) => { const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}` }

/**
 * The nodes for a split, beside the source node: a row of keyframes, a row of clips, the soundtrack.
 * Frames come first in the node list so they are drawn under their members.
 */
export function shotsToGraph(graph: ProjectGraph, sourceId: string, split: ShotSplit, label: string): { graph: ProjectGraph; added: string[] } {
  const src = graph.nodes.find((n) => n.id === sourceId)
  const placed = graph.nodes.filter((n) => !isGroup(n))
  const id = (p: string) => `${p}_${randomBytes(6).toString('hex')}`
  // a media node is ~320 wide with its picture capped at 300 tall, plus ~140 of title, button and ports
  const mediaH = Math.min(300, Math.round(300 * ((split.height ?? 9) / (split.width ?? 16))))
  const COL = 360, PAD = 32, HEAD = 48, ROW = HEAD + PAD * 2 + 150 + mediaH
  const frames: GraphNode[] = [], members: GraphNode[] = []
  const n = split.shots.length
  const w = PAD * 2 + n * COL - 40
  const rows = 1 + (split.shots.some((s) => s.clip) ? 1 : 0)
  const h = rows * (ROW + 40) + (split.audio ? HEAD + PAD * 2 + 230 + 40 : 0) - 40
  // beside the video, moved down past anything already there (an earlier split, a grid, …)
  const want = { x: src ? src.position.x + 460 : placed.length ? Math.max(...placed.map((x) => x.position.x)) + 460 : 0, y: src ? src.position.y : 0 }
  const { x: x0, y: y0 } = findFreeSpot(graph.nodes, want, { w, h })
  const name = label.slice(0, 24) || '视频'
  const row = (title: string, y: number, kind: 'image' | 'video', pick: (s: ShotSplit['shots'][number]) => Ref | undefined) => {
    frames.push({ id: id('g'), type: GROUP_TYPE, position: { x: x0, y }, data: { label: `${title} · ${name}`, size: { w, h: ROW } } })
    split.shots.forEach((s, i) => {
      const ref = pick(s)
      if (ref) members.push({ id: id('n'), type: kind, position: { x: x0 + PAD + i * COL, y: y + HEAD + PAD }, data: { label: `${kind === 'image' ? 'S' : 'M'}${String(i + 1).padStart(2, '0')} · ${stamp(s.start)}–${stamp(s.end)}`, assetId: ref.assetId, mime: ref.mime } })
    })
  }
  row('关键帧', y0, 'image', (s) => s.keyframe)
  if (split.shots.some((s) => s.clip)) row('镜头片段', y0 + ROW + 40, 'video', (s) => s.clip)
  if (split.audio) {
    const y = y0 + (split.shots.some((s) => s.clip) ? 2 : 1) * (ROW + 40)
    frames.push({ id: id('g'), type: GROUP_TYPE, position: { x: x0, y }, data: { label: `原音轨 · ${name}`, size: { w: PAD * 2 + COL - 40, h: HEAD + PAD * 2 + 230 } } })
    members.push({ id: id('n'), type: 'audio', position: { x: x0 + PAD, y: y + HEAD + PAD }, data: { label: `原音轨 · ${stamp(0)}–${stamp(split.duration)}`, assetId: split.audio.assetId, mime: split.audio.mime } })
  }
  if (graph.nodes.length + frames.length + members.length > MAX_NODES) throw new CanvasEditError(`拆出的镜头会让画布超过 ${MAX_NODES} 个节点：调高检测阈值或减少镜头数`)
  return {
    graph: { version: 1, nodes: [...frames, ...graph.nodes, ...members], edges: graph.edges },
    added: [...frames, ...members].map((x) => x.id),
  }
}

/** the video a node shows: an uploaded video node's file, or a node's current video result */
export function videoOfNode(node: GraphNode | undefined, outputs: { nodeId: string; outputs: Record<string, { type: string; assetId?: string; mime?: string }[]> }[]): Ref | undefined {
  if (!node) return undefined
  if (node.type === 'video' && typeof node.data.assetId === 'string') return { assetId: node.data.assetId, mime: String(node.data.mime ?? 'video/mp4') }
  const out = outputs.find((o) => o.nodeId === node.id)
  for (const vals of Object.values(out?.outputs ?? {})) {
    const v = vals.find((x) => x.type === 'video' && x.assetId)
    if (v) return { assetId: v.assetId!, mime: v.mime ?? 'video/mp4' }
  }
  return undefined
}
