import { createHash, randomUUID } from 'node:crypto'
import {
  GENERATIVE_TYPES, NODE_TYPE_MAP, ancestorsOf, collectInputs, topoOrder,
  type Estimate, type EstimateItem, type GraphNode, type NodeOutputs, type NodeRunState, type ProjectGraph, type RunEvent,
} from '@hzc/core'
import type { AssetStore } from './assets'
import type { Store } from './db'
import { handlerFor, NodeError, type HandlerCtx } from './handlers'
import { ProviderError } from './providers'
import { SecretError } from './secrets'
import type { SkillStore } from './skills'
import { DEFAULT_DIRECTOR_SKILL } from './handlers'

type Listener = (e: RunEvent) => void

interface Run {
  id: string
  projectId: string
  events: RunEvent[]
  listeners: Set<Listener>
  ctrl: AbortController
  finished: boolean
}

export interface StartOptions {
  /** run these nodes (and their ancestors); default: whole graph */
  nodeIds?: string[]
  /** ignore the cache for the target nodes */
  force?: boolean
}

export const DEFAULT_MAX_PARALLEL = 4
export const DEFAULT_PER_MODEL = 3
export const MAX_PARALLEL_CAP = 8
const clampInt = (v: unknown, min: number, max: number) => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined
}

/** Node types that never call a provider — always recomputed, never "cached" in the UI sense. */
const TRIVIAL = new Set(['text', 'image', 'video', 'audio', 'preview'])

/**
 * Multi-input ports receive values in canvas order (top-to-bottom, then left-to-right), so a column
 * of storyboard rows feeds an Export node in shot order regardless of wiring order. Used by both the
 * run and the estimate so their cache keys agree.
 */
function canvasOrderedEdges(graph: ProjectGraph) {
  const pos = new Map(graph.nodes.map((n) => [n.id, n.position]))
  return [...graph.edges].sort((a, b) => {
    const pa = pos.get(a.source), pb = pos.get(b.source)
    return (pa?.y ?? 0) - (pb?.y ?? 0) || (pa?.x ?? 0) - (pb?.x ?? 0)
  })
}

/** Outputs of trivial nodes computed without side effects (for estimates). undefined = would fail. */
function trivialOutputs(node: GraphNode, inputs: Record<string, NodeOutputs[string]>): NodeOutputs | undefined {
  if (node.type === 'text') return { out: [{ type: 'text', text: node.data.text ?? '' }] }
  if (node.type === 'preview') return { in: inputs.in ?? [] }
  if (!node.data.assetId || !node.data.mime) return undefined
  return { out: [{ type: node.type as 'image' | 'video' | 'audio', assetId: node.data.assetId, mime: node.data.mime }] }
}

export class Engine {
  private runs = new Map<string, Run>()
  /** one active run per project: starting a new one cancels the previous */
  private active = new Map<string, string>()

  isRunning(projectId: string): boolean { return this.active.has(projectId) }
  /** any run in progress (a workspace with one must not be closed) */
  get busy(): boolean { return this.active.size > 0 }

  private chatAdapter?: HandlerCtx['chatAdapter']
  private pollDelays?: number[]
  private skills?: SkillStore
  private onRun?: () => void
  /** provider calls that may be in flight at once, over all models (1 = one node at a time) */
  readonly maxParallel: number

  constructor(
    private store: Store,
    private assets: AssetStore,
    opts: { chatAdapter?: HandlerCtx['chatAdapter']; /** test hook: provider polling schedule */ pollDelays?: number[]; skills?: SkillStore; maxParallel?: number; /** usage counting (accounts mode) */ onRun?: () => void } = {},
  ) {
    this.chatAdapter = opts.chatAdapter
    this.pollDelays = opts.pollDelays
    this.skills = opts.skills
    this.onRun = opts.onRun
    this.maxParallel = clampInt(opts.maxParallel, 1, MAX_PARALLEL_CAP) ?? DEFAULT_MAX_PARALLEL
  }

