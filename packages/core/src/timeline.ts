/**
 * The export node's timeline: the order of its clips and how much of each clip is used. Clips are
 * named by the node they come from (a video input, a video generation…), so the order and the trims
 * survive re-generating a clip. Stored in the export node's params:
 *   order: ["n_ab12", "n_cd34", …]          clips listed here come first, in this order
 *   trims: { "n_ab12": { in: 0.5, out: 4 } } seconds into the clip; out omitted = to its end
 * Clips not in `order` follow in canvas order (top to bottom, then left to right).
 */
export interface ClipTrim { in?: number; out?: number }
export interface TimelineParams { order: string[]; trims: Record<string, ClipTrim> }

export const MAX_TIMELINE_CLIPS = 200
const round = (n: number) => Math.round(n * 100) / 100

/** a trim as stored: in ≥ 0, out at least 0.1 s after in; nothing left = undefined */
export function cleanTrim(raw: unknown): ClipTrim | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as { in?: unknown; out?: unknown }
  const a = Number(r.in), b = Number(r.out)
  const t: ClipTrim = {}
  if (Number.isFinite(a) && a > 0) t.in = round(Math.min(a, 24 * 3600))
  if (Number.isFinite(b) && b > 0) t.out = round(Math.min(b, 24 * 3600))
  if (t.out !== undefined && t.out < (t.in ?? 0) + 0.1) delete t.out
  return t.in === undefined && t.out === undefined ? undefined : t
}

/** the timeline params of an export node, checked */
export function timelineOf(params: Record<string, unknown> | undefined): TimelineParams {
  const order = Array.isArray(params?.order) ? [...new Set(params!.order.filter((x): x is string => typeof x === 'string' && x.length <= 80))].slice(0, MAX_TIMELINE_CLIPS) : []
  const trims: Record<string, ClipTrim> = {}
  const raw = params?.trims
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_TIMELINE_CLIPS)) {
      const t = cleanTrim(v)
      if (t && k.length <= 80) trims[k] = t
    }
  }
  return { order, trims }
}

/**
 * The order to play clips in: `sources[i]` is the node clip i comes from (in canvas order). Returns the
 * clip indexes in timeline order — listed nodes first, in their listed order, then the rest as they were.
 */
export function timelineOrder(sources: string[], order: string[]): number[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  return sources.map((s, i) => ({ i, r: rank.get(s) ?? order.length })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.i)
}

/** the part of a clip that is used, in seconds, given its full length */
export function trimmedSpan(trim: ClipTrim | undefined, duration: number): { start: number; length: number } {
  const start = Math.min(Math.max(0, trim?.in ?? 0), Math.max(0, duration - 0.1))
  const end = Math.min(duration, trim?.out ?? duration)
  return { start, length: Math.max(0.1, end - start) }
}
