import { VIDEO_DURATIONS } from './nodes'

/**
 * What a video model can do (rc.20): the lengths and resolutions it accepts, whether it can make its
 * own soundtrack, and how many reference pictures it takes. The node's menus follow these, so a
 * 15-second Seedance 2.0 segment or a 30-second Seedance 2.5 / MiniMax H3 shot can be chosen
 * directly. Models that are not listed keep the general 5 / 10 seconds.
 *
 * Sources: the model tables of Toonflow's media providers (MIT, HBAI-Ltd), taking only values two of
 * its providers agree on, and the adapters here. See docs/00-research/06-toonflow.md.
 */
export interface VideoCaps {
  /** a short name for menus and hints */
  label?: string
  durations: number[]
  /** resolution labels the provider takes as-is; none = the provider's own default only */
  resolutions?: string[]
  /** the model can generate its own sound (dialogue, effects, music); off unless switched on */
  audio?: boolean
  /** most reference pictures in one call */
  maxRefs?: number
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

const SEEDANCE_25: VideoCaps = { label: 'Seedance 2.5', durations: range(4, 30), resolutions: ['480p', '720p'], audio: true, maxRefs: 9 }
const SEEDANCE_20: VideoCaps = { label: 'Seedance 2.0', durations: range(4, 15), resolutions: ['480p', '720p', '1080p'], audio: true, maxRefs: 9 }
const MINIMAX_H3: VideoCaps = { label: 'MiniMax H3', durations: range(4, 30), resolutions: ['768P', '2K'], maxRefs: 9 }
const DEFAULT: VideoCaps = { durations: [...VIDEO_DURATIONS] }

/** the capabilities of a video model profile (by adapter and model id) */
export function videoCaps(p: { adapter?: string; model?: string } | undefined | null): VideoCaps {
  const model = (p?.model ?? '').toLowerCase()
  if (/seedance[-_. ]?2[-_. ]?5/.test(model)) return SEEDANCE_25
  if (/seedance[-_. ]?2(?![-_. ]?[1-9])/.test(model)) return /fast|mini/.test(model) ? { ...SEEDANCE_20, label: 'Seedance 2.0 Fast', resolutions: ['480p', '720p'] } : SEEDANCE_20
  if (/(^|[^a-z])h3([^a-z0-9]|$)|hailuo[-_ ]?h3/.test(model)) return MINIMAX_H3
  return DEFAULT
}

/** the longest a model's single generation can be */
export const maxVideoDuration = (p: { adapter?: string; model?: string } | undefined | null) => Math.max(...videoCaps(p).durations)

/** the lengths to offer in a menu: the model's, plus a value already set elsewhere (an import, an agent) */
export function durationOptions(p: { adapter?: string; model?: string } | undefined | null, current?: unknown): number[] {
  const list = videoCaps(p).durations
  return typeof current === 'number' && !list.includes(current) ? [...list, current].sort((a, b) => a - b) : list
}
