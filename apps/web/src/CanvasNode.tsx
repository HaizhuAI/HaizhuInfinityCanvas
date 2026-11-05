import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  Ban, Check, ChevronRight, CircleCheck, CircleExclamationPoint, Clock, Copy, Info, LayoutGrid, Play, RefreshCw, TriangleExclamationPoint, Upload,
} from 'lucide-react'
import {
  ASPECT_RATIOS, NODE_TYPE_MAP, REVERSE_LANGS, REVERSE_STYLES, REVERSE_STYLE_LABEL, VIDEO_DURATIONS,
  type NodeStatus, type PortValue, type Shot,
} from '@hzc/core'
import { api, assetUrl } from './api'
import { CATEGORY_COLOR, KIND_LABEL, NODE_ICON, PORT_COLOR, PORT_LABEL } from './icons'
import { enterNode, successPulse } from './motion'
import { useStore, type CanvasNode } from './store'

const STATUS: Record<NodeStatus, { label: string; Icon?: typeof Check }> = {
  idle: { label: '' },
  queued: { label: '排队中', Icon: Clock },
  running: { label: '运行中' },
  done: { label: '完成', Icon: CircleCheck },
  cached: { label: '复用缓存', Icon: CircleCheck },
  error: { label: '失败', Icon: CircleExclamationPoint },
  skipped: { label: '已跳过', Icon: Ban },
  cancelled: { label: '已停止', Icon: Ban },
}

const MEDIA_ACCEPT: Record<string, string> = { image: 'image/png,image/jpeg,image/webp,image/gif', video: 'video/mp4,video/webm,video/quicktime', audio: 'audio/*' }
const MEDIA_LABEL: Record<string, string> = { image: '图片', video: '视频', audio: '音频' }
const RUNNABLE = new Set(['llm', 'vlm', 'image-gen', 'video-gen', 'tts', 'image-reverse', 'video-reverse', 'director', 'preview', 'export'])
const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5]

function Media({ v }: { v: Extract<PortValue, { assetId: string }> }) {
  const url = assetUrl(v.assetId)
  if (v.type === 'image') return <img className="media" src={url} alt="" draggable={false} />
  if (v.type === 'video') return <video className="media nodrag" src={url} controls preload="metadata" />
  return <audio className="nodrag" style={{ width: '100%' }} src={url} controls preload="metadata" data-testid="out-audio" />
}

function TextOut({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="out-text">
      <pre className="nodrag nowheel" data-testid="out-text">{text || '（空）'}</pre>
      <button className="btn sm icon ghost copy nodrag" title={copied ? '已复制' : '复制'} aria-label="复制"
        onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
        {copied ? <Check /> : <Copy />}
      </button>
    </div>
  )
}