  /**
   * How many calls of this node's kind may run at once, and what they share the limit with:
   * - a model profile: `defaults._concurrency` (1–8) when set, else 3;
   * - Ollama: 1 per server address — a local GPU serves one request at a time, and two models
   *   taking turns would keep reloading each other;
   * - nodes without a model (Export: FFmpeg on this computer): one at a time.
   */
  private limitFor(node: GraphNode): { key: string; max: number } {
    const p = node.data.profileId ? this.store.getProfile(node.data.profileId) : undefined
    if (!p) return { key: 'local', max: 1 }
    const own = clampInt(p.defaults?._concurrency, 1, MAX_PARALLEL_CAP)
    if (own) return { key: `p:${p.id}`, max: own }
    if (p.adapter === 'ollama') return { key: `ollama:${p.endpoint.replace(/\/+$/, '').toLowerCase()}`, max: 1 }
    return { key: `p:${p.id}`, max: DEFAULT_PER_MODEL }
  }

  /**
   * What a run would do, without calling anything: which provider calls will be reused from cache,
   * which are generative (paid media), and the total of the user-entered per-call prices.
   */
  estimate(projectId: string, graph: ProjectGraph, opts: StartOptions = {}): Estimate {
    const targets = opts.nodeIds?.length ? new Set(opts.nodeIds) : undefined
    const order = topoOrder(graph, targets ? ancestorsOf(graph, [...targets]) : undefined)
    const sim = new Map<string, NodeOutputs>()
    const edges = canvasOrderedEdges(graph)
    const unknown = new Set<string>() // nodes whose output we cannot predict (they will really run)
    const items: EstimateItem[] = []
    for (const nodeId of order) {
      const node = graph.nodes.find((n) => n.id === nodeId)!
      const upstreamUnknown = graph.edges.some((e) => e.target === nodeId && unknown.has(e.source))
      if (TRIVIAL.has(node.type)) {
        const out = trivialOutputs(node, collectInputs(edges, nodeId, sim))
        if (out && !upstreamUnknown) sim.set(nodeId, out); else unknown.add(nodeId)
        continue
      }
      const stored = this.store.getNodeOutput(projectId, nodeId)
      const force = opts.force && (!targets || targets.has(nodeId))
      const cached = !upstreamUnknown && !force && !!stored && stored.cacheKey === this.cacheKey(graph, nodeId, collectInputs(edges, nodeId, sim))
      if (cached) sim.set(nodeId, stored!.outputs); else unknown.add(nodeId)
      const profile = node.data.profileId ? this.store.getProfile(node.data.profileId) : undefined
      items.push({
        nodeId, type: node.type, label: node.data.label ?? NODE_TYPE_MAP[node.type]?.label ?? node.type,
        profileName: profile?.name, cached, generative: GENERATIVE_TYPES.has(node.type), cost: profile?.cost ?? null,
      })
    }
    const totals: Record<string, number> = {}
    let unpriced = 0
    for (const it of items) {
      if (it.cached) continue
      if (it.cost) totals[it.cost.currency] = Math.round(((totals[it.cost.currency] ?? 0) + it.cost.amount) * 10000) / 10000
      else unpriced++
    }
    return { items, totals, unpriced }
  }

  start(projectId: string, graph: ProjectGraph, opts: StartOptions = {}): string {
    const prev = this.active.get(projectId)
    if (prev) this.cancel(prev)
    const run: Run = { id: randomUUID(), projectId, events: [], listeners: new Set(), ctrl: new AbortController(), finished: false }
    this.runs.set(run.id, run)
    this.active.set(projectId, run.id)
    queueMicrotask(() => void this.execute(run, graph, opts))
    try { this.onRun?.() } catch { /* counting must never stop a run */ }
    return run.id
  }

  /** stop every run (the workspace is being deleted) */
  cancelAll() { for (const r of this.runs.values()) if (!r.finished) r.ctrl.abort() }

  cancel(runId: string): boolean {
    const r = this.runs.get(runId)
    if (!r || r.finished) return false
    r.ctrl.abort()
    return true
  }

  /** Replays past events, then streams new ones. Returns an unsubscribe function. */
  subscribe(runId: string, fn: Listener): (() => void) | undefined {
    const r = this.runs.get(runId)
    if (!r) return undefined
    for (const e of r.events) fn(e)
    if (r.finished) return () => {}
    r.listeners.add(fn)
    return () => r.listeners.delete(fn)
  }

