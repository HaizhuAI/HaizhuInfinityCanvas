import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Ban, Film, Images, ScrollText, Star, Check, CircleCheck, CircleExclamationPoint, Clock, Copy, Download, Expand, FileArchive, GripVertical, Image as ImageIcon, Info, LayoutGrid, Play, Plus, StepForward, Table2, TriangleExclamationPoint, Upload, Video, X } from 'lucide-react'
import { DND_MIME, readDrag, startDrag } from './dnd'
import { MAX_SUBJECT_IMAGES, NODE_TYPE_MAP, REF_LOOK_LABEL, REF_LOOKS, SUBJECT_KIND_LABEL, SUBJECT_KINDS, type RefLook, type ModelKind, type NodeStatus, type PortValue, type Shot, type SubjectKind } from '@hzc/core'
import { api, assetUrl } from './api'
import { ASPECT_CSS, CATEGORY_COLOR, KIND_LABEL, NODE_ICON, PORT_COLOR, PORT_LABEL } from './icons'
import { enterNode, successPulse } from './motion'
import { VersionSwitch } from './Versions'
import { CompareBar } from './Compare'
import { useStore, type CanvasNode, type CanvasNodeData } from './store'
import { MentionTextarea } from './Mentions'

export const STATUS: Record<NodeStatus, { label: string; Icon?: typeof Check }> = {
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
export const RUNNABLE = new Set(['llm', 'vlm', 'image-gen', 'video-gen', 'tts', 'image-reverse', 'video-reverse', 'director', 'preview', 'export'])
const WIDE = new Set(['image-gen', 'video-gen', 'image', 'video', 'director', 'video-reverse', 'export', 'preview'])

/** A node's error with the one action that fixes it, when we know it. */
export function ErrorBox({ nodeId, error, kind }: { nodeId: string; error: string; kind?: ModelKind }) {
  const openSettings = useStore((s) => s.openSettings)
  const hasModel = useStore((s) => !!kind && s.profiles.some((p) => p.kind === kind))
  let action: { label: string; run: () => void } | undefined
  if (kind && /还没有选择|已被删除|需要.*模型|请重新选择/.test(error)) {
    action = hasModel
      ? { label: '选择模型', run: () => { const el = document.querySelector<HTMLSelectElement>(`.react-flow__node[data-id="${nodeId}"] select[aria-label="模型档案"]`); el?.focus(); el?.showPicker?.() } }
      : { label: `添加${KIND_LABEL[kind]}`, run: () => openSettings({ addKind: kind }) }
  } else if (/FFmpeg/.test(error)) action = { label: '查看安装方法', run: () => openSettings({ tab: 'about' }) }
  else if (/重新填写 Key|返回 40[13]|Key 无效/.test(error)) action = { label: '检查模型档案', run: () => openSettings({ tab: 'profiles' }) }
  return (
    <div className="err" data-testid="node-error">
      <span>{error}</span>
      {action && <button className="err-action nodrag" onClick={action.run} data-testid="error-action">{action.label}</button>}
    </div>
  )
}

export function StatusPill({ status, error }: { status: NodeStatus; error?: string }) {
  const st = STATUS[status]
  if (!st.label) return null
  return (
    <span className={`pill ${status}`} data-testid="node-status" title={error}>
      {status === 'running' ? <span className="orbit" aria-hidden="true" /> : st.Icon && <st.Icon aria-hidden="true" />}{st.label}
    </span>
  )
}

type MediaValue = Extract<PortValue, { type: 'image' | 'video' | 'audio' }>
type FileValue = Extract<PortValue, { type: 'file' }>

/** A downloadable result that is not media (e.g. an editor project package). */
export function FileCard({ v, hint }: { v: FileValue; hint?: string }) {
  return (
    <a className="file-card nodrag" href={assetUrl(v.assetId)} download={v.name ?? 'download.zip'} data-testid="out-file">
      <FileArchive aria-hidden="true" />
      <span className="grow"><strong>{v.name ?? '文件'}</strong><small>{hint ?? (v.mime === 'application/zip' ? 'ZIP 压缩包' : v.mime)}</small></span>
      <Download aria-hidden="true" />
    </a>
  )
}

function MediaView({ v, name, nodeId, onPick, canContinue }: { v: MediaValue; name?: string; nodeId?: string; onPick?: () => void; canContinue?: boolean }) {
  const openLightbox = useStore((s) => s.openLightbox)
  const continueFrom = useStore((s) => s.continueFromLastFrame)
  const busy = useStore((s) => s.runId !== null)
  const url = assetUrl(v.assetId)
  if (v.type === 'audio') return <div className="nmedia audio"><audio className="nodrag" src={url} controls preload="metadata" data-testid="out-audio" /></div>
  const open = () => openLightbox({ assetId: v.assetId, mime: v.mime, name, nodeId })
  // drag the result onto the canvas (a new input node) or onto another media node
  const drag = (e: React.DragEvent) => { e.stopPropagation(); startDrag(e, { type: v.type, assetId: v.assetId, mime: v.mime, name: name ? `${name}（结果）` : undefined }) }
  return (
    <div className="nmedia" onDoubleClick={open}>
      {v.type === 'image' ? <img className="media" src={url} alt={name ?? '图片'} draggable={false} loading="lazy" decoding="async" /> : <video className="media nodrag" src={url} controls preload="metadata" />}
      <div className="media-tools">
        <span className="btn xs icon nodrag grip" draggable onDragStart={drag} role="button" tabIndex={-1} aria-label="拖出这个结果" title={`拖到画布上作为新的${v.type === 'image' ? '图片' : '视频'}节点，或拖到另一个${v.type === 'image' ? '图片' : '视频'}节点上替换`} data-testid="drag-result"><GripVertical /></span>
        <button className="btn xs icon nodrag" onClick={open} aria-label="全屏预览" title="全屏预览（双击也可）"><Expand /></button>
        {canContinue && v.type === 'video' && nodeId && (
          <button className="btn xs icon nodrag" onClick={() => void continueFrom(nodeId, v.assetId)} aria-label="从最后一帧接着生成" title="从最后一帧接着生成下一段" data-testid="continue-video"><StepForward /></button>
        )}
        {onPick && <button className="btn xs nodrag" onClick={onPick} disabled={busy} title="只让这一个流向下游，其余留在版本里" data-testid="pick-result">选用</button>}
      </div>
    </div>
  )
}

export function TextOut({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const savePrompt = useStore((s) => s.savePrompt)
  return (
    <div className="out-text">
      <pre className="nodrag nowheel" data-testid="out-text">{text || '（空）'}</pre>
      <div className="out-tools">
        {text.trim() && <button className="btn xs icon ghost nodrag" aria-label="收藏到提示词库" title="收藏到提示词库" onClick={() => void savePrompt(text.trim())} data-testid="save-prompt"><Star /></button>}
        <button className="btn xs icon ghost nodrag" aria-label={copied ? '已复制' : '复制'} title="复制"
          onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>
          {copied ? <Check /> : <Copy />}
        </button>
      </div>
    </div>
  )
}

export function ShotList({ title, shots }: { title?: string; shots: Shot[] }) {
  return (
    <div className="shots nodrag nowheel" data-testid="shot-list">
      {title && <div className="sb-title">《{title}》</div>}
      {shots.map((s) => (
        <div className="shot" key={s.index}>
          {s.keyframe ? <img className="thumb" src={assetUrl(s.keyframe.assetId)} alt={`镜头 ${s.index} 关键帧`} loading="lazy" decoding="async" /> : <span className="no">{s.index}</span>}
          <div style={{ minWidth: 0 }}>
            <div className="t">{s.keyframe ? `${s.index}. ${s.title}` : s.title}<span>{s.duration}s</span></div>
            {s.visual && <div className="v">{s.visual}</div>}
            {s.camera && <div className="c">{s.camera}</div>}
            {s.dialogue && <div className="d">{s.dialogue}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function Values({ vals }: { vals: PortValue[] }) {
  const media = vals.filter((v): v is MediaValue => v.type === 'image' || v.type === 'video' || v.type === 'audio')
  return (
    <>
      {vals.filter((v) => v.type === 'text').map((v, i) => <TextOut key={`t${i}`} text={(v as { text: string }).text} />)}
      {vals.filter((v) => v.type === 'storyboard').map((v, i) => <ShotList key={`s${i}`} title={(v as { title?: string }).title} shots={(v as { shots: Shot[] }).shots} />)}
      {media.map((v, i) => <MediaView key={`m${i}`} v={v} />)}
      {vals.filter((v): v is FileValue => v.type === 'file').map((v, i) => <FileCard key={`f${i}`} v={v} />)}
    </>
  )
}

/** Empty result frame shaped like the requested aspect ratio; shimmers while running. */
function Frame({ aspect, kind, running, progress }: { aspect?: string; kind: 'image' | 'video'; running: boolean; progress?: string }) {
  const Icon = kind === 'image' ? ImageIcon : Video
  return (
    <div className={`frame${running ? ' running' : ''}`} style={{ '--ar': ASPECT_CSS[aspect ?? ''] ?? '16 / 10' } as React.CSSProperties}>
      {aspect && <span className="ar">{aspect}</span>}
      <div>
        {running ? <span className="orbit" style={{ '--s': '20px', margin: '0 auto 8px', display: 'block' } as React.CSSProperties} aria-hidden="true" /> : <Icon aria-hidden="true" />}
        <span data-testid={running ? 'node-progress' : undefined}>{running ? (progress ?? '生成中…') : `运行后，${kind === 'image' ? '图片' : '视频'}会出现在这里`}</span>
      </div>
    </div>
  )
}

function MediaInput({ id, kind, assetId, mime, name, error }: { id: string; kind: 'image' | 'video' | 'audio'; assetId?: string; mime?: string; name?: string; error?: string }) {
  const setNodeData = useStore((s) => s.setNodeData)
  const showToast = useStore((s) => s.showToast)
  const loadAssets = useStore((s) => s.loadAssets)
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  async function onFile(f: File | undefined) {
    if (!f) return
    if (!f.type.startsWith(`${kind}/`)) { showToast(`请拖入${MEDIA_LABEL[kind]}文件`); return }
    setBusy(true)
    try {
      const a = await api.uploadAsset(f)
      setNodeData(id, { assetId: a.id, mime: a.mime, label: f.name })
      void loadAssets()
    } catch (e) { showToast(`上传失败：${(e as Error).message}`) } finally { setBusy(false) }
  }
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DND_MIME)) { e.preventDefault(); e.stopPropagation(); setOver(true) } },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); setOver(false); void onFile(e.dataTransfer.files[0]); return }
      // a result dragged from another node (or the gallery): use that file here
      const p = readDrag(e)
      if (p && 'assetId' in p) {
        e.preventDefault(); e.stopPropagation(); setOver(false)
        if (p.type !== kind) { showToast(`这里需要${MEDIA_LABEL[kind]}`); return }
        setNodeData(id, { assetId: p.assetId, mime: p.mime, label: p.name ?? name })
      }
    },
  }
  return (
    <div className="nbody" {...dropProps}>
      <input ref={ref} type="file" accept={MEDIA_ACCEPT[kind]} hidden data-testid={`upload-${kind}`} onChange={(e) => void onFile(e.target.files?.[0])} />
      {assetId && mime ? (
        <>
          <MediaView v={{ type: kind, assetId, mime }} name={name} />
          <button className="btn xs nodrag" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => ref.current?.click()}><Upload />{busy ? '上传中…' : `更换${MEDIA_LABEL[kind]}`}</button>
        </>
      ) : (
        <div className={`dropzone nodrag${over ? ' over' : ''}`} role="button" tabIndex={0} onClick={() => ref.current?.click()} onKeyDown={(e) => e.key === 'Enter' && ref.current?.click()}>
          {busy ? <span className="orbit" aria-hidden="true" /> : <Upload aria-hidden="true" />}
          <span>{busy ? '上传中…' : `点击或拖入${MEDIA_LABEL[kind]}`}</span>
        </div>
      )}
      {error && <ErrorBox nodeId={id} error={error} />}
    </div>
  )
}

