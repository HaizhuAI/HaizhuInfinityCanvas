import { useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  NODE_TYPE_MAP, REVERSE_LANGS, REVERSE_STYLES, REVERSE_STYLE_LABEL,
  type NodeStatus, type PortType, type PortValue,
} from '@hzc/core'
import { api, assetUrl } from './api'
import { useStore, type CanvasNode } from './store'

export const PORT_COLOR: Record<PortType, string> = {
  text: '#60a5fa', image: '#f472b6', video: '#fb923c', audio: '#34d399', storyboard: '#c084fc', any: '#9ca3af',
}

const STATUS_LABEL: Record<NodeStatus, string> = {
  idle: '', queued: '排队中', running: '运行中…', done: '完成', cached: '复用缓存', error: '失败', skipped: '已跳过', cancelled: '已停止',
}

const MEDIA_ACCEPT: Record<string, string> = { image: 'image/png,image/jpeg,image/webp,image/gif', video: 'video/mp4,video/webm,video/quicktime', audio: 'audio/*' }

const RUNNABLE = new Set(['llm', 'vlm', 'image-gen', 'video-gen', 'tts', 'image-reverse', 'video-reverse', 'director', 'preview', 'export'])

function Media({ v }: { v: Extract<PortValue, { assetId: string }> }) {
  const url = assetUrl(v.assetId)
  if (v.type === 'image') return <img className="media" src={url} alt="" draggable={false} />
  if (v.type === 'video') return <video className="media nodrag" src={url} controls preload="metadata" />
  return <audio className="nodrag" src={url} controls preload="metadata" />
}

function TextOut({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="out-text">
      <pre className="nodrag nowheel" data-testid="out-text">{text || '（空）'}</pre>
      <button className="copy" onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
        {copied ? '已复制' : '复制'}
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
    <div className="node-body">
      {assetId && mime && <Media v={{ type: kind, assetId, mime }} />}
      <input ref={ref} type="file" accept={MEDIA_ACCEPT[kind]} hidden data-testid={`upload-${kind}`} onChange={(e) => void onFile(e.target.files?.[0])} />
      <button className="nodrag wide" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? '上传中…' : assetId ? '更换素材' : '上传素材'}
      </button>
    </div>
  )
}

export function HzcNode({ id, type, data, selected }: NodeProps<CanvasNode>) {
  const def = NODE_TYPE_MAP[type ?? '']
  const profiles = useStore((s) => s.profiles)
  const setNodeData = useStore((s) => s.setNodeData)
  const setNodeParam = useStore((s) => s.setNodeParam)
  const runNodes = useStore((s) => s.runNodes)
  const runState = useStore((s) => s.runStates[id])
  const running = useStore((s) => s.runId !== null)
  if (!def) return <div className="node node-unknown">未知节点：{type}</div>
  const profile = data.profileId ? profiles.find((p) => p.id === data.profileId) : undefined
  const missingProfile = !!data.profileId && !profile
  const params = data.params ?? {}
  const status = runState?.status ?? 'idle'
  // input nodes already show their own media; only show results for model/tool/output nodes
  const shown = def.category === 'input' ? undefined : type === 'preview' ? runState?.outputs?.in : runState?.outputs?.out

  return (
    <div className={`node cat-${def.category}${selected ? ' selected' : ''} st-${status}`} data-testid={`node-${def.type}`}>
      <div className="node-head">
        <span className="node-title" title={data.label}>{data.label ?? def.label}</span>
        {status !== 'idle' ? <span className={`badge ${status}`} data-testid="node-status">{STATUS_LABEL[status]}</span> : <span className="node-type">{def.label}</span>}
      </div>

      {def.modelKind && (
        <div className="node-body">
          <select
            className="nodrag"
            value={data.profileId ?? ''}
            aria-label="模型档案"
            onChange={(e) => {
              const p = profiles.find((x) => x.id === e.target.value)
              setNodeData(id, { profileId: e.target.value || undefined, label: p?.name ?? def.label })
            }}
          >
            <option value="">选择模型档案…</option>
            {profiles.filter((p) => p.kind === def.modelKind).map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.model}</option>
            ))}
          </select>
          {missingProfile && <div className="warn">绑定的模型档案已被删除</div>}
          {!profile && !missingProfile && <div className="hint">尚未绑定模型（在「设置 → 模型档案」添加 {def.modelKind} 类型）</div>}
        </div>
      )}

      {type === 'text' && (
        <div className="node-body">
          <textarea className="nodrag nowheel" placeholder="在这里写剧本、创意或提示词…" value={data.text ?? ''}
            onChange={(e) => setNodeData(id, { text: e.target.value })} />
        </div>
      )}

      {(type === 'image' || type === 'video' || type === 'audio') && <MediaInput id={id} kind={type} assetId={data.assetId} mime={data.mime} />}

      {type === 'image-reverse' && (
        <div className="node-body grid2">
          <label>目标风格
            <select className="nodrag" value={String(params.style ?? 'general')} onChange={(e) => setNodeParam(id, 'style', e.target.value)} data-testid="reverse-style">
              {REVERSE_STYLES.map((s) => <option key={s} value={s}>{REVERSE_STYLE_LABEL[s]}</option>)}
            </select>
          </label>
          <label>语言
            <select className="nodrag" value={String(params.lang ?? 'zh')} onChange={(e) => setNodeParam(id, 'lang', e.target.value)}>
              {REVERSE_LANGS.map((l) => <option key={l} value={l}>{l === 'zh' ? '中文' : 'English'}</option>)}
            </select>
          </label>
        </div>
      )}

      {(type === 'vlm' || type === 'llm' || type === 'image-reverse') && (
        <details className="node-body adv nodrag">
          <summary>{type === 'llm' ? '系统提示（可选）' : '自定义指令（可选，覆盖内置模板）'}</summary>
          <textarea className="nodrag nowheel" value={String((type === 'llm' ? params.system : params.instruction) ?? '')}
            placeholder={type === 'llm' ? '例如：你是一位电影编剧…' : '留空使用内置模板'}
            onChange={(e) => setNodeParam(id, type === 'llm' ? 'system' : 'instruction', e.target.value)} />
        </details>
      )}

      {runState?.error && <div className="node-body"><div className="err" data-testid="node-error">{runState.error}</div></div>}
      {shown && shown.length > 0 && <div className="node-body outputs"><Values vals={shown} /></div>}

      {RUNNABLE.has(def.type) && (
        <div className="node-body runbar">
          <button className="nodrag run" disabled={running} onClick={() => void runNodes([id])} data-testid="run-node">▶ 运行</button>
          {(status === 'done' || status === 'cached') && type !== 'preview' && (
            <button className="nodrag" disabled={running} onClick={() => void runNodes([id], true)} title="忽略缓存重新调用模型">↻ 重新生成</button>
          )}
        </div>
      )}

      <div className="ports">
        <div className="ports-col">
          {def.inputs.map((p) => (
            <div className="port in" key={p.id}>
              <Handle type="target" position={Position.Left} id={p.id} style={{ background: PORT_COLOR[p.type] }} />
              <span>{p.label}</span>
            </div>
          ))}
        </div>
        <div className="ports-col right">
          {def.outputs.map((p) => (
            <div className="port out" key={p.id}>
              <span>{p.label}</span>
              <Handle type="source" position={Position.Right} id={p.id} style={{ background: PORT_COLOR[p.type] }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
