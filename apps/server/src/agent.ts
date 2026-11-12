import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  ASPECT_RATIOS, MAX_SUBJECT_IMAGES, NODE_TYPE_MAP, SUBJECT_KINDS, checkConnection, isSubjectName, tidyLayout,
  type GraphEdge, type GraphNode, type ModelProfile, type ProjectGraph,
} from '@hzc/core'
import { writeAtomic } from './fsutil'
import type { Store } from './db'
import type { AssetStore } from './assets'
import type { SkillStore } from './skills'

/**
 * Agents (Claude Code and other MCP clients) working on the canvas: the access key of a single-user
 * install, the change feed that keeps open pages up to date, and the canvas edits an agent can make —
 * validated the same way as the canvas assistant's plans (known node types, existing ports, matching
 * types, one wire per single input, no cycles, known parameters only).
 */

// ---------------------------------------------------------------- access key (desktop / one WebUI)

/**
 * One key in `<data>/agent-token` (owner-only). The desktop bridge reads it from there; for HTTP
 * clients the person copies it from 设置 → Agent 接入. No file = agents are not allowed in.
 */
export class AgentAccess {
  private file: string
  constructor(dataDir: string) { this.file = join(dataDir, 'agent-token') }
  token(): string | undefined {
    try { const t = readFileSync(this.file, 'utf8').trim(); return /^hzc_[\w-]{20,}$/.test(t) ? t : undefined } catch { return undefined }
  }
  /** turn access on (keeps an existing key) */
  enable(): string { return this.token() ?? this.rotate() }
  rotate(): string {
    const t = `hzc_${randomBytes(32).toString('base64url')}`
    writeAtomic(this.file, `${t}\n`, 0o600)
    return t
  }
  disable() { rmSync(this.file, { force: true }) }
  matches(given: string | undefined): boolean {
    const t = this.token()
    if (!t || !given || given.length > 200) return false
    const a = createHash('sha256').update(t).digest(), b = createHash('sha256').update(given).digest()
    return timingSafeEqual(a, b)
  }
  get enabled() { return existsSync(this.file) && !!this.token() }
}

// ---------------------------------------------------------------- change feed

export type ChangeEvent =
  | { kind: 'project'; projectId: string; rev: string; source?: string }
  | { kind: 'run'; projectId: string; runId: string; source?: string }
  | { kind: 'outputs'; projectId: string; nodeIds: string[] }
  | { kind: 'projects' }

type Listener = (e: ChangeEvent) => void

/** what changed in one workspace, for pages that have it open (`GET /api/events`) */
export class ChangeHub {
  private listeners = new Set<Listener>()
  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  emit(e: ChangeEvent) { for (const l of this.listeners) { try { l(e) } catch { /* a closed page must not break the others */ } } }
  get size() { return this.listeners.size }
}

// by database file: a workspace closed while idle and opened again (accounts mode) keeps its listeners
const hubs = new Map<string, ChangeHub>()
const memoryHubs = new WeakMap<Store, ChangeHub>()
export function hubFor(store: Store): ChangeHub {
  if (store.file === ':memory:') {
    let h = memoryHubs.get(store)
    if (!h) { h = new ChangeHub(); memoryHubs.set(store, h) }
    return h
  }
  let h = hubs.get(store.file)
  if (!h) { h = new ChangeHub(); hubs.set(store.file, h) }
  return h
}

// ---------------------------------------------------------------- canvas edits

export class CanvasEditError extends Error {}

export interface NodeSpec {
  key?: unknown; type?: unknown; label?: unknown; text?: unknown; params?: unknown; model?: unknown; asset_id?: unknown
}
export interface EdgeSpec { from?: unknown; from_port?: unknown; to?: unknown; to_port?: unknown }

