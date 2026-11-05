import { useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Ban, Check, ChevronRight, CircleCheck, CircleExclamationPoint, Clock, Copy, Info, LoaderCircle, Play, RefreshCw, TriangleExclamationPoint, Upload,
} from 'lucide-react'
import {
  NODE_TYPE_MAP, REVERSE_LANGS, REVERSE_STYLES, REVERSE_STYLE_LABEL,
  type NodeStatus, type PortValue,
} from '@hzc/core'
import { api, assetUrl } from './api'
import { CATEGORY_COLOR, KIND_LABEL, NODE_ICON, PORT_COLOR, PORT_LABEL } from './icons'
import { useStore, type CanvasNode } from './store'

const STATUS: Record<NodeStatus, { label: string; Icon?: typeof Check; spin?: boolean }> = {
  idle: { label: '' },
  queued: { label: '排队中', Icon: Clock },
  running: { label: '运行中', Icon: LoaderCircle, spin: true },
  done: { label: '完成', Icon: CircleCheck },
  cached: { label: '复用缓存', Icon: CircleCheck },
  error: { label: '失败', Icon: CircleExclamationPoint },
  skipped: { label: '已跳过', Icon: Ban },
  cancelled: { label: '已停止', Icon: Ban },
}

const MEDIA_ACCEPT: Record<string, string> = { image: 'image/png,image/jpeg,image/webp,image/gif', video: 'video/mp4,video/webm,video/quicktime', audio: 'audio/*' }
const MEDIA_LABEL: Record<string, string> = { image: '图片', video: '视频', audio: '音频' }
const RUNNABLE = new Set(['llm', 'vlm', 'image-gen', 'video-gen', 'tts', 'image-reverse', 'video-reverse', 'director', 'preview', 'export'])

function Media({ v }: { v: Extract<PortValue, { assetId: string }> }) {
  const url = assetUrl(v.assetId)
  if (v.type === 'image') return <img className="media" src={url} alt="" draggable={false} />
  if (v.type === 'video') return <video className="media nodrag" src={url} controls preload="metadata" />
  return <audio className="nodrag" style={{ width: '100%' }} src={url} controls preload="metadata" />
}

function TextOut({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="out-text">
      <pre className="nodrag nowheel" data-testid="out-text">{text || '（空）'}</pre>
      <button className="btn sm icon ghost copy nodrag" title={copied ? '已复制' : '复制'}
        onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
        {copied ? <Check /> : <Copy />}
      </button>
    </div>
  )
}

function Values({ vals }: { vals: PortValue[] }) {
  return (
    <>
      {vals.map((v, i) =>
        v.type === 'text' ? <TextOut key={i} text={v.text} />
          : v.type === 'storyboard' ? <TextOut key={i} text={JSON.stringify(v.shots, null, 2)} />
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
          {busy ? <LoaderCircle className="spin" /> : <Upload />}
          <span>{busy ? '上传中…' : `点击上传${MEDIA_LABEL[kind]}`}</span>
        </div>
      )}
    </div>
  )
}

export function HzcNode({ id, type, data, selected }: NodeProps<CanvasNode>) {
  const def = NODE_TYPE_MAP[type ?? '']
  const profiles = useStore((s) => s.profiles)
  const setNodeData = useStore((s) => s.setNodeData)
  const setNodeParam = useStore((s) => s.setNodeParam)
  const runNodes = useStore((s) => s.runNodes)
  const openSettings = useStore((s) => s.setSettingsOpen)
  const runState = useStore((s) => s.runStates[id])
  const running = useStore((s) => s.runId !== null)
  if (!def) return <div className="node">未知节点：{type}</div>

  const Icon = NODE_ICON[def.type]!
  const color = CATEGORY_COLOR[def.category]
  const profile = data.profileId ? profiles.find((p) => p.id === data.profileId) : undefined
  const missingProfile = !!data.profileId && !profile
  const params = data.params ?? {}
  const status = runState?.status ?? 'idle'
  const st = STATUS[status]
  // input nodes already show their own media; only show results for model/tool/output nodes
  const shown = def.category === 'input' ? undefined : type === 'preview' ? runState?.outputs?.in : runState?.outputs?.out
  const subtitle = profile ? `${def.label} · ${profile.model}` : data.label && data.label !== def.label ? def.label : def.description

  return (
    <div className={`node cat-${def.category}${selected ? ' selected' : ''} st-${status}`} style={{ '--c': color } as React.CSSProperties} data-testid={`node-${def.type}`}>
      <div className="node-head">
        <span className="chip-ico" style={{ '--c': color } as React.CSSProperties}><Icon /></span>
        <div className="node-titles">
          <div className="node-title" title={data.label}>{data.label ?? def.label}</div>
          <div className="node-sub" title={subtitle}>{subtitle}</div>
        </div>
        {st.label && (
          <span className={`pill ${status}`} data-testid="node-status" title={runState?.error}>
            {st.Icon && <st.Icon className={st.spin ? 'spin' : undefined} />}{st.label}
          </span>
        )}
      </div>

      {def.modelKind && (
        <div className="node-section">
          <select className="nodrag" value={data.profileId ?? ''} aria-label="模型档案"
            onChange={(e) => {
              const p = profiles.find((x) => x.id === e.target.value)
              setNodeData(id, { profileId: e.target.value || undefined, label: p?.name ?? def.label })
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

      {runState?.error && <div className="node-section"><div className="err" data-testid="node-error">{runState.error}</div></div>}
      {shown && shown.length > 0 && <div className="node-section outputs"><Values vals={shown} /></div>}

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