/** On a reverse node that uses an imported skill: which one (the node's own label says what it does). */
function ReverseSkillChip({ name }: { name: string }) {
  const label = useStore((s) => s.skills.find((x) => x.name === name)?.label)
  return <div className={`skill-chip${label ? '' : ' missing'}`} data-testid="reverse-skill-chip" title={label ? `反推方式：${label}（Skill）` : '找不到这个 Skill'}><ScrollText aria-hidden="true" />{label ?? `${name}（已删除）`}</div>
}

/** Text box that steps aside when an upstream edge supplies the text. */
function OwnText({ id, port, text, placeholder, testid, rows, mentions }: { id: string; port: string; text?: string; placeholder: string; testid: string; rows?: number; mentions?: boolean }) {
  const setNodeData = useStore((s) => s.setNodeData)
  const wired = useStore((s) => s.edges.some((e) => e.target === id && e.targetHandle === port))
  if (wired) return <div className="hint"><Info aria-hidden="true" />内容来自上游连线</div>
  const style = rows ? { minHeight: rows * 20 + 20 } : undefined
  if (mentions) return <MentionTextarea className="nodrag nowheel" rows={rows} placeholder={placeholder} value={text ?? ''} onValue={(v) => setNodeData(id, { text: v })} data-testid={testid} style={style} />
  return <textarea className="nodrag nowheel" rows={rows} placeholder={placeholder} value={text ?? ''} onChange={(e) => setNodeData(id, { text: e.target.value })} data-testid={testid} style={style} />
}