const MAX_NODES_PER_CALL = 40
const MAX_NODES = 600
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)
const intIn = (v: unknown, min: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : undefined }
const oneOf = <T extends string | number>(list: readonly T[]) => (v: unknown) => (list as readonly unknown[]).includes(v) ? (v as T) : undefined
const text = (max: number) => (v: unknown) => (typeof v === 'string' ? v.slice(0, max) : undefined)
const extra = (v: unknown) => {
  const o = typeof v === 'string' ? (() => { try { return JSON.parse(v) as unknown } catch { return undefined } })() : v
  return o && typeof o === 'object' && !Array.isArray(o) && JSON.stringify(o).length <= 8000 ? o : undefined
}
const lang = oneOf(['zh', 'en'] as const)
const aspect = oneOf(ASPECT_RATIOS)

type Rule = (v: unknown, ctx: { skills: string[] }) => unknown
/** parameters an agent may set, per node type, with their checks (anything else is reported and ignored) */
export const AGENT_PARAMS: Record<string, Record<string, { rule: Rule; hint: string }>> = {
  'image-gen': {
    aspect_ratio: { rule: aspect, hint: ASPECT_RATIOS.join(' | ') },
    count: { rule: (v) => intIn(v, 1, 4), hint: '1–4 results per run (each is a paid call)' },
    extra: { rule: extra, hint: 'provider-specific JSON object, merged last' },
  },
  'video-gen': {
    aspect_ratio: { rule: aspect, hint: ASPECT_RATIOS.join(' | ') },
    duration: { rule: (v) => intIn(v, 1, 60), hint: 'seconds (most models: 5 or 10)' },
    count: { rule: (v) => intIn(v, 1, 4), hint: '1–4 results per run (each is a paid call)' },
    extra: { rule: extra, hint: 'provider-specific JSON object, merged last' },
  },
  tts: {
    voice: { rule: text(120), hint: 'provider voice id' },
    speed: { rule: (v) => { const n = Number(v); return n >= 0.5 && n <= 2 ? n : undefined }, hint: '0.5–2' },
    extra: { rule: extra, hint: 'provider-specific JSON object' },
  },
  llm: { system: { rule: text(4000), hint: 'system prompt' } },
  vlm: { instruction: { rule: text(4000), hint: 'what to look for in the images' } },
  director: {
    skill: { rule: (v, c) => (c.skills.includes(String(v)) ? String(v) : undefined), hint: 'a director skill name (list_models → skills)' },
    shots: { rule: (v) => intIn(v, 1, 12), hint: '1–12' },
    aspect_ratio: { rule: aspect, hint: ASPECT_RATIOS.join(' | ') },
    style: { rule: text(200), hint: 'visual style in a few words' },
    lang: { rule: lang, hint: 'zh | en' },
  },
  'image-reverse': {
    style: { rule: oneOf(['general', 'midjourney', 'sdxl', 'flux', 'video'] as const), hint: 'general | midjourney | sdxl | flux | video' },
    lang: { rule: lang, hint: 'zh | en' },
    skill: { rule: (v, c) => (c.skills.includes(String(v)) ? String(v) : undefined), hint: 'an image-reverse skill name' },
  },
  'video-reverse': {
    maxShots: { rule: (v) => intIn(v, 2, 16), hint: '2–16' },
    threshold: { rule: (v) => { const n = Number(v); return n >= 0.05 && n <= 0.9 ? n : undefined }, hint: 'scene-cut sensitivity 0.05–0.9' },
    lang: { rule: lang, hint: 'zh | en' },
  },
  subject: {
    name: { rule: (v) => (isSubjectName(String(v ?? '').trim()) ? String(v).trim() : undefined), hint: 'name used as @name in prompts (no spaces or @, ≤ 24 chars)' },
    kind: { rule: oneOf(SUBJECT_KINDS), hint: SUBJECT_KINDS.join(' | ') },
  },
  export: {
    fps: { rule: oneOf([24, 25, 30, 60] as const), hint: '24 | 25 | 30 | 60' },
    size: { rule: (v) => (typeof v === 'string' && /^\d{2,5}x\d{2,5}$/.test(v) ? v : undefined), hint: 'e.g. 1920x1080 (default: first clip)' },
    keepAudio: { rule: oneOf(['mix', 'drop'] as const), hint: 'mix | drop (the clips’ own sound)' },
    editProject: { rule: (v) => (v === true ? true : undefined), hint: 'true: also an editor project (Shotcut) zip' },
  },
}
/** node types whose `text` is meaningful (prompt, script, lines, idea, notes, subject description) */
export const TEXT_TYPES = new Set(['text', 'image-gen', 'video-gen', 'llm', 'tts', 'director', 'subject'])
const MEDIA_INPUT = new Set(['image', 'video', 'audio'])