function ShotList({ title, shots }: { title?: string; shots: Shot[] }) {
  return (
    <div className="shots nodrag nowheel" data-testid="shot-list">
      {title && <div className="sb-title">《{title}》</div>}
      {shots.map((s) => (
        <div className="shot" key={s.index}>
          <span className="no">{s.index}</span>
          <div>
            <div className="t">{s.title}<span>{s.duration}s</span></div>
            {s.visual && <div className="v">{s.visual}</div>}
            {s.camera && <div className="c">{s.camera}</div>}
            {s.dialogue && <div className="d">{s.dialogue}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function Values({ vals }: { vals: PortValue[] }) {
  return (
    <>
      {vals.map((v, i) =>
        v.type === 'text' ? <TextOut key={i} text={v.text} />
          : v.type === 'storyboard' ? <ShotList key={i} title={v.title} shots={v.shots} />
            : <Media key={i} v={v} />)}
    </>
  )
}

function MediaInput({ id, kind, assetId, mime }: { id: string; kind: 'image' | 'video' | 'audio'; assetId?: string; mime?: string }) {
  const setNodeData = useStore((s) => s.setNodeData)
  const showToast = useStore((s) => s.showToast)
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  async function onFile(f: File | undefined) {
    if (!f) return
    setBusy(true)
    try {
      const a = await api.uploadAsset(f)
      setNodeData(id, { assetId: a.id, mime: a.mime, label: f.name })
    } catch (e) { showToast(`上传失败：${(e as Error).message}`) } finally { setBusy(false) }
  }
  return (
    <div className="node-section">
      <input ref={ref} type="file" accept={MEDIA_ACCEPT[kind]} hidden data-testid={`upload-${kind}`} onChange={(e) => void onFile(e.target.files?.[0])} />
      {assetId && mime ? (
        <>
          <Media v={{ type: kind, assetId, mime }} />
          <button className="btn sm nodrag" disabled={busy} onClick={() => ref.current?.click()}><Upload />{busy ? '上传中…' : `更换${MEDIA_LABEL[kind]}`}</button>
        </>
      ) : (
        <div className="dropzone nodrag" role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={(e) => e.key === 'Enter' && ref.current?.click()}>
          {busy ? <span className="orbit" /> : <Upload />}
          <span>{busy ? '上传中…' : `点击上传${MEDIA_LABEL[kind]}`}</span>
        </div>
      )}
    </div>
  )
}

/** Prompt box that steps aside when an upstream edge supplies the text. */
function OwnText({ id, port, text, placeholder, testid }: { id: string; port: string; text?: string; placeholder: string; testid: string }) {
  const setNodeData = useStore((s) => s.setNodeData)
  const wired = useStore((s) => s.edges.some((e) => e.target === id && e.targetHandle === port))
  if (wired) return <div className="hint"><Info />内容来自上游连线</div>
  return <textarea className="nodrag nowheel" placeholder={placeholder} value={text ?? ''} onChange={(e) => setNodeData(id, { text: e.target.value })} data-testid={testid} />
}

function JsonExtra({ id, params }: { id: string; params: Record<string, unknown> }) {
  const setNodeParam = useStore((s) => s.setNodeParam)
  const extra = typeof params.extra === 'string' ? params.extra : params.extra ? JSON.stringify(params.extra) : ''
  let ok = true
  if (extra.trim()) { try { const v = JSON.parse(extra); ok = typeof v === 'object' && v !== null && !Array.isArray(v) } catch { ok = false } }
  return (
    <details className="adv nodrag">
      <summary><ChevronRight />高级参数（JSON，按模型文档填写）</summary>
      <textarea className="nodrag nowheel mono" spellCheck={false} placeholder={'{"seed": 42}'} value={extra} onChange={(e) => setNodeParam(id, 'extra', e.target.value)} />
      {!ok && <div className="warn"><TriangleExclamationPoint />不是合法的 JSON 对象</div>}
    </details>
  )
}

function GenControls({ id, type, text, params }: { id: string; type: 'image-gen' | 'video-gen'; text?: string; params: Record<string, unknown> }) {
  const setNodeParam = useStore((s) => s.setNodeParam)
  return (
    <div className="node-section">
      <OwnText id={id} port="prompt" text={text} testid="gen-prompt" placeholder={type === 'video-gen' ? '描述画面、主体动作与运镜…' : '描述你想生成的画面…'} />
      <div className="grid2">
        <label className="field"><span>画面比例</span>
          <select className="nodrag" value={String(params.aspect_ratio ?? '')} onChange={(e) => setNodeParam(id, 'aspect_ratio', e.target.value || undefined)} data-testid="gen-aspect">
            <option value="">模型默认</option>
            {ASPECT_RATIOS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        {type === 'video-gen' && (
          <label className="field"><span>时长</span>
            <select className="nodrag" value={String(params.duration ?? '')} onChange={(e) => setNodeParam(id, 'duration', e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">模型默认</option>
              {VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d} 秒</option>)}
            </select>
          </label>
        )}
      </div>
      <JsonExtra id={id} params={params} />
    </div>
  )
}

function TtsControls({ id, text, params }: { id: string; text?: string; params: Record<string, unknown> }) {
  const setNodeParam = useStore((s) => s.setNodeParam)
  return (
    <div className="node-section">
      <OwnText id={id} port="in" text={text} testid="tts-text" placeholder="要朗读的台词或旁白…" />
      <div className="grid2">
        <label className="field"><span>音色</span>
          <input className="nodrag" value={String(params.voice ?? '')} placeholder="模型默认，如 alloy" onChange={(e) => setNodeParam(id, 'voice', e.target.value || undefined)} data-testid="tts-voice" />
        </label>
        <label className="field"><span>语速</span>
          <select className="nodrag" value={String(params.speed ?? '')} onChange={(e) => setNodeParam(id, 'speed', e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">默认</option>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}

function DirectorControls({ id, text, params }: { id: string; text?: string; params: Record<string, unknown> }) {
  const setNodeParam = useStore((s) => s.setNodeParam)
  const skills = useStore((s) => s.skills)
  const directors = skills.filter((s) => s.metadata?.['hzc-kind'] === 'director')
  const others = skills.filter((s) => s.metadata?.['hzc-kind'] !== 'director')
  return (
    <div className="node-section">
      <OwnText id={id} port="in" text={text} testid="director-idea" placeholder="一句创意、一段故事或完整剧本…" />
      <label className="field"><span>导演 Skill</span>
        <select className="nodrag" value={String(params.skill ?? 'director-short-film')} onChange={(e) => setNodeParam(id, 'skill', e.target.value)} data-testid="director-skill">
          {directors.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
          {others.length > 0 && <optgroup label="其他 Skill">{others.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}</optgroup>}
          {skills.length === 0 && <option value="director-short-film">短片导演</option>}
        </select>
      </label>
      <div className="grid2">
        <label className="field"><span>镜头数</span>
          <select className="nodrag" value={String(params.shots ?? 6)} onChange={(e) => setNodeParam(id, 'shots', Number(e.target.value))} data-testid="director-shots">
            {[3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n} 个</option>)}
          </select>
        </label>
        <label className="field"><span>画面比例</span>
          <select className="nodrag" value={String(params.aspect_ratio ?? '')} onChange={(e) => setNodeParam(id, 'aspect_ratio', e.target.value || undefined)}>
            <option value="">不指定</option>
            {ASPECT_RATIOS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      <details className="adv nodrag">
        <summary><ChevronRight />风格与提示词语言</summary>
        <div className="grid2" style={{ marginTop: 6 }}>
          <label className="field"><span>提示词语言</span>
            <select className="nodrag" value={String(params.lang ?? 'zh')} onChange={(e) => setNodeParam(id, 'lang', e.target.value)}>
              <option value="zh">中文</option><option value="en">English</option>
            </select>
          </label>
          <label className="field"><span>视觉风格</span>
            <input className="nodrag" value={String(params.style ?? '')} placeholder="如：胶片电影感" onChange={(e) => setNodeParam(id, 'style', e.target.value || undefined)} />
          </label>
        </div>
      </details>
    </div>
  )
}

export function HzcNode({ id, type, data, selected }: NodeProps<CanvasNode>) {
  const def = NODE_TYPE_MAP[type ?? '']
  const profiles = useStore((s) => s.profiles)
  const setNodeData = useStore((s) => s.setNodeData)
  const setNodeParam = useStore((s) => s.setNodeParam)
  const runNodes = useStore((s) => s.runNodes)
  const expandStoryboard = useStore((s) => s.expandStoryboard)
  const openSettings = useStore((s) => s.setSettingsOpen)
  const runState = useStore((s) => s.runStates[id])
  const running = useStore((s) => s.runId !== null)
  const { fitView } = useReactFlow()
  const rootRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLSpanElement>(null)
  const prevStatus = useRef(runState?.status)

  useLayoutEffect(() => { enterNode(rootRef.current) }, [])
  const status = runState?.status ?? 'idle'
  useEffect(() => {
    if (prevStatus.current === 'running' && status === 'done') successPulse(ringRef.current)
    prevStatus.current = status
  }, [status])

  if (!def) return <div className="node">未知节点：{type}</div>
  const Icon = NODE_ICON[def.type]!
  const color = CATEGORY_COLOR[def.category]
  const profile = data.profileId ? profiles.find((p) => p.id === data.profileId) : undefined
  const missingProfile = !!data.profileId && !profile
  const params = data.params ?? {}
  const st = STATUS[status]
  // input nodes already show their own media; only show results for model/tool/output nodes
  const shown = def.category === 'input' ? undefined : type === 'preview' ? runState?.outputs?.in : runState?.outputs?.out
  const subtitle = profile ? `${def.label} · ${profile.model}` : data.label && data.label !== def.label ? def.label : def.description
  const hasStoryboard = type === 'director' && !!shown?.some((v) => v.type === 'storyboard')

  function expand() {
    const ids = expandStoryboard(id)
    if (ids.length) requestAnimationFrame(() => requestAnimationFrame(() => void fitView({ nodes: [{ id }, ...ids.map((x) => ({ id: x }))], padding: 0.15, maxZoom: 1, duration: 450 })))
  }

  return (
    <div ref={rootRef} className={`node cat-${def.category}${selected ? ' selected' : ''} st-${status}`} style={{ '--c': color } as React.CSSProperties} data-testid={`node-${def.type}`}>
      <span ref={ringRef} className="pulse-ring" />
      <div className="node-head">
        <span className="chip-ico" style={{ '--c': color } as React.CSSProperties}>
          {status === 'running' ? <span className="orbit" style={{ '--s': '17px' } as React.CSSProperties} /> : <Icon />}
        </span>
        <div className="node-titles">
          <div className="node-title" title={data.label}>{data.label ?? def.label}</div>
          <div className="node-sub" title={subtitle}>{subtitle}</div>
        </div>
        {st.label && (def.category !== 'input' || status === 'error') && (
          <span className={`pill ${status}`} data-testid="node-status" title={runState?.error}>
            {status === 'running' ? <span className="orbit" /> : st.Icon && <st.Icon />}{st.label}
          </span>
        )}
      </div>

      {def.modelKind && (
        <div className="node-section">
          <select className="nodrag" value={data.profileId ?? ''} aria-label="模型档案"
            onChange={(e) => {
              const p = profiles.find((x) => x.id === e.target.value)
              setNodeData(id, { profileId: e.target.value || undefined, label: data.label && !profiles.some((q) => q.name === data.label) && data.label !== def.label ? data.label : p?.name ?? def.label })
            }}>
            <option value="">选择{KIND_LABEL[def.modelKind]}…</option>
            {profiles.filter((p) => p.kind === def.modelKind).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
          </select>
          {missingProfile && <div className="warn"><TriangleExclamationPoint />绑定的模型档案已被删除</div>}
          {!profile && !missingProfile && (
            <div className="hint"><Info />
              <span>需要一个「{KIND_LABEL[def.modelKind]}」档案。<button className="link nodrag" onClick={() => openSettings(true)}>去添加</button></span>
            </div>
          )}
        </div>
      )}

      {type === 'text' && (
        <div className="node-section">
          <textarea className="nodrag nowheel" placeholder="写下剧本、创意或提示词…" value={data.text ?? ''} onChange={(e) => setNodeData(id, { text: e.target.value })} />
        </div>
      )}

      {(type === 'image' || type === 'video' || type === 'audio') && <MediaInput id={id} kind={type} assetId={data.assetId} mime={data.mime} />}
      {(type === 'image-gen' || type === 'video-gen') && <GenControls id={id} type={type} text={data.text} params={params} />}
      {type === 'tts' && <TtsControls id={id} text={data.text} params={params} />}
      {type === 'director' && <DirectorControls id={id} text={data.text} params={params} />}

      {type === 'image-reverse' && (
        <div className="node-section grid2">
          <label className="field"><span>目标风格</span>
            <select className="nodrag" value={String(params.style ?? 'general')} onChange={(e) => setNodeParam(id, 'style', e.target.value)} data-testid="reverse-style">
              {REVERSE_STYLES.map((s) => <option key={s} value={s}>{REVERSE_STYLE_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="field"><span>输出语言</span>
            <select className="nodrag" value={String(params.lang ?? 'zh')} onChange={(e) => setNodeParam(id, 'lang', e.target.value)}>
              {REVERSE_LANGS.map((l) => <option key={l} value={l}>{l === 'zh' ? '中文' : 'English'}</option>)}
            </select>
          </label>
        </div>
      )}

      {(type === 'vlm' || type === 'llm' || type === 'image-reverse') && (
        <div className="node-section">
          <details className="adv nodrag">
            <summary><ChevronRight />{type === 'llm' ? '系统提示（可选）' : '自定义指令（可选，覆盖内置模板）'}</summary>
            <textarea className="nodrag nowheel" value={String((type === 'llm' ? params.system : params.instruction) ?? '')}
              placeholder={type === 'llm' ? '例如：你是一位擅长短视频的电影编剧…' : '留空则使用内置模板'}
              onChange={(e) => setNodeParam(id, type === 'llm' ? 'system' : 'instruction', e.target.value)} />
          </details>
        </div>
      )}

      {status === 'running' && runState?.progress && <div className="node-section"><div className="progress" data-testid="node-progress"><span className="orbit" style={{ '--s': '13px' } as React.CSSProperties} />{runState.progress}</div></div>}
      {runState?.error && <div className="node-section"><div className="err" data-testid="node-error">{runState.error}</div></div>}
      {shown && shown.length > 0 && (
        <div className="node-section outputs">
          <Values vals={shown} />
          {hasStoryboard && (
            <button className="btn sm block nodrag" disabled={running} onClick={expand} title="把每个镜头展开成 图片 → 视频（→ 配音）节点" data-testid="expand-storyboard"><LayoutGrid />展开到画布</button>
          )}
        </div>
      )}

      <div className="ports">
        <div className="ports-col">
          {def.inputs.map((p) => (
            <div className="port in" key={p.id} title={`${PORT_LABEL[p.type]}输入${p.multiple ? '（可多条）' : ''}`}>
              <Handle type="target" position={Position.Left} id={p.id} style={{ background: PORT_COLOR[p.type] }} />
              <span className="dot" style={{ '--pc': PORT_COLOR[p.type] } as React.CSSProperties} />{p.label}
            </div>
          ))}
        </div>
        <div className="ports-col right">
          {def.outputs.map((p) => (
            <div className="port out" key={p.id} title={`${PORT_LABEL[p.type]}输出`}>
              {p.label}<span className="dot" style={{ '--pc': PORT_COLOR[p.type] } as React.CSSProperties} />
              <Handle type="source" position={Position.Right} id={p.id} style={{ background: PORT_COLOR[p.type] }} />
            </div>
          ))}
        </div>
      </div>

      {RUNNABLE.has(def.type) && (
        <div className="node-foot">
          <button className="btn sm grow nodrag run" disabled={running} onClick={() => void runNodes([id])} data-testid="run-node"><Play />运行</button>
          {(status === 'done' || status === 'cached') && type !== 'preview' && (
            <button className="btn sm nodrag" disabled={running} onClick={() => void runNodes([id], true)} title="忽略缓存，重新调用模型"><RefreshCw />重新生成</button>
          )}
        </div>
      )}
    </div>
  )
}
