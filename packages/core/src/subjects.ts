/**
 * Subjects (主体): a named character, product or scene with reference pictures, kept as a node on the
 * canvas. Writing `@name` in any prompt brings it in: the mention becomes the plain name, its
 * description is added once, and its pictures go along as references where the model takes them.
 */
import type { GraphNode, ProjectGraph } from './graph'

export const SUBJECT_KINDS = ['character', 'product', 'scene'] as const
export type SubjectKind = (typeof SUBJECT_KINDS)[number]
export const SUBJECT_KIND_LABEL: Record<SubjectKind, string> = { character: '人物', product: '物品', scene: '场景' }
export const MAX_SUBJECT_IMAGES = 4

export interface SubjectImage { assetId: string; mime: string }
export interface Subject { nodeId: string; name: string; kind: SubjectKind; description: string; images: SubjectImage[] }

/** a usable @name: no spaces, no @, at most 24 characters */
export const isSubjectName = (v: unknown): v is string => typeof v === 'string' && /^[^\s@]{1,24}$/.test(v)

export function subjectOf(n: Pick<GraphNode, 'id' | 'type' | 'data'>): Subject | undefined {
  if (n.type !== 'subject') return undefined
  const p = n.data.params ?? {}
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  if (!isSubjectName(name)) return undefined
  const images = (Array.isArray(p.images) ? p.images : [])
    .filter((x): x is SubjectImage => !!x && typeof x === 'object' && typeof (x as SubjectImage).assetId === 'string' && typeof (x as SubjectImage).mime === 'string')
    .slice(0, MAX_SUBJECT_IMAGES)
  const kind = (['character', 'product', 'scene'] as const).includes(p.kind as SubjectKind) ? (p.kind as SubjectKind) : 'character'
  return { nodeId: n.id, name, kind, description: (n.data.text ?? '').trim(), images }
}

/** every subject on a canvas (first one wins when two share a name) */
export function subjectsOf(graph: Pick<ProjectGraph, 'nodes'>): Subject[] {
  const seen = new Set<string>()
  const out: Subject[] = []
  for (const n of graph.nodes) {
    const s = subjectOf(n)
    if (s && !seen.has(s.name)) { seen.add(s.name); out.push(s) }
  }
  return out
}

/** which subjects a text mentions; longer names first, so `@小橘猫` never also counts as `@小橘` */
export function mentionedSubjects(text: string, subjects: Subject[]): Subject[] {
  if (!text.includes('@')) return []
  let rest = text
  const used: Subject[] = []
  for (const s of [...subjects].sort((a, b) => b.name.length - a.name.length)) {
    const tag = `@${s.name}`
    if (rest.includes(tag)) { used.push(s); rest = rest.split(tag).join('\u0000') }
  }
  // keep the order of first appearance in the text
  return used.sort((a, b) => text.indexOf(`@${a.name}`) - text.indexOf(`@${b.name}`))
}

/**
 * Replace each `@name` with the name and add the descriptions once at the end. Returns the subjects
 * used, in order of appearance, so their pictures can go along as references.
 */
export function resolveMentions(text: string, subjects: Subject[]): { text: string; used: Subject[] } {
  const used = mentionedSubjects(text, subjects)
  if (!used.length) return { text, used }
  let out = text
  for (const s of [...used].sort((a, b) => b.name.length - a.name.length)) out = out.split(`@${s.name}`).join(s.name)
  const notes = used.filter((s) => s.description).map((s) => `- ${s.name}（${SUBJECT_KIND_LABEL[s.kind]}）：${s.description}`)
  return { text: notes.length ? `${out}\n\n设定：\n${notes.join('\n')}` : out, used }
}