export interface EditContext { store: Store; assets: AssetStore; skills: SkillStore }

const skillNames = (c: EditContext) => c.skills.list().map((s) => s.name)

/** a profile by id or (case-insensitive) name, of the kind the node needs */
export function resolveModel(c: EditContext, type: string, model: unknown): ModelProfile {
  const kind = NODE_TYPE_MAP[type]?.modelKind
  if (!kind) throw new CanvasEditError(`「${type}」节点不使用模型`)
  const want = String(model ?? '').trim()
  const all = c.store.listProfiles()
  const p = all.find((x) => x.id === want) ?? all.find((x) => x.name.toLowerCase() === want.toLowerCase())
  if (!p) throw new CanvasEditError(`找不到模型「${want}」（用 list_models 查看可用的模型档案）`)
  // a director runs on a text model, reverse nodes on a vision model
  const ok = p.kind === kind || (kind === 'llm' && p.kind === 'vlm')
  if (!ok) throw new CanvasEditError(`模型「${p.name}」是 ${p.kind} 类型，「${type}」节点需要 ${kind}`)
  return p
}

/** the first profile of the kind a node needs (what the page does when a node is added) */
function defaultModel(c: EditContext, type: string): string | undefined {
  const kind = NODE_TYPE_MAP[type]?.modelKind
  return kind ? c.store.listProfiles().find((p) => p.kind === kind)?.id : undefined
}

function mediaOf(c: EditContext, assetId: unknown, want?: 'image' | 'video' | 'audio'): { assetId: string; mime: string } {
  const id = String(assetId ?? '')
  const a = c.assets.get(id)
  if (!a) throw new CanvasEditError(`找不到素材 ${id}（先用 upload_asset 上传）`)
  if (want && !a.mime.startsWith(`${want}/`)) throw new CanvasEditError(`素材 ${id} 是 ${a.mime}，这里需要${want}`)
  return { assetId: a.id, mime: a.mime }
}

/** validate params for a node type; returns the accepted ones and notes about the rest */
function cleanParams(c: EditContext, type: string, raw: unknown, warnings: string[], prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (raw === undefined || raw === null) return out
  if (typeof raw !== 'object' || Array.isArray(raw)) { warnings.push(`${prefix}params 必须是对象，已忽略`); return out }
  const rules = AGENT_PARAMS[type] ?? {}
  const ctx = { skills: skillNames(c) }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === 'images' && type === 'subject') continue // handled by the caller (asset ids)
    if (v === null) { out[k] = null; continue } // null removes a parameter (update_node)
    const r = rules[k]
    if (!r) { warnings.push(`${prefix}「${type}」没有参数 ${k}，已忽略`); continue }
    const val = r.rule(v, ctx)
    if (val === undefined) { warnings.push(`${prefix}参数 ${k} 的值无效（${r.hint}），已忽略`); continue }
    out[k] = val
  }
  return out
}

function subjectImages(c: EditContext, raw: unknown): { assetId: string; mime: string }[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new CanvasEditError('subject 的 params.images 必须是素材 id 列表')
  return raw.slice(0, MAX_SUBJECT_IMAGES).map((id) => mediaOf(c, id, 'image'))
}