  isFinished(runId: string) { return this.runs.get(runId)?.finished ?? true }

  /** resolves when the run finishes (tests / CLI) */
  wait(runId: string): Promise<RunEvent[]> {
    return new Promise((resolve) => {
      const r = this.runs.get(runId)
      if (!r) return resolve([])
      if (r.finished) return resolve(r.events)
      const un = this.subscribe(runId, (e) => { if (e.kind === 'run-end') { un?.(); resolve(r.events) } })
    })
  }

  private emit(run: Run, e: RunEvent) {
    run.events.push(e)
    for (const l of run.listeners) l(e)
  }

  private setNode(run: Run, nodeId: string, state: NodeRunState) {
    this.emit(run, { kind: 'node', runId: run.id, nodeId, state })
  }

  private cacheKey(graph: ProjectGraph, nodeId: string, inputs: unknown): string {
    const n = graph.nodes.find((x) => x.id === nodeId)!
    const p = n.data.profileId ? this.store.getProfile(n.data.profileId) : undefined
    const material = {
      type: n.type,
      data: { text: n.data.text, params: n.data.params, assetId: n.data.assetId, profileId: n.data.profileId },
      profile: p ? { adapter: p.adapter, endpoint: p.endpoint, model: p.model, defaults: p.defaults, updatedAt: p.updatedAt } : null,
      // editing a skill's instructions must invalidate cached director results
      skill: n.type === 'director' ? (this.skills?.instructions(String(n.data.params?.skill || DEFAULT_DIRECTOR_SKILL)) ?? null)
        : n.type === 'image-reverse' && n.data.params?.skill ? (this.skills?.instructions(String(n.data.params.skill)) ?? null) : undefined,
      inputs,
    }
    return createHash('sha256').update(JSON.stringify(material)).digest('hex')
  }