/** 主体：a named character / product / scene with up to four reference pictures, cited as @name */
function SubjectBody({ id, data }: { id: string; data: CanvasNodeData }) {
  const setNodeData = useStore((s) => s.setNodeData)
  const setNodeParam = useStore((s) => s.setNodeParam)
  const showToast = useStore((s) => s.showToast)
  const loadAssets = useStore((s) => s.loadAssets)
  const p = data.params ?? {}
  const name = String(p.name ?? '')
  const kind = (String(p.kind ?? 'character')) as SubjectKind
  const images = (Array.isArray(p.images) ? p.images : []) as { assetId: string; mime: string }[]
  const duplicate = useStore((s) => !!name && s.nodes.some((n) => n.id !== id && n.type === 'subject' && String(n.data.params?.name ?? '').trim() === name.trim() && s.nodes.indexOf(n) < s.nodes.findIndex((x) => x.id === id)))
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const addImages = (more: { assetId: string; mime: string }[]) => setNodeParam(id, 'images', [...images, ...more].slice(0, MAX_SUBJECT_IMAGES))
  async function upload(files: File[]) {
    const pics = files.filter((f) => f.type.startsWith('image/')).slice(0, MAX_SUBJECT_IMAGES - images.length)
    if (!pics.length) { showToast('这里需要图片'); return }
    setBusy(true)
    try {
      const out: { assetId: string; mime: string }[] = []
      for (const f of pics) { const a = await api.uploadAsset(f); out.push({ assetId: a.id, mime: a.mime }) }
      addImages(out)
      void loadAssets()
    } catch (e) { showToast(`上传失败：${(e as Error).message}`) } finally { setBusy(false) }
  }
  const rename = (v: string) => {
    const next = v.replace(/[\s@]/g, '').slice(0, 24)
    setNodeParam(id, 'name', next)
    if (!data.label || data.label === '主体' || data.label === `@${name}`) setNodeData(id, { label: next ? `@${next}` : '主体' })
  }
  return (
    <div className="subject" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DND_MIME)) { e.preventDefault(); e.stopPropagation(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); void upload(Array.from(e.dataTransfer.files)); return }
        const d = readDrag(e)
        if (d && 'assetId' in d) { e.preventDefault(); e.stopPropagation(); if (d.type === 'image') addImages([{ assetId: d.assetId, mime: d.mime }]); else showToast('这里需要图片') }
      }}>
      <label className="subj-name"><span aria-hidden="true">@</span>
        <input className="nodrag" value={name} onChange={(e) => rename(e.target.value)} placeholder="名字，例如 小橘" aria-label="主体名字（提示词里用 @名字 引用）" data-testid="subject-name" />
      </label>
      {duplicate && <div className="hint warn">画布上已有同名主体，只有第一个生效</div>}
      <div className="seg2 sm nodrag" role="radiogroup" aria-label="类型">
        {SUBJECT_KINDS.map((k) => <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setNodeParam(id, 'kind', k)}>{SUBJECT_KIND_LABEL[k]}</button>)}
      </div>
      <div className={`subj-images${over ? ' over' : ''}`}>
        {images.map((im, i) => (
          <span className="subj-img" key={`${im.assetId}-${i}`}>
            <img src={assetUrl(im.assetId)} alt="" loading="lazy" />
            <button type="button" className="nodrag" aria-label="移除这张" onClick={() => setNodeParam(id, 'images', images.filter((_, j) => j !== i))}><X /></button>
          </span>
        ))}
        {images.length < MAX_SUBJECT_IMAGES && (
          <button type="button" className="subj-add nodrag" disabled={busy} onClick={() => ref.current?.click()} aria-label="添加参考图" title="添加参考图（也可以把图片或结果拖进来）" data-testid="subject-add-image">
            {busy ? <span className="orbit" style={{ '--s': '14px' } as React.CSSProperties} aria-hidden="true" /> : <Plus />}
          </button>
        )}
        <input ref={ref} type="file" accept="image/*" multiple hidden data-testid="subject-upload" onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </div>
      <textarea className="nodrag nowheel" rows={3} value={data.text ?? ''} onChange={(e) => setNodeData(id, { text: e.target.value })}
        placeholder="外貌、服装、材质、性格……会写进提到它的提示词" data-testid="subject-desc" />
      <RefSetBar id={id} kind={kind} named={!!name} />
      <div className="hint"><Info aria-hidden="true" /><span>在提示词里写 <code>@{name || '名字'}</code>：带上这段描述，支持参考图的模型还会收到这些图</span></div>
    </div>
  )
}