export interface AddResult { graph: ProjectGraph; created: Record<string, string>; edges: number; warnings: string[] }

/** add nodes (and wires, also between existing nodes) to a canvas; new nodes are placed right of what is there */
export function addToGraph(c: EditContext, graph: ProjectGraph, nodesIn: NodeSpec[], edgesIn: EdgeSpec[]): AddResult {
  if (nodesIn.length > MAX_NODES_PER_CALL) throw new CanvasEditError(`一次最多添加 ${MAX_NODES_PER_CALL} 个节点`)
  if (graph.nodes.length + nodesIn.length > MAX_NODES) throw new CanvasEditError(`画布最多 ${MAX_NODES} 个节点`)
  const warnings: string[] = []
  const created: Record<string, string> = {}
  const fresh: GraphNode[] = []
  nodesIn.forEach((n, i) => {
    const type = str(n.type, 40) ?? ''
    const def = NODE_TYPE_MAP[type]
    const prefix = `第 ${i + 1} 个节点：`
    if (!def) throw new CanvasEditError(`${prefix}未知的节点类型「${type}」（用 list_node_types 查看）`)
    let key = str(n.key, 60) || `n${i + 1}`
    while (created[key]) key += '_'
    const id = `n_${randomBytes(6).toString('hex')}`
    created[key] = id
    const params = cleanParams(c, type, n.params, warnings, prefix)
    for (const k of Object.keys(params)) if (params[k] === null) delete params[k]
    const data: GraphNode['data'] = { label: str(n.label, 60) || def.label, text: '', params }
    if (TEXT_TYPES.has(type) && typeof n.text === 'string') data.text = n.text.slice(0, 20000)
    else if (n.text !== undefined && !TEXT_TYPES.has(type)) warnings.push(`${prefix}「${type}」没有文本，text 已忽略`)
    if (def.modelKind) data.profileId = n.model !== undefined && n.model !== '' ? resolveModel(c, type, n.model).id : defaultModel(c, type)
    if (MEDIA_INPUT.has(type) && n.asset_id !== undefined) Object.assign(data, mediaOf(c, n.asset_id, type as 'image' | 'video' | 'audio'))
    if (type === 'subject') {
      const imgs = subjectImages(c, (n.params as Record<string, unknown> | undefined)?.images)
      if (imgs) params.images = imgs
      if (typeof params.name === 'string') data.label = `@${params.name}`
    }
    fresh.push({ id, type, position: { x: 0, y: 0 }, data })
  })

  const all = [...graph.nodes, ...fresh]
  const edges: GraphEdge[] = [...graph.edges]
  const resolve = (ref: unknown) => {
    const r = String(ref ?? '').trim().replace(/^@/, '')
    return created[r] ?? (graph.nodes.some((n) => n.id === r) ? r : undefined)
  }
  let added = 0
  edgesIn.forEach((e, i) => {
    const source = resolve(e.from), target = resolve(e.to)
    if (!source || !target) throw new CanvasEditError(`第 ${i + 1} 条连线：找不到节点「${!source ? String(e.from) : String(e.to)}」（用本次的 key 或画布上已有节点的 id）`)
    const sDef = NODE_TYPE_MAP[all.find((n) => n.id === source)!.type]!, tDef = NODE_TYPE_MAP[all.find((n) => n.id === target)!.type]!
    const sourceHandle = str(e.from_port, 40) || sDef.outputs[0]?.id || 'out'
    const targetHandle = str(e.to_port, 40) || tDef.inputs[0]?.id || 'in'
    const ok = checkConnection(all, edges, { source, sourceHandle, target, targetHandle })
    if (!ok.ok) throw new CanvasEditError(`第 ${i + 1} 条连线（${source}.${sourceHandle} → ${target}.${targetHandle}）不能连：${ok.reason}`)
    edges.push({ id: `e_${randomBytes(6).toString('hex')}`, source, sourceHandle, target, targetHandle })
    added++
  })

  // lay the new nodes out left to right, to the right of the canvas
  if (fresh.length) {
    const ids = new Set(fresh.map((n) => n.id))
    const pos = tidyLayout(fresh, edges.filter((e) => ids.has(e.source) && ids.has(e.target)))
    const x0 = graph.nodes.length ? Math.max(...graph.nodes.map((n) => n.position.x)) + 460 : 0
    const y0 = graph.nodes.length ? Math.min(...graph.nodes.map((n) => n.position.y)) : 0
    for (const n of fresh) { const p = pos.get(n.id)!; n.position = { x: Math.round(x0 + p.x), y: Math.round(y0 + p.y) } }
  }
  return { graph: { version: 1, nodes: all, edges }, created, edges: added, warnings }
}

