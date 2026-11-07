import {
  ASPECT_RATIOS, NODE_TYPE_MAP, NODE_TYPES, VIDEO_DURATIONS, checkConnection, extractJson,
  type GraphEdge, type ModelKind, type ModelProfile,
} from '@hzc/core'
import type { ChatAdapter } from './providers'

/**
 * Canvas assistant: turns a request ("做一条 5 秒的产品短视频") into a node plan with the user's own
 * text model. The plan is only a proposal — the client shows it and adds it to the canvas when the
 * user approves. Everything the model returns is validated here: known node types, existing ports,
 * type-compatible connections, no cycles, whitelisted parameters, bounded sizes.
 */

export interface PlanNode { key: string; type: string; label?: string; text?: string; params?: Record<string, unknown> }
export interface PlanEdge { from: string; fromPort: string; to: string; toPort: string }
export interface Plan { nodes: PlanNode[]; edges: PlanEdge[] }
export interface AssistantReply { reply: string; plan: Plan | null; warnings: string[] }

export interface CanvasSummary { nodes: { id: string; type: string; label?: string; text?: string }[]; edges: { source: string; sourceHandle?: string; target: string; targetHandle?: string }[] }
export interface ChatTurn { role: 'user' | 'assistant'; content: string }

const MAX_NODES = 16
const KIND_NAME: Record<ModelKind, string> = { llm: '文本模型', vlm: '视觉分析', image: '图片生成', video: '视频生成', tts: '语音合成' }

/** parameters the assistant may set, per node type (anything else is dropped) */
const PARAMS: Record<string, Record<string, (v: unknown, skills: string[]) => unknown>> = {
  'image-gen': { aspect_ratio: (v) => ((ASPECT_RATIOS as readonly string[]).includes(String(v)) ? String(v) : undefined) },
  'video-gen': {
    aspect_ratio: (v) => ((ASPECT_RATIOS as readonly string[]).includes(String(v)) ? String(v) : undefined),
    duration: (v) => ((VIDEO_DURATIONS as readonly number[]).includes(Number(v)) ? Number(v) : undefined),
  },
  director: {
    skill: (v, skills) => (skills.includes(String(v)) ? String(v) : undefined),
    shots: (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= 12 ? n : undefined },
    aspect_ratio: (v) => ((ASPECT_RATIOS as readonly string[]).includes(String(v)) ? String(v) : undefined),
    style: (v) => (typeof v === 'string' ? v.slice(0, 200) : undefined),
    lang: (v) => (v === 'zh' || v === 'en' ? v : undefined),
  },
  'image-reverse': { style: (v) => (['general', 'midjourney', 'sdxl', 'flux', 'video'].includes(String(v)) ? String(v) : undefined), lang: (v) => (v === 'zh' || v === 'en' ? v : undefined) },
  'video-reverse': { maxShots: (v) => { const n = Math.round(Number(v)); return n >= 2 && n <= 16 ? n : undefined }, lang: (v) => (v === 'zh' || v === 'en' ? v : undefined) },
  llm: { system: (v) => (typeof v === 'string' ? v.slice(0, 2000) : undefined) },
  vlm: { instruction: (v) => (typeof v === 'string' ? v.slice(0, 2000) : undefined) },
  export: { fps: (v) => ([24, 25, 30, 60].includes(Number(v)) ? Number(v) : undefined), keepAudio: (v) => (v === 'mix' || v === 'drop' ? v : undefined) },
}
const HAS_TEXT = new Set(['text', 'image-gen', 'video-gen', 'llm', 'tts', 'director'])

function catalog(skills: string[]): string {
  return NODE_TYPES.map((d) => {
    const ins = d.inputs.map((p) => `${p.id}(${p.type}${p.multiple ? '，可多条' : ''})`).join('、') || '无'
    const outs = d.outputs.map((p) => `${p.id}(${p.type})`).join('、') || '无'
    const ps = Object.keys(PARAMS[d.type] ?? {}).join('、')
    return `- ${d.type}｜${d.label}｜${d.description}｜输入 ${ins}｜输出 ${outs}${HAS_TEXT.has(d.type) ? '｜可填 text' : ''}${ps ? `｜params: ${ps}` : ''}`
  }).join('\n') + `\n画面比例 aspect_ratio 可选：${ASPECT_RATIOS.join(' / ')}；视频时长 duration：${VIDEO_DURATIONS.join(' / ')} 秒；导演 skill 可选：${skills.join(' / ') || '（无）'}`
}