/** 生成参考图组 (method: shuohao-skills character-refs): an anchor from the description, the other views from the anchor */
function RefSetBar({ id, kind, named }: { id: string; kind: SubjectKind; named: boolean }) {
  const [look, setLook] = useState<RefLook>(() => { try { return localStorage.getItem('hzc.refLook') === 'realistic' ? 'realistic' : 'anime' } catch { return 'anime' } })
  const running = useStore((s) => s.runId !== null)
  const what = kind === 'character' ? '正面全身 → 大头照、侧面、背面' : kind === 'product' ? '正面 → 侧面、细节' : '空场景全景'
  return (
    <div className="subj-refset nodrag">
      <select value={look} onChange={(e) => { const v = e.target.value as RefLook; setLook(v); try { localStorage.setItem('hzc.refLook', v) } catch { /* blocked */ } }} aria-label="参考图画风" data-testid="refset-look">
        {REF_LOOKS.map((l) => <option key={l} value={l}>{REF_LOOK_LABEL[l]}</option>)}
      </select>
      <button type="button" className="btn xs" disabled={!named || running} title={named ? `生成一组参考图：${what}；出完自动放进这个主体` : '先给主体起个名字'}
        onClick={() => useStore.getState().makeRefSet(id, look)} data-testid="make-refset"><Images />生成参考图组</button>
    </div>
  )
}

