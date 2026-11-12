import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import {
  NODE_TYPES, NODE_TYPE_MAP, PROMPT_FAMILY_LABEL, promptFamily, promptGuide,
  type NodeOutputs, type NodeRunState, type PortValue, type ProjectGraph, type RunEvent,
} from '@hzc/core'
import type { Store } from './db'
import { QuotaError, type AssetStore } from './assets'
import type { Engine } from './engine'
import type { SkillStore } from './skills'
import { extractFrame, ffmpegInfo, probe, run as runCmd, withTemp } from './media'
import {
  AGENT_PARAMS, CanvasEditError, TEXT_TYPES, addToGraph, hubFor, removeFromGraph, updateInGraph,
  type EdgeSpec, type NodePatch, type NodeSpec,
} from './agent'

/**
 * Model Context Protocol server: lets an agent (Claude Code, other MCP clients) build and run
 * workflows on the canvas. JSON-RPC 2.0 over Streamable HTTP (POST /mcp, one JSON answer per request,
 * no server-initiated stream); the desktop app's stdio bridge forwards to the same endpoint.
 *
 * Everything goes through the same store and engine as the page, and every change is announced to
 * open pages, which merge it into what is on screen. Paid generation only starts after the agent has
 * seen the estimate and confirms it (`confirm_cost`), so it can tell the person first.
 */

export const MCP_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const
export const MCP_SERVER_NAME = 'haizhu-infinity-canvas'

export interface McpContext {
  store: Store
  assets: AssetStore
  engine: Engine
  skills: SkillStore
  version: string
  /** the server runs on this machine for one person: tools may read local files and return file paths */
  localFiles: boolean
}

type Json = Record<string, unknown>
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
interface ToolResult { content: Content[]; isError?: boolean }
interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Json
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  run: (args: Json, ctx: McpContext) => Promise<ToolResult | Json>
}

class ToolError extends Error {}

export const MCP_INSTRUCTIONS = [
  'Haizhu Infinity Canvas (海柱无限画布) is a node canvas for image and video creation. The person sees the canvas live in the app while you work, and may be editing it at the same time.',
  'Workflow: list_projects / create_project → get_canvas → list_models and list_node_types → add_nodes (nodes and their wires in one call) → estimate → run → wait_for_run → get_results / view_asset → refine with update_node and run again. Unchanged nodes are cached; only what changed runs again.',
  'Money: image / video / speech generation calls the person\'s own paid model accounts. run refuses paid work until you pass confirm_cost: true; tell the person what the estimate says before you do. Keep count at 1 unless asked for variations.',
  'Prompts: before writing an image or video prompt call prompt_guide for the target node or model and follow its rules. With a first frame wired in, describe only motion and camera.',
  'Wiring: text → a generation node\'s prompt port; images → ref (references) or first / last (video frames); a director node turns an idea into a storyboard; a subject node (params.name, text = description, params.images = asset ids) can be referenced as @name in any prompt.',
  'Files: upload_asset brings a picture, video or audio in (optionally as an input node). Results are assets: view_asset shows images (and frames of videos) to you.',
  'Node ids look like n_xxxx; in add_nodes, refer to nodes created in the same call by your own keys and to existing nodes by id.',
].join('\n')

// ---------------------------------------------------------------- helpers