function canvasText(c?: CanvasSummary): string {
  if (!c?.nodes.length) return '（画布是空的）'
  const nodes = c.nodes.slice(0, 60).map((n) => `- @${n.id}｜${n.type}｜${n.label ?? NODE_TYPE_MAP[n.type]?.label ?? ''}${n.text ? `｜text: ${n.text.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`)
  const edges = c.edges.slice(0, 80).map((e) => `- @${e.source}.${e.sourceHandle ?? 'out'} → @${e.target}.${e.targetHandle ?? 'in'}`)
  return `节点：\n${nodes.join('\n')}\n连线：\n${edges.join('\n') || '（无）'}`
}

export function assistantSystem(skills: string[], kinds: ModelKind[]): string {
  return [
    '你是 Haizhu Infinity Canvas 的画布助手。用户是图片和视频创作者。你的工作：理解用户想做什么，用下面的节点搭一条能直接运行的工作流，并把提示词写好。',
    '可用节点（type｜名称｜用途｜输入端口｜输出端口）：',
    catalog(skills),
    '端口类型必须匹配：text→text、image→image、video→video、audio→audio；storyboard 可以接到 text；preview 的输入接受任何类型。没有输入端口的节点不能被连入。',
    `用户已配置的模型类型：${kinds.length ? kinds.map((k) => KIND_NAME[k]).join('、') : '无'}。如果方案需要用户还没有的模型，在 reply 里提醒用户到「设置 → 模型档案」添加。`,
    '规则：',
    '1. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释：{"reply": "给用户的简短中文说明（1-3 句）", "plan": {"nodes": [...], "edges": [...]}}',
    '2. nodes 的每一项：{"key": "n1", "type": "节点 type", "label": "简短中文名", "text": "提示词或文本内容（可选）", "params": {…可选…}}。最多 12 个节点。',
    '3. edges 的每一项：{"from": "n1", "fromPort": "out", "to": "n2", "toPort": "prompt"}。from / to 用 key；要连到画布上已有的节点时写 "@节点id"。',
    '4. 图片 / 视频提示词要具体：主体、动作、场景、光线、色彩、镜头与风格。视频生成节点的 text 写运动与运镜。',
    '5. 用户需要上传素材时（参考图、参考视频、产品图），放一个对应的 image / video / audio 输入节点，label 写清楚要上传什么，不要编造文件。',
    '6. 用户只是提问、闲聊或需求不清楚时，plan 设为 null，在 reply 里回答或问一个最关键的问题。',
    '7. 用户要求在当前画布上修改或接着做时，尽量连到已有节点（"@id"），不要重复创建已有的节点。',
  ].join('\n')
}

export function assistantPrompt(history: ChatTurn[], message: string, canvas?: CanvasSummary): string {
  const turns = history.slice(-8).map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.content.slice(0, 2000)}`).join('\n')
  return [`当前画布：\n${canvasText(canvas)}`, turns ? `此前的对话：\n${turns}` : '', `用户的新消息：${message}`].filter(Boolean).join('\n\n')
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)

/** Validate the model's JSON into a safe plan; anything invalid is dropped and explained. */
export function parseAssistant(text: string, canvas: CanvasSummary | undefined, skills: string[]): AssistantReply {
  let raw: unknown
  try { raw = extractJson(text) } catch { return { reply: text.trim().slice(0, 4000) || '（模型没有回复内容）', plan: null, warnings: [] } }
  const o = (raw && typeof raw === 'object' ? raw : {}) as { reply?: unknown; plan?: unknown }
  const reply = s(o.reply, 2000) ?? ''
  const warnings: string[] = []
  const p = o.plan as { nodes?: unknown; edges?: unknown } | null | undefined
  if (!p || typeof p !== 'object' || !Array.isArray(p.nodes) || !p.nodes.length) return { reply: reply || '好的。', plan: null, warnings }

  const nodes: PlanNode[] = []
  const keys = new Set<string>()
  for (const item of p.nodes as unknown[]) {
    if (nodes.length >= MAX_NODES) { warnings.push(`方案超过 ${MAX_NODES} 个节点，多出的已省略`); break }
    const n = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const type = s(n.type, 40) ?? ''
    if (!NODE_TYPE_MAP[type]) { warnings.push(`忽略了未知的节点类型「${type || '空'}」`); continue }
    let key = s(n.key, 40) || `n${nodes.length + 1}`
    while (keys.has(key)) key += '_'
    keys.add(key)
    const params: Record<string, unknown> = {}
    const rules = PARAMS[type] ?? {}
    if (n.params && typeof n.params === 'object') {
      for (const [k, v] of Object.entries(n.params as Record<string, unknown>)) {
        const val = rules[k]?.(v, skills)
        if (val !== undefined) params[k] = val
      }
    }
    nodes.push({ key, type, label: s(n.label, 40), text: HAS_TEXT.has(type) ? s(n.text, 4000) : undefined, params })
  }
  if (!nodes.length) return { reply: reply || '没能生成可用的方案。', plan: null, warnings }

  // connections: checked against existing + planned nodes in order (types, ports, single inputs, cycles)
  const existing = (canvas?.nodes ?? []).map((n) => ({ id: `@${n.id}`, type: n.type }))
  const all = [...existing, ...nodes.map((n) => ({ id: n.key, type: n.type }))]
  const graphEdges: GraphEdge[] = (canvas?.edges ?? []).map((e, i) => ({ id: `x${i}`, source: `@${e.source}`, sourceHandle: e.sourceHandle ?? 'out', target: `@${e.target}`, targetHandle: e.targetHandle ?? 'in' }))
  const edges: PlanEdge[] = []
  for (const item of Array.isArray(p.edges) ? (p.edges as unknown[]).slice(0, 60) : []) {
    const e = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const from = s(e.from, 80) ?? '', to = s(e.to, 80) ?? ''
    const fromDef = NODE_TYPE_MAP[all.find((n) => n.id === from)?.type ?? '']
    const toDef = NODE_TYPE_MAP[all.find((n) => n.id === to)?.type ?? '']
    if (!fromDef || !toDef) { warnings.push(`忽略了一条连到不存在节点的连线（${from || '?'} → ${to || '?'}）`); continue }
    const fromPort = s(e.fromPort, 40) || fromDef.outputs[0]?.id || 'out'
    const toPort = s(e.toPort, 40) || toDef.inputs[0]?.id || 'in'
    const ok = checkConnection(all, graphEdges, { source: from, sourceHandle: fromPort, target: to, targetHandle: toPort })
    if (!ok.ok) { warnings.push(`忽略了一条连线（${from}.${fromPort} → ${to}.${toPort}）：${ok.reason}`); continue }
    graphEdges.push({ id: `p${edges.length}`, source: from, sourceHandle: fromPort, target: to, targetHandle: toPort })
    edges.push({ from, fromPort, to, toPort })
  }
  return { reply: reply || `为你搭了 ${nodes.length} 个节点。`, plan: { nodes, edges }, warnings }
}

export async function runAssistant(o: {
  profile: ModelProfile; apiKey?: string; adapter: ChatAdapter; message: string; history: ChatTurn[]
  canvas?: CanvasSummary; skills: string[]; kinds: ModelKind[]; signal: AbortSignal
}): Promise<AssistantReply> {
  const text = await o.adapter.chat(o.profile, o.apiKey, {
    system: assistantSystem(o.skills, o.kinds),
    prompt: assistantPrompt(o.history, o.message, o.canvas),
    signal: o.signal,
  })
  return parseAssistant(text, o.canvas, o.skills)
}