function ModelChip({ id, kind, profileId, label, defLabel }: { id: string; kind: NonNullable<(typeof NODE_TYPE_MAP)[string]['modelKind']>; profileId?: string; label?: string; defLabel: string }) {
  const profiles = useStore((s) => s.profiles)
  const setNodeData = useStore((s) => s.setNodeData)
  const openSettings = useStore((s) => s.openSettings)
  const profile = profileId ? profiles.find((p) => p.id === profileId) : undefined
  const options = profiles.filter((p) => p.kind === kind)
  return (
    <>
      <div className={`nmodel${profile ? '' : ' unbound'}`}>
        <select className="nodrag" value={profileId ?? ''} aria-label="模型档案"
          onChange={(e) => {
            const p = profiles.find((x) => x.id === e.target.value)
            const custom = label && label !== defLabel && !profiles.some((q) => q.name === label)
            setNodeData(id, { profileId: e.target.value || undefined, label: custom ? label : p?.name ?? defLabel })
          }}>
          <option value="">选择{KIND_LABEL[kind]}…</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
        </select>
      </div>
      {!!profileId && !profile && <div className="warn"><TriangleExclamationPoint aria-hidden="true" />绑定的模型档案已被删除</div>}
      {!profileId && options.length === 0 && (
        <div className="hint"><Info aria-hidden="true" /><span>还没有{KIND_LABEL[kind]}档案。<button className="link nodrag" onClick={() => openSettings({ addKind: kind })} data-testid="node-add-model">去添加</button></span></div>
      )}
    </>
  )
}