export interface NodePatch { label?: unknown; text?: unknown; params?: unknown; model?: unknown; asset_id?: unknown; position?: unknown }

export function updateInGraph(c: EditContext, graph: ProjectGraph, nodeId: string, patch: NodePatch): { graph: ProjectGraph; warnings: string[] } {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) throw new CanvasEditError(`画布上没有节点 ${nodeId}`)
  const warnings: string[] = []
  const data: GraphNode['data'] = { ...node.data, params: { ...(node.data.params ?? {}) } }
  if (patch.label !== undefined) data.label = str(patch.label, 60) || data.label
  if (patch.text !== undefined) {
    if (!TEXT_TYPES.has(node.type)) warnings.push(`「${node.type}」没有文本，text 已忽略`)
    else data.text = String(patch.text ?? '').slice(0, 20000)
  }
  if (patch.params !== undefined) {
    const p = cleanParams(c, node.type, patch.params, warnings, '')
    for (const [k, v] of Object.entries(p)) { if (v === null) delete data.params![k]; else data.params![k] = v }
    if (node.type === 'subject') {
      const imgs = subjectImages(c, (patch.params as Record<string, unknown> | undefined)?.images)
      if (imgs) data.params!.images = imgs
      if (typeof data.params!.name === 'string') data.label = `@${data.params!.name}`
    }
  }
  if (patch.model !== undefined) data.profileId = resolveModel(c, node.type, patch.model).id
  if (patch.asset_id !== undefined) {
    if (!MEDIA_INPUT.has(node.type)) throw new CanvasEditError('只有图片 / 视频 / 音频节点可以换素材')
    Object.assign(data, mediaOf(c, patch.asset_id, node.type as 'image' | 'video' | 'audio'))
  }
  let position = node.position
  if (patch.position !== undefined) {
    const p = patch.position as { x?: unknown; y?: unknown }
    if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) position = { x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) }
    else warnings.push('position 需要 {x, y} 数字，已忽略')
  }
  return { graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, position, data } : n)) }, warnings }
}

export function removeFromGraph(graph: ProjectGraph, nodeIds: string[], edgesIn: EdgeSpec[]): { graph: ProjectGraph; nodes: number; edges: number } {
  const drop = new Set(nodeIds)
  const missing = nodeIds.filter((id) => !graph.nodes.some((n) => n.id === id))
  if (missing.length) throw new CanvasEditError(`画布上没有节点 ${missing.join(', ')}`)
  const isRemoved = (e: GraphEdge) => drop.has(e.source) || drop.has(e.target) || edgesIn.some((x) =>
    String(x.from ?? '').replace(/^@/, '') === e.source && String(x.to ?? '').replace(/^@/, '') === e.target
    && (x.from_port === undefined || x.from_port === e.sourceHandle) && (x.to_port === undefined || x.to_port === e.targetHandle))
  const edges = graph.edges.filter((e) => !isRemoved(e))
  return { graph: { ...graph, nodes: graph.nodes.filter((n) => !drop.has(n.id)), edges }, nodes: drop.size, edges: graph.edges.length - edges.length }
}