const s = (v: unknown) => (typeof v === 'string' ? v : undefined)
const need = (args: Json, key: string): string => {
  const v = s(args[key])?.trim()
  if (!v) throw new ToolError(`缺少参数 ${key}`)
  return v
}
const ids = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 600) : undefined)
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…（共 ${t.length} 字）` : t)

function project(ctx: McpContext, args: Json) {
  const id = need(args, 'project_id')
  const p = ctx.store.getProject(id)
  if (!p) throw new ToolError(`没有画布 ${id}（用 list_projects 查看）`)
  return p
}

/** save a changed canvas and tell open pages */
function saveGraph(ctx: McpContext, projectId: string, graph: ProjectGraph) {
  const p = ctx.store.saveProject(projectId, { graph })!
  hubFor(ctx.store).emit({ kind: 'project', projectId, rev: p.updatedAt, source: 'agent' })
  return p
}

function valueSummary(v: PortValue, ctx: McpContext, full: boolean): Json {
  switch (v.type) {
    case 'text': return { type: 'text', text: full ? clip(v.text, 20000) : clip(v.text, 300) }
    case 'storyboard': return full ? { type: 'storyboard', title: v.title, shots: v.shots } : { type: 'storyboard', title: v.title, shots: v.shots.length }
    default: {
      const out: Json = { type: v.type, asset_id: v.assetId, mime: v.mime }
      if ('name' in v && v.name) out.name = v.name
      if (full && ctx.localFiles) { const a = ctx.assets.get(v.assetId); if (a) out.path = a.file }
      return out
    }
  }
}

function outputsSummary(o: NodeOutputs, ctx: McpContext, full: boolean): Json {
  const out: Json = {}
  for (const [port, vals] of Object.entries(o)) if (Array.isArray(vals) && vals.length) out[port] = vals.map((v) => valueSummary(v, ctx, full))
  return out
}

/** node states of a run, folded from its events */
function runStates(events: RunEvent[]): Map<string, NodeRunState> {
  const m = new Map<string, NodeRunState>()
  for (const e of events) if (e.kind === 'node') m.set(e.nodeId, e.state)
  return m
}

async function waitRun(ctx: McpContext, runId: string, timeoutMs: number): Promise<Json> {
  const info = ctx.engine.runInfo(runId)
  if (!info) return { run_id: runId, status: 'unknown', note: '找不到这次运行（服务重启过，或运行结束超过 10 分钟）。用 get_results 查看结果。' }
  if (!info.finished && timeoutMs > 0) {
    await new Promise<void>((resolve) => {
      let un: (() => void) | undefined
      const timer = setTimeout(() => { un?.(); resolve() }, timeoutMs)
      un = ctx.engine.subscribe(runId, (e) => { if (e.kind === 'run-end') { clearTimeout(timer); queueMicrotask(() => un?.()); resolve() } })
    })
  }
  const now = ctx.engine.runInfo(runId)!
  const end = now.events.find((e): e is Extract<RunEvent, { kind: 'run-end' }> => e.kind === 'run-end')
  const graph = ctx.store.getProject(now.projectId)?.graph
  const states = runStates(now.events)
  const nodes = [...states.entries()].map(([id, st]) => {
    const n = graph?.nodes.find((x) => x.id === id)
    const row: Json = { node_id: id, label: n?.data.label ?? n?.type, status: st.status }
    if (st.error) row.error = st.error
    if (st.progress && st.status === 'running') row.progress = st.progress
    if (st.outputs && (st.status === 'done' || st.status === 'cached')) row.result = outputsSummary(st.outputs, ctx, false)
    return row
  })
  const status = end ? end.status : 'running'
  return {
    run_id: runId, project_id: now.projectId, status, nodes,
    hint: status === 'running' ? '还在运行：稍后再调用 wait_for_run。' : status === 'done' ? '用 get_results 看完整结果，view_asset 看图片 / 视频。' : undefined,
  }
}

const IMAGE_SEND = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const EXT_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac', '.opus': 'audio/opus',
}

/** an image small enough to hand to the agent (scaled down with FFmpeg when needed) */
async function imageForAgent(ctx: McpContext, file: string, mime: string): Promise<Content> {
  const size = statSync(file).size
  if (IMAGE_SEND.has(mime) && size <= 3.5 * 1024 * 1024) return { type: 'image', data: readFileSync(file).toString('base64'), mimeType: mime }
  const f = await ffmpegInfo()
  if (!f.ok) throw new ToolError(`图片太大（${Math.round(size / 1024 / 1024)} MB），缩小需要 FFmpeg，本机没有找到`)
  return withTemp(ctx.assets.dataDir, async (dir) => {
    const out = join(dir, 'view.jpg')
    const r = await runCmd(f.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-frames:v', '1', '-vf', "scale='min(1568,iw)':-2", '-q:v', '3', out], { timeoutMs: 60_000 })
    if (r.code !== 0) throw new ToolError('缩小图片失败')
    return { type: 'image', data: readFileSync(out).toString('base64'), mimeType: 'image/jpeg' }
  })
}

// ---------------------------------------------------------------- tools

const projectId = { type: 'string', description: 'canvas id (from list_projects)' }
const nodeIdsSchema = { type: 'array', items: { type: 'string' }, description: 'only these nodes (and what they need); default: the whole canvas' }

const TOOLS: Tool[] = [
  {
    name: 'list_projects', title: '列出画布', annotations: { readOnlyHint: true },
    description: 'List the canvases (projects), newest first, with their node counts.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_a, ctx) => ({ projects: ctx.store.listProjects().map((p) => ({ id: p.id, name: p.name, nodes: p.nodeCount, updated_at: p.updatedAt })) }),
  },
  {
    name: 'create_project', title: '新建画布',
    description: 'Create an empty canvas and return its id.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    run: async (a, ctx) => {
      const p = ctx.store.createProject((s(a.name)?.trim() || '未命名画布').slice(0, 100))
      hubFor(ctx.store).emit({ kind: 'projects' })
      return { project_id: p.id, name: p.name }
    },
  },
  {
    name: 'get_canvas', title: '读取画布', annotations: { readOnlyHint: true },
    description: 'Everything on a canvas: nodes (type, label, text, params, model, current result in short) and wires. Read it before changing a canvas.',
    inputSchema: { type: 'object', properties: { project_id: projectId }, required: ['project_id'] },
    run: async (a, ctx) => {
      const p = project(ctx, a)
      const outs = new Map(ctx.store.listNodeOutputs(p.id).map((o) => [o.nodeId, o]))
      const runId = ctx.engine.activeRun(p.id)
      const live = runId ? runStates(ctx.engine.runInfo(runId)?.events ?? []) : undefined
      const profiles = new Map(ctx.store.listProfiles().map((x) => [x.id, x]))
      return {
        project: { id: p.id, name: p.name, updated_at: p.updatedAt },
        running: runId ?? null,
        nodes: p.graph.nodes.map((n) => {
          const row: Json = { id: n.id, type: n.type, label: n.data.label ?? NODE_TYPE_MAP[n.type]?.label, position: n.position }
          if (n.data.text) row.text = clip(n.data.text, 600)
          if (n.data.params && Object.keys(n.data.params).length) row.params = n.data.params
          if (n.data.profileId) { const pr = profiles.get(n.data.profileId); row.model = pr ? { id: pr.id, name: pr.name, model: pr.model } : { id: n.data.profileId, missing: true } }
          else if (NODE_TYPE_MAP[n.type]?.modelKind) row.model = null
          if (n.data.assetId) row.asset = { asset_id: n.data.assetId, mime: n.data.mime }
          const o = outs.get(n.id)
          if (o) row.result = { ...outputsSummary(o.outputs as NodeOutputs, ctx, false), versions: o.versions }
          const st = live?.get(n.id)
          if (st) row.run = { status: st.status, ...(st.error ? { error: st.error } : {}) }
          return row
        }),
        edges: p.graph.edges.map((e) => ({ from: e.source, from_port: e.sourceHandle, to: e.target, to_port: e.targetHandle })),
      }
    },
  },
  {
    name: 'list_node_types', title: '节点类型', annotations: { readOnlyHint: true },
    description: 'The node types you can add: their input and output ports (with data types), whether they take text, and the params they accept.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => ({
      ports: 'A wire goes from an output port to an input port of the same data type (text→text, image→image, video→video, audio→audio); storyboard also connects to text; preview accepts anything. An input without "multiple" takes one wire.',
      types: NODE_TYPES.map((d) => ({
        type: d.type, label: d.label, description: d.description, category: d.category,
        ...(d.modelKind ? { model_kind: d.modelKind } : {}),
        inputs: d.inputs.map((p) => ({ id: p.id, type: p.type, label: p.label, ...(p.multiple ? { multiple: true } : {}) })),
        outputs: d.outputs.map((p) => ({ id: p.id, type: p.type, label: p.label })),
        text: TEXT_TYPES.has(d.type),
        params: Object.fromEntries(Object.entries(AGENT_PARAMS[d.type] ?? {}).map(([k, v]) => [k, v.hint])),
      })),
    }),
  },
  {
    name: 'list_models', title: '模型与 Skill', annotations: { readOnlyHint: true },
    description: 'The person\'s model profiles (which model a node uses; API keys are never shown) with their per-call price if set, and the imported skills.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_a, ctx) => ({
      models: ctx.store.listProfiles().map((p) => ({ id: p.id, name: p.name, kind: p.kind, adapter: p.adapter, model: p.model, ...(p.cost ? { price_per_call: p.cost } : {}) })),
      skills: ctx.skills.list().map((x) => ({ name: x.name, label: x.label, kind: x.kind })),
      kinds: 'llm → text / director nodes; vlm → vision, image-reverse, video-reverse; image → image-gen; video → video-gen; tts → tts',
    }),
  },
  {
    name: 'add_nodes', title: '添加节点',
    description: 'Add nodes and wires to a canvas in one step; also wires between existing nodes (nodes: []). New nodes are laid out to the right of the canvas. Generation nodes get the first model of their kind unless you give `model` (profile id or name).',
    inputSchema: {
      type: 'object', required: ['project_id', 'nodes'],
      properties: {
        project_id: projectId,
        nodes: {
          type: 'array', description: 'nodes to create',
          items: {
            type: 'object', required: ['type'],
            properties: {
              key: { type: 'string', description: 'your name for this node, used by edges in this call' },
              type: { type: 'string', description: 'a node type from list_node_types' },
              label: { type: 'string' },
              text: { type: 'string', description: 'prompt / script / notes / subject description' },
              params: { type: 'object', description: 'node params (see list_node_types)' },
              model: { type: 'string', description: 'model profile id or name' },
              asset_id: { type: 'string', description: 'image / video / audio input nodes: the uploaded asset' },
            },
          },
        },
        edges: {
          type: 'array', description: 'wires; from / to = a key from this call or an existing node id',
          items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, from_port: { type: 'string' }, to: { type: 'string' }, to_port: { type: 'string' } } },
        },
      },
    },
    run: async (a, ctx) => {
      const p = project(ctx, a)
      const r = addToGraph(ctx, p.graph, Array.isArray(a.nodes) ? (a.nodes as NodeSpec[]) : [], Array.isArray(a.edges) ? (a.edges as EdgeSpec[]) : [])
      saveGraph(ctx, p.id, r.graph)
      return { created: r.created, edges_added: r.edges, ...(r.warnings.length ? { warnings: r.warnings } : {}) }
    },
  },
  {
    name: 'update_node', title: '修改节点',
    description: 'Change a node: label, text (prompt), params (merged; null removes one), model, asset (input nodes) or position.',
    inputSchema: {
      type: 'object', required: ['project_id', 'node_id'],
      properties: {
        project_id: projectId, node_id: { type: 'string' }, label: { type: 'string' }, text: { type: 'string' },
        params: { type: 'object' }, model: { type: 'string', description: 'model profile id or name' }, asset_id: { type: 'string' },
        position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
      },
    },
    run: async (a, ctx) => {
      const p = project(ctx, a)
      const r = updateInGraph(ctx, p.graph, need(a, 'node_id'), a as NodePatch)
      saveGraph(ctx, p.id, r.graph)
      return { ok: true, ...(r.warnings.length ? { warnings: r.warnings } : {}) }
    },
  },
  {
    name: 'remove', title: '删除节点或连线', annotations: { destructiveHint: true },
    description: 'Delete nodes (with their wires) and / or single wires from a canvas.',
    inputSchema: {
      type: 'object', required: ['project_id'],
      properties: {
        project_id: projectId, node_ids: { type: 'array', items: { type: 'string' } },
        edges: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, from_port: { type: 'string' }, to: { type: 'string' }, to_port: { type: 'string' } } } },
      },
    },
    run: async (a, ctx) => {
      const p = project(ctx, a)
      if (ctx.engine.isRunning(p.id)) throw new ToolError('画布正在运行，等运行结束（wait_for_run）后再删除')
      const r = removeFromGraph(p.graph, ids(a.node_ids) ?? [], Array.isArray(a.edges) ? (a.edges as EdgeSpec[]) : [])
      saveGraph(ctx, p.id, r.graph)
      return { removed_nodes: r.nodes, removed_edges: r.edges }
    },
  },
  {
    name: 'upload_asset', title: '上传素材',
    description: 'Bring a picture, video or audio file in, from a local file path (this machine) or base64 data. With project_id it is also added as an input node (or as a subject picture with subject_node_id).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'absolute path of a local file (desktop / local server only)' },
        data_base64: { type: 'string' }, mime: { type: 'string', description: 'with data_base64, e.g. image/png' },
        name: { type: 'string' }, project_id: { type: 'string', description: 'also add an input node to this canvas' },
      },
    },
    run: async (a, ctx) => {
      let bytes: Buffer, mime: string, name: string
      const path = s(a.path)
      if (path) {
        if (!ctx.localFiles) throw new ToolError('这个服务不在你的电脑上：请用 data_base64 上传')
        if (!isAbsolute(path) || !existsSync(path)) throw new ToolError(`找不到文件 ${path}（需要绝对路径）`)
        const st = statSync(path)
        if (!st.isFile()) throw new ToolError(`${path} 不是文件`)
        if (st.size > 512 * 1024 * 1024) throw new ToolError('文件超过 512 MB')
        mime = EXT_MIME[extname(path).toLowerCase()] ?? ''
        if (!mime) throw new ToolError(`不支持的文件类型 ${extname(path)}（支持 ${Object.keys(EXT_MIME).join(' ')}）`)
        bytes = readFileSync(path)
        name = path.split(/[\\/]/).pop()!
      } else {
        const b64 = s(a.data_base64)
        mime = (s(a.mime) ?? '').toLowerCase()
        if (!b64 || !/^(image|video|audio)\//.test(mime)) throw new ToolError('需要 path，或 data_base64 + mime（image/… video/… audio/…）')
        bytes = Buffer.from(b64, 'base64')
        if (!bytes.length) throw new ToolError('data_base64 是空的')
        name = s(a.name) ?? 'upload'
      }
      let meta
      try { meta = ctx.assets.put(bytes, mime, (s(a.name) ?? name).slice(0, 200)) } catch (e) {
        if (e instanceof QuotaError) throw new ToolError(e.message)
        throw new ToolError(`无法保存这个文件：${(e as Error).message}`)
      }
      const out: Json = { asset_id: meta.id, mime: meta.mime, size: meta.size }
      if (s(a.project_id)) {
        const p = project(ctx, a)
        const type = meta.mime.split('/')[0]!
        const r = addToGraph(ctx, p.graph, [{ key: 'file', type, label: name.slice(0, 40), asset_id: meta.id }], [])
        saveGraph(ctx, p.id, r.graph)
        out.node_id = r.created.file
      }
      return out
    },
  },
  {
    name: 'estimate', title: '预估费用', annotations: { readOnlyHint: true },
    description: 'What a run would do without starting it: which nodes call a model (and which are reused from cache), and the total of the person\'s per-call prices.',
    inputSchema: { type: 'object', required: ['project_id'], properties: { project_id: projectId, node_ids: nodeIdsSchema, force: { type: 'boolean', description: 'ignore cached results of the target nodes' } } },
    run: async (a, ctx) => {
      const p = project(ctx, a)
      const e = ctx.engine.estimate(p.id, p.graph, { nodeIds: ids(a.node_ids), force: a.force === true })
      return estimateSummary(e)
    },
  },
  {
    name: 'run', title: '运行',
    description: 'Run a canvas (or some nodes and what they need). Paid generation needs confirm_cost: true — call estimate first and tell the person the cost. Returns a run id at once, or waits up to wait_seconds for the result.',
    inputSchema: {
      type: 'object', required: ['project_id'],
      properties: {
        project_id: projectId, node_ids: nodeIdsSchema,
        force: { type: 'boolean', description: 'generate again even if the inputs did not change' },
        confirm_cost: { type: 'boolean', description: 'the person agreed to the paid calls in the estimate' },
        wait_seconds: { type: 'number', description: '0–600: wait for the run to finish (default 0)' },
      },
    },
    run: async (a, ctx) => {
      const p = project(ctx, a)
      if (ctx.engine.isRunning(p.id)) throw new ToolError(`这个画布正在运行（run_id ${ctx.engine.activeRun(p.id)}）：用 wait_for_run 等它结束，或 cancel_run`)
      const nodeIds = ids(a.node_ids)
      const unknown = nodeIds?.filter((id) => !p.graph.nodes.some((n) => n.id === id))
      if (unknown?.length) throw new ToolError(`画布上没有节点 ${unknown.join(', ')}`)
      const est = ctx.engine.estimate(p.id, p.graph, { nodeIds, force: a.force === true })
      const paid = est.items.filter((i) => !i.cached && (i.generative || (i.cost?.amount ?? 0) > 0))
      if (paid.length && a.confirm_cost !== true) {
        return { started: false, needs_confirmation: true, ...estimateSummary(est), hint: '这次运行会调用付费模型。把预估告诉用户，得到同意后带 confirm_cost: true 再调用 run。' }
      }
      const runId = ctx.engine.start(p.id, p.graph, { nodeIds, force: a.force === true })
      hubFor(ctx.store).emit({ kind: 'run', projectId: p.id, runId, source: 'agent' })
      const wait = Math.min(600, Math.max(0, Number(a.wait_seconds) || 0))
      if (!wait) return { started: true, run_id: runId, hint: '用 wait_for_run 等待结果。' }
      return { started: true, ...(await waitRun(ctx, runId, wait * 1000)) }
    },
  },
  {
    name: 'wait_for_run', title: '等待运行', annotations: { readOnlyHint: true },
    description: 'Wait until a run finishes (or timeout_seconds pass) and report each node\'s status, errors and short results.',
    inputSchema: { type: 'object', required: ['run_id'], properties: { run_id: { type: 'string' }, timeout_seconds: { type: 'number', description: '0–600, default 120' } } },
    run: async (a, ctx) => waitRun(ctx, need(a, 'run_id'), Math.min(600, Math.max(0, a.timeout_seconds === undefined ? 120 : Number(a.timeout_seconds) || 0)) * 1000),
  },
  {
    name: 'cancel_run', title: '停止运行',
    description: 'Stop a run. Remote jobs that already started may still finish on the provider\'s side.',
    inputSchema: { type: 'object', required: ['run_id'], properties: { run_id: { type: 'string' } } },
    run: async (a, ctx) => ({ cancelled: ctx.engine.cancel(need(a, 'run_id')) }),
  },
  {
    name: 'get_results', title: '读取结果', annotations: { readOnlyHint: true },
    description: 'The current results of nodes: full text, storyboards (all shots), and media as asset ids (with a local file path when the canvas runs on this machine).',
    inputSchema: { type: 'object', required: ['project_id'], properties: { project_id: projectId, node_ids: { type: 'array', items: { type: 'string' }, description: 'default: every node with a result' } } },
    run: async (a, ctx) => {
      const p = project(ctx, a)
      const want = ids(a.node_ids)
      const rows = ctx.store.listNodeOutputs(p.id).filter((o) => !want || want.includes(o.nodeId))
      return {
        results: rows.map((o) => {
          const n = p.graph.nodes.find((x) => x.id === o.nodeId)
          return { node_id: o.nodeId, label: n?.data.label ?? n?.type, type: n?.type, finished_at: o.finishedAt, versions: o.versions, outputs: outputsSummary(o.outputs as NodeOutputs, ctx, true) }
        }).filter((r) => r.type),
      }
    },
  },
  {
    name: 'view_asset', title: '查看素材', annotations: { readOnlyHint: true },
    description: 'Look at an asset: an image is returned as an image; a video as three frames (start, middle, end) plus its length; audio as its length.',
    inputSchema: { type: 'object', required: ['asset_id'], properties: { asset_id: { type: 'string' } } },
    run: async (a, ctx) => {
      const asset = ctx.assets.get(need(a, 'asset_id'))
      if (!asset) throw new ToolError('找不到这个素材')
      const head: Content = { type: 'text', text: JSON.stringify({ asset_id: asset.id, mime: asset.mime, size: asset.size, ...(ctx.localFiles ? { path: asset.file } : {}) }) }
      if (asset.mime.startsWith('image/')) return { content: [head, await imageForAgent(ctx, asset.file, asset.mime)] }
      const f = await ffmpegInfo()
      if (!f.ok) return { content: [head, { type: 'text', text: '没有 FFmpeg，无法读取视频 / 音频的内容' }] }
      const info = await probe(asset.file)
      const meta: Content = { type: 'text', text: JSON.stringify({ duration_seconds: Math.round(info.duration * 10) / 10, width: info.width, height: info.height, has_audio: info.hasAudio }) }
      if (!asset.mime.startsWith('video/')) return { content: [head, meta] }
      const frames = await withTemp(ctx.assets.dataDir, async (dir) => {
        const out: Content[] = []
        for (const [i, t] of [0.05, 0.5, 0.95].entries()) {
          const file = join(dir, `f${i}.jpg`)
          try { await extractFrame(asset.file, Math.max(0, info.duration * t), file, 768); out.push({ type: 'image', data: readFileSync(file).toString('base64'), mimeType: 'image/jpeg' }) } catch { /* a frame that can't be read is skipped */ }
        }
        return out
      })
      return { content: [head, meta, ...frames] }
    },
  },
  {
    name: 'pick_result', title: '选用结果',
    description: 'A node that made several results (count > 1): keep result number `index` (0-based) as the one that flows downstream. All stay in the node\'s versions.',
    inputSchema: { type: 'object', required: ['project_id', 'node_id', 'index'], properties: { project_id: projectId, node_id: { type: 'string' }, index: { type: 'number' } } },
    run: async (a, ctx) => {
      const p = project(ctx, a)
      if (ctx.engine.isRunning(p.id)) throw new ToolError('画布正在运行，等运行结束后再选用')
      const nodeId = need(a, 'node_id')
      const cur = ctx.store.getNodeOutput(p.id, nodeId)
      const list = (cur?.outputs as Record<string, unknown[]> | undefined)?.out
      const index = Number(a.index)
      if (!cur || !Array.isArray(list) || !Number.isInteger(index) || index < 0 || index >= list.length) throw new ToolError('没有这个结果')
      const outputs = { ...(cur.outputs as Record<string, unknown[]>), out: [list[index]] }
      ctx.store.setNodeOutput(p.id, nodeId, cur.cacheKey, outputs)
      ctx.store.addNodeVersion(p.id, nodeId, cur.cacheKey, outputs)
      hubFor(ctx.store).emit({ kind: 'outputs', projectId: p.id, nodeIds: [nodeId] })
      return { ok: true }
    },
  },
  {
    name: 'prompt_guide', title: '提示词写法', annotations: { readOnlyHint: true },
    description: 'How to write a prompt for a specific image / video model (the same rules the app\'s prompt optimiser uses). Give a generation node, or a model profile.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, node_id: { type: 'string' }, model: { type: 'string', description: 'model profile id or name' } } },
    run: async (a, ctx) => {
      let type = 'image-gen', model: unknown = a.model
      if (s(a.node_id)) {
        const p = project(ctx, a)
        const n = p.graph.nodes.find((x) => x.id === a.node_id)
        if (!n) throw new ToolError(`画布上没有节点 ${String(a.node_id)}`)
        if (n.type !== 'image-gen' && n.type !== 'video-gen') throw new ToolError('只有图片 / 视频生成节点有提示词写法')
        type = n.type
        model = n.data.profileId ?? model
      }
      const profile = model ? ctx.store.listProfiles().find((x) => x.id === model || x.name.toLowerCase() === String(model).toLowerCase()) : undefined
      if (profile && profile.kind !== 'image' && profile.kind !== 'video') throw new ToolError(`「${profile.name}」不是图片或视频模型`)
      const kind = profile?.kind === 'video' || type === 'video-gen' ? 'video' : 'image'
      const family = promptFamily({ kind, adapter: profile?.adapter, model: profile?.model })
      return {
        family, label: PROMPT_FAMILY_LABEL[family], ...(profile ? { model: profile.model } : {}),
        rules: promptGuide(family),
        also: [
          'Keep the person\'s intent: subjects, names, counts, quoted text and numbers stay as they are.',
          kind === 'video' ? 'With a first frame wired in, describe only what moves and how the camera moves.' : 'Text that must appear in the picture goes in quotes.',
          'A subject node is referenced as @name; its description is added to the prompt automatically.',
        ],
      }
    },
  },
]

function estimateSummary(e: ReturnType<Engine['estimate']>) {
  const calls = e.items.filter((i) => !i.cached)
  return {
    calls: calls.map((i) => ({ node_id: i.nodeId, label: i.label, model: i.profileName, paid: i.generative || (i.cost?.amount ?? 0) > 0, count: i.count, ...(i.cost ? { cost: i.cost } : {}) })),
    cached: e.items.filter((i) => i.cached).length,
    totals: e.totals,
    ...(e.unpriced ? { unpriced: e.unpriced, note: `${e.unpriced} 个调用没有设置单价（在模型档案里设置后才能算出总价）` } : {}),
  }
}

export const MCP_TOOL_NAMES = TOOLS.map((t) => t.name)

// ---------------------------------------------------------------- JSON-RPC

interface RpcRequest { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result })

/** One JSON-RPC message → its answer (null for notifications and answers from the client). */
export async function handleMcpMessage(msg: unknown, ctx: McpContext): Promise<unknown | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return rpcError(null, -32600, 'Invalid Request')
  const m = msg as RpcRequest
  const isRequest = m.id !== undefined && m.id !== null
  if (typeof m.method !== 'string') return isRequest ? rpcError(m.id, -32600, 'Invalid Request') : null // a response to us: ignore
  if (!isRequest) return null // notifications (initialized, cancelled, …) need no answer
  const params = (m.params && typeof m.params === 'object' ? m.params : {}) as Json
  switch (m.method) {
    case 'initialize': {
      const asked = s(params.protocolVersion)
      const protocolVersion = asked && (MCP_PROTOCOLS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOLS[0]
      return ok(m.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, title: 'Haizhu Infinity Canvas', version: ctx.version },
        instructions: MCP_INSTRUCTIONS,
      })
    }
    case 'ping': return ok(m.id, {})
    case 'tools/list':
      return ok(m.id, { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, ...(t.annotations ? { annotations: t.annotations } : {}) })) })
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name)
      if (!tool) return rpcError(m.id, -32602, `Unknown tool: ${String(params.name)}`)
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Json
      try {
        const r = await tool.run(args, ctx)
        if (Array.isArray((r as ToolResult).content)) return ok(m.id, r)
        return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(r) }] })
      } catch (e) {
        // what the agent can fix is a tool error it reads; anything else is logged here and summarised
        if (e instanceof ToolError || e instanceof CanvasEditError) return ok(m.id, { content: [{ type: 'text', text: e.message }], isError: true })
        console.error(`[hzc] mcp tool ${tool.name} failed:`, e)
        return ok(m.id, { content: [{ type: 'text', text: `出错了：${(e as Error).message}` }], isError: true })
      }
    }
    case 'resources/list': return ok(m.id, { resources: [] })
    case 'prompts/list': return ok(m.id, { prompts: [] })
    default: return rpcError(m.id, -32601, `Method not found: ${m.method}`)
  }
}