export function HzcNode({ id, type, data, selected }: NodeProps<CanvasNode>) {
  const def = NODE_TYPE_MAP[type ?? '']
  const runNodes = useStore((s) => s.runNodes)
  const expandStoryboard = useStore((s) => s.expandStoryboard)
  const pickResult = useStore((s) => s.pickResult)
  const openStoryboard = useStore((s) => s.openStoryboard)
  const openTimeline = useStore((s) => s.openTimeline)
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
  const params = data.params ?? {}
  const isRunning = status === 'running'
  const shown = def.category === 'input' ? undefined : type === 'preview' ? runState?.outputs?.in : runState?.outputs?.out
  const hasStoryboard = (type === 'director' || type === 'video-reverse') && !!shown?.some((v) => v.type === 'storyboard')
  const genKind = type === 'image-gen' ? 'image' : type === 'video-gen' || type === 'export' ? 'video' : undefined
  const media = shown?.filter((v): v is MediaValue => v.type === 'image' || v.type === 'video' || v.type === 'audio') ?? []

  function expand() {
    const ids = expandStoryboard(id)
    if (ids.length) requestAnimationFrame(() => requestAnimationFrame(() => void fitView({ nodes: [{ id }, ...ids.map((x) => ({ id: x }))], padding: 0.15, maxZoom: 1, duration: 450 })))
  }

  return (
    <div ref={rootRef} className={`node${WIDE.has(def.type) ? ' wide' : ''} cat-${def.category}${selected ? ' selected' : ''} st-${status}`}
      style={{ '--c': color } as React.CSSProperties} data-testid={`node-${def.type}`} aria-label={`${def.label}：${data.label ?? def.label}`}>
      <span ref={ringRef} className="pulse-ring" aria-hidden="true" />
      <div className="node-head">
        <span className="nico" aria-hidden="true">{isRunning ? <span className="orbit" style={{ '--s': '13px' } as React.CSSProperties} /> : <Icon />}</span>
        <div className="ntitles">
          <div className="ntitle" title={data.label}>{data.label ?? def.label}</div>
          {data.label && data.label !== def.label && <div className="nsub">{def.label}</div>}
        </div>
        {(def.category !== 'input' || status === 'error') && <StatusPill status={status} error={runState?.error} />}
        {RUNNABLE.has(def.type) && (
          <button className="nrun nodrag" disabled={running} onClick={() => void runNodes([id])} aria-label={`运行「${data.label ?? def.label}」`} title="运行这个节点（及其上游）" data-testid="run-node"><Play /></button>
        )}
      </div>

      {(type === 'image' || type === 'video' || type === 'audio') && <MediaInput id={id} kind={type} assetId={data.assetId} mime={data.mime} name={data.label} error={runState?.error} />}

      {type !== 'image' && type !== 'video' && type !== 'audio' && (
        <div className="nbody">
          {def.modelKind && <ModelChip id={id} kind={def.modelKind} profileId={data.profileId} label={data.label} defLabel={def.label} />}

          {genKind && type !== 'export' && (media.length
            ? <div className={`mwrap${media.length > 1 ? ' nmedia multi' : ''}${isRunning ? ' regen' : ''}`}>
                {media.map((v, i) => <MediaView key={i} v={v} name={data.label} nodeId={id} canContinue={type === 'video-gen' || type === 'export'}
                  onPick={media.length > 1 && !isRunning ? () => void pickResult(id, i) : undefined} />)}
                {isRunning && <div className="regen-overlay" data-testid="node-progress"><span className="orbit" style={{ '--s': '18px' } as React.CSSProperties} aria-hidden="true" />{runState?.progress ?? '重新生成中…'}</div>}
              </div>
            : <Frame aspect={params.aspect_ratio as string | undefined} kind={genKind} running={isRunning} progress={runState?.progress} />)}

          {type === 'text' && <MentionTextarea className="nodrag nowheel" placeholder="写下剧本、创意或提示词…（@ 引用主体）" value={data.text ?? ''} onValue={(v) => useStore.getState().setNodeData(id, { text: v })} />}
          {type === 'subject' && <SubjectBody id={id} data={data} />}
          {(type === 'image-gen' || type === 'video-gen') && <OwnText id={id} port="prompt" text={data.text} rows={3} testid="gen-prompt" mentions placeholder={type === 'video-gen' ? '画面、主体动作与运镜…（@ 引用主体）' : '描述你想生成的画面…（@ 引用主体）'} />}
          {type === 'tts' && <OwnText id={id} port="in" text={data.text} rows={3} testid="tts-text" placeholder="要朗读的台词或旁白…" />}
          {type === 'director' && <OwnText id={id} port="in" text={data.text} rows={3} testid="director-idea" mentions placeholder="一句创意、一段故事或完整剧本…" />}
          {type === 'llm' && <OwnText id={id} port="in" text={data.text} rows={3} testid="llm-text" mentions placeholder="提示词（或连接上游文本）" />}
          {type === 'image-reverse' && typeof params.skill === 'string' && params.skill && <ReverseSkillChip name={params.skill} />}

          {!genKind && isRunning && runState?.progress && <div className="progress" data-testid="node-progress"><span className="orbit" style={{ '--s': '13px' } as React.CSSProperties} aria-hidden="true" />{runState.progress}</div>}
          {runState?.error && <ErrorBox nodeId={id} error={runState.error} kind={def.modelKind} />}
          {shown && shown.length > 0 && !(genKind && type !== 'export') && <Values vals={shown} />}
          {type === 'image-reverse' && !!runState?.outputs?.negative?.length && (
            <div className="neg-out" data-testid="reverse-negative"><span className="lbl">负面词</span><Values vals={runState.outputs.negative} /></div>
          )}
          {type === 'export' && !media.length && <Frame kind="video" running={isRunning} progress={runState?.progress} aspect={params.aspect_ratio as string | undefined} />}
          {type === 'export' && isRunning && media.length > 0 && <div className="progress" data-testid="node-progress"><span className="orbit" style={{ '--s': '13px' } as React.CSSProperties} aria-hidden="true" />{runState?.progress ?? '合成中…'}</div>}
          {type === 'export' && (
            <div className="sb-actions">
              <button className="btn sm nodrag" onClick={() => openTimeline(id)} data-testid="open-timeline"><Film />时间线{Array.isArray(params.order) ? ' · 已排序' : ''}</button>
            </div>
          )}
          {data.compare && <CompareBar id={id} group={data.compare} />}
          {!isRunning && <VersionSwitch nodeId={id} />}
          {hasStoryboard && (
            <div className="sb-actions">
              <button className="btn sm nodrag" onClick={() => openStoryboard(id)} data-testid="edit-storyboard"><Table2 />分镜表</button>
              <button className="btn sm nodrag" disabled={running} onClick={expand} data-testid="expand-storyboard"><LayoutGrid />展开到画布</button>
            </div>
          )}
        </div>
      )}

      {(def.inputs.length > 0 || def.outputs.length > 0) && (
        <div className="ports">
          <div className="ports-col">
            {def.inputs.map((p) => (
              <div className="port in" key={p.id} title={`${PORT_LABEL[p.type]}输入${p.multiple ? '（可多条）' : ''}`}>
                <Handle type="target" position={Position.Left} id={p.id} style={{ background: PORT_COLOR[p.type] }} aria-label={`${p.label}（${PORT_LABEL[p.type]}输入）`} />
                <span className="dot" style={{ '--pc': PORT_COLOR[p.type] } as React.CSSProperties} aria-hidden="true" />{p.label}
              </div>
            ))}
          </div>
          <div className="ports-col right">
            {def.outputs.map((p) => (
              <div className="port out" key={p.id} title={`${PORT_LABEL[p.type]}输出`}>
                {p.label}<span className="dot" style={{ '--pc': PORT_COLOR[p.type] } as React.CSSProperties} aria-hidden="true" />
                <Handle type="source" position={Position.Right} id={p.id} style={{ background: PORT_COLOR[p.type] }} aria-label={`${p.label}（${PORT_LABEL[p.type]}输出）`} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
