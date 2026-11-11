import type { ProjectGraph } from '@hzc/core'

/**
 * Unsaved-work backup. When a save fails (server down, network gone) or the page closes with edits
 * not yet saved, the canvas is kept in this browser; opening the project again offers it back.
 * A successful save removes it.
 */
export interface Draft { name: string; graph: ProjectGraph; at: string }

const key = (projectId: string) => `hzc.draft.${projectId}`

export function writeDraft(projectId: string, name: string, graph: ProjectGraph): boolean {
  try {
    localStorage.setItem(key(projectId), JSON.stringify({ name, graph, at: new Date().toISOString() } satisfies Draft))
    return true
  } catch { return false } // storage full or blocked: nothing more we can do here
}

export function readDraft(projectId: string): Draft | undefined {
  try {
    const raw = localStorage.getItem(key(projectId))
    if (!raw) return undefined
    const d = JSON.parse(raw) as Partial<Draft>
    if (typeof d?.name !== 'string' || !Array.isArray(d.graph?.nodes) || !Array.isArray(d.graph?.edges) || typeof d.at !== 'string') return undefined
    return d as Draft
  } catch { return undefined }
}

export function clearDraft(projectId: string) {
  try { localStorage.removeItem(key(projectId)) } catch { /* ignore */ }
}

/** same canvas content (ignores key order) */
export function sameGraph(a: ProjectGraph, b: ProjectGraph): boolean {
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : v
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}