  private async execute(run: Run, graph: ProjectGraph, opts: StartOptions) {
    const targets = opts.nodeIds?.length ? new Set(opts.nodeIds) : undefined
    let order: string[]
    try {
      order = topoOrder(graph, targets ? ancestorsOf(graph, [...targets]) : undefined)
    } catch (e) {
      this.emit(run, { kind: 'run-start', runId: run.id, nodeIds: [] })
      return this.finish(run, 'error')
    }
    this.emit(run, { kind: 'run-start', runId: run.id, nodeIds: order })
    for (const id of order) this.setNode(run, id, { status: 'queued' })

    const outputs = new Map<string, NodeOutputs>()
    const failed = new Set<string>()
    const edgesInOrder = canvasOrderedEdges(graph)
    let anyError = false

    // Independent nodes run at the same time (a storyboard's shots, the variants of a comparison),
    // within limits: `maxParallel` provider calls overall, and a few per model so one provider isn't
    // flooded. A node starts once everything upstream of it has settled; ties go in canvas order.
    const nodeOf = new Map(graph.nodes.map((n) => [n.id, n]))
    const inRun = new Set(order)
    const preds = new Map(order.map((id) => [id, [...new Set(graph.edges.filter((e) => e.target === id && inRun.has(e.source)).map((e) => e.source))]]))
    const pending = new Set(order)
    const settled = new Set<string>()
    const busy = new Map<string, number>() // limit key -> calls in flight
    let slots = 0                          // provider calls in flight (trivial nodes don't count)
    let inFlight = 0

    /** one node from "running" to its final state; never throws */
    const runNode = async (nodeId: string, node: GraphNode, inputs: ReturnType<typeof collectInputs>, key: string, force: boolean) => {
      const startedAt = new Date().toISOString()
      this.setNode(run, nodeId, { status: 'running', startedAt })
      try {
        const profile = node.data.profileId ? this.store.getProfile(node.data.profileId) : undefined
        // provider polling is already rate-limited; only forward changed messages (never drop the latest one)
        let lastProgress = ''
        const report = (progress: string) => {
          if (progress === lastProgress) return
          lastProgress = progress
          this.setNode(run, nodeId, { status: 'running', startedAt, progress })
        }
        const out = await handlerFor(node.type)({
          node, inputs, profile,
          apiKey: profile ? this.store.getApiKey(profile.id) : undefined,
          assets: this.assets, signal: run.ctrl.signal, chatAdapter: this.chatAdapter, skills: this.skills, graph,
          job: { store: this.store, projectId: run.projectId, nodeId, cacheKey: key, force, report, pollDelays: this.pollDelays },
        })
        outputs.set(nodeId, out)
        this.store.setNodeOutput(run.projectId, nodeId, key, out)
        const versions = this.store.addNodeVersion(run.projectId, nodeId, key, out)
        this.setNode(run, nodeId, { status: 'done', outputs: out, startedAt, finishedAt: new Date().toISOString(), versions })
      } catch (e) {
        failed.add(nodeId)
        if (run.ctrl.signal.aborted) { this.setNode(run, nodeId, { status: 'cancelled' }); return }
        anyError = true
        const known = e instanceof NodeError || e instanceof ProviderError || e instanceof SecretError
        this.setNode(run, nodeId, { status: 'error', error: known ? (e as Error).message : `内部错误：${(e as Error).message}`, startedAt, finishedAt: new Date().toISOString() })
      }
    }

    await new Promise<void>((resolve) => {
      const pump = () => {
        // settle or start everything that is ready; repeat while that makes more nodes ready
        for (let progressed = true; progressed;) {
          progressed = false
          for (const nodeId of order) {
            if (!pending.has(nodeId) || !preds.get(nodeId)!.every((p) => settled.has(p))) continue
            const node = nodeOf.get(nodeId)!
            const settle = (state?: NodeRunState) => { pending.delete(nodeId); settled.add(nodeId); if (state) this.setNode(run, nodeId, state); progressed = true }
            if (run.ctrl.signal.aborted) { failed.add(nodeId); settle({ status: 'cancelled' }); continue }
            if (preds.get(nodeId)!.some((p) => failed.has(p))) { failed.add(nodeId); settle({ status: 'skipped', error: '上游节点未成功' }); continue }

            const inputs = collectInputs(edgesInOrder, nodeId, outputs)
            const key = this.cacheKey(graph, nodeId, inputs)
            const force = !!opts.force && (!targets || targets.has(nodeId))
            const trivial = TRIVIAL.has(node.type)
            if (!trivial && !force) {
              const cached = this.store.getNodeOutput(run.projectId, nodeId)
              if (cached?.cacheKey === key) {
                outputs.set(nodeId, cached.outputs)
                settle({ status: 'cached', outputs: cached.outputs, finishedAt: cached.finishedAt })
                continue
              }
            }
            const limit = trivial ? undefined : this.limitFor(node)
            if (limit && (slots >= this.maxParallel || (busy.get(limit.key) ?? 0) >= limit.max)) continue // waits for a free slot
            pending.delete(nodeId)
            if (limit) { slots++; busy.set(limit.key, (busy.get(limit.key) ?? 0) + 1) }
            inFlight++
            void runNode(nodeId, node, inputs, key, force).then(() => {
              if (limit) { slots--; busy.set(limit.key, busy.get(limit.key)! - 1) }
              inFlight--
              settled.add(nodeId)
              pump()
            })
          }
        }
        if (!pending.size && !inFlight) resolve()
      }
      // stopping: nodes still waiting are marked at once, without waiting for the calls in flight
      run.ctrl.signal.addEventListener('abort', pump, { once: true })
      pump()
    })
    this.finish(run, run.ctrl.signal.aborted ? 'cancelled' : anyError ? 'error' : 'done')
  }

  private finish(run: Run, status: 'done' | 'error' | 'cancelled') {
    this.emit(run, { kind: 'run-end', runId: run.id, status })
    run.finished = true
    run.listeners.clear()
    if (this.active.get(run.projectId) === run.id) this.active.delete(run.projectId)
    // keep finished runs briefly so late subscribers can replay, then drop them
    setTimeout(() => this.runs.delete(run.id), 10 * 60_000).unref?.()
  }
}
