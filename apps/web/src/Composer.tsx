import { useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUp, ImagePlus, X } from 'lucide-react'
import { ASPECT_RATIOS, VARIATION_COUNTS, VIDEO_DURATIONS } from '@hzc/core'
import { api, assetUrl } from './api'
import { useStore, uid, type CanvasNode } from './store'
import { useAddNode } from './useAddNode'
import { PromptOptimizer } from './PromptOptimizer'
import { useReactFlow, type Edge } from '@xyflow/react'

type Kind = 'image' | 'video'
interface Ref { assetId: string; mime: string; nodeId?: string; name?: string }

/** what the bar was last set to (kind, aspect, duration, count): remembered in this browser */
const KEY = 'hzc.composer.settings'
interface Settings { kind: Kind; aspect: string; duration: number | ''; count: number }
function loadSettings(): Settings {
  try { return { kind: 'image', aspect: '16:9', duration: '', count: 1, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) } } catch { return { kind: 'image', aspect: '16:9', duration: '', count: 1 } }
}

const money = (n: number) => (Math.round(n * 100) / 100).toString()

/**
 * 「生成栏」：write a sentence, pick the model and a few settings, generate. The result is an ordinary
 * node on the canvas (wire it, tweak it, run it again); selected image nodes come along as references.
 */
export function Composer() {
  const open = useStore((s) => s.composerOpen)
  const empty = useStore((s) => s.nodes.length === 0)
  const setOpen = useStore((s) => s.setComposerOpen)
  if (!open && !empty) return null
  return <ComposerBar low={empty} onClose={empty ? undefined : () => setOpen(false)} />
}

function ComposerBar({ onClose, low }: { onClose?: () => void; low?: boolean }) {
  const profiles = useStore((s) => s.profiles)
  const running = useStore((s) => s.runId !== null)
  const openSettings = useStore((s) => s.openSettings)
  // selected pictures (image nodes, or image generations that have a result), as plain strings:
  // dragging nodes around must not re-render the bar
  const selected = useStore(useShallow((s) => s.nodes.filter((n) => n.selected && (n.type === 'image' || n.type === 'image-gen')).flatMap((n) => {
    const v = n.type === 'image' ? (n.data.assetId ? { assetId: n.data.assetId, mime: n.data.mime ?? 'image/png' } : undefined)
      : s.runStates[n.id]?.outputs?.out?.find((x): x is { type: 'image'; assetId: string; mime: string } => x.type === 'image')
    return v ? [[n.id, v.assetId, v.mime, n.data.label ?? ''].join('\u0000')] : []
  })))
  const { freeSpot } = useAddNode()
  const { screenToFlowPosition } = useReactFlow()
  const [settings, setSettingsState] = useState(loadSettings)
  const set = (patch: Partial<Settings>) => setSettingsState((cur) => { const next = { ...cur, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* blocked */ } return next })
  const [prompt, setPrompt] = useState('')
  const [uploads, setUploads] = useState<Ref[]>([])
  const [skipped, setSkipped] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { kind, aspect, duration, count } = settings

  const ofKind = profiles.filter((p) => p.kind === kind)
  const [chosen, setChosen] = useState<Record<Kind, string | undefined>>({ image: undefined, video: undefined })
  const profile = ofKind.find((p) => p.id === chosen[kind]) ?? ofKind[0]

  const picked: Ref[] = useMemo(() => selected.map((row) => row.split('\u0000')).filter(([id]) => !skipped.includes(id!))
    .map(([nodeId, assetId, mime, name]) => ({ nodeId, assetId: assetId!, mime: mime!, name: name || undefined })), [selected, skipped])
  const refs = [...picked, ...uploads]
  const usedRefs = kind === 'video' ? refs.slice(0, 2) : refs
  const refRole = (i: number) => (kind === 'video' ? (i === 0 ? '首帧' : '尾帧') : '参考')
  const refsUnsupported = kind === 'image' && refs.length > 0 && profile?.adapter === 'openai-compat'
  const cost = profile?.cost ? `约 ${money(profile.cost.amount * count)} ${profile.cost.currency}` : `${count} 次调用`

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files).filter((x) => x.type.startsWith('image/')).slice(0, 4)) {
        const a = await api.uploadAsset(f)
        setUploads((u) => [...u, { assetId: a.id, mime: a.mime, name: f.name }])
      }
    } catch (e) { useStore.getState().showToast(`上传失败：${(e as Error).message}`, { tone: 'error' }) } finally { setUploading(false) }
  }

  function generate() {
    const text = prompt.trim()
    if (!text || !profile) return
    const st = useStore.getState()
    const type = kind === 'image' ? 'image-gen' : 'video-gen'
    // the upper part of the view: the bar covers the bottom
    const el = document.querySelector('.canvas')?.getBoundingClientRect()
    const at = freeSpot(el ? screenToFlowPosition({ x: el.left + el.width / 2 - 150, y: el.top + Math.max(24, el.height * 0.12) }) : undefined)
    const params: Record<string, unknown> = { aspect_ratio: aspect || undefined, count: count > 1 ? count : undefined }
    if (kind === 'video' && duration) params.duration = duration
    const gen: CanvasNode = {
      id: `n_${uid()}`, type, position: at,
      data: { label: text.length > 16 ? `${text.slice(0, 16)}…` : text, profileId: profile.id, text, params },
    }
    const add: CanvasNode[] = [gen]
    const edges: Edge[] = []
    usedRefs.forEach((r, i) => {
      let source = r.nodeId
      if (!source) {
        const img: CanvasNode = { id: `n_${uid()}`, type: 'image', position: { x: at.x - 340, y: at.y + i * 280 }, data: { assetId: r.assetId, mime: r.mime, label: r.name ?? refRole(i) } }
        add.push(img)
        source = img.id
      }
      edges.push({ id: `e_${uid()}`, source, sourceHandle: 'out', target: gen.id, targetHandle: kind === 'image' ? 'ref' : i === 0 ? 'first' : 'last' })
    })
    // not selected: a selected picture would become the next generation's reference
    st.insertGraph(add, edges, false)
    // used from the empty canvas: keep the bar once the canvas has nodes
    if (!st.composerOpen) st.setComposerOpen(true)
    setUploads([])
    setSkipped([])
    st.queueRun([gen.id])
  }

  const kinds: [Kind, string][] = [['image', '图片'], ['video', '视频']]
  return (
    <div className={`composer${low ? ' low' : ''}`} role="form" aria-label="生成栏" data-testid="composer">
      {refs.length > 0 && (
        <div className="cmp-refs" aria-label="参考图">
          {refs.map((r, i) => (
            <span key={`${r.nodeId ?? r.assetId}-${i}`} className={`cmp-ref${kind === 'video' && i > 1 ? ' unused' : ''}`} title={kind === 'video' && i > 1 ? '视频只用前两张（首帧、尾帧）' : r.name}>
              <img src={assetUrl(r.assetId)} alt="" />
              <span className="cmp-ref-role">{kind === 'video' && i > 1 ? '不使用' : refRole(i)}</span>
              <button type="button" aria-label="不用这张" onClick={() => (r.nodeId ? setSkipped((s) => [...s, r.nodeId!]) : setUploads((u) => u.filter((x) => x !== r)))}><X /></button>
            </span>
          ))}
          {refsUnsupported && <span className="cmp-note">这个模型（OpenAI 兼容接口）不接受参考图</span>}
        </div>
      )}
      <div className="cmp-main">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} data-testid="composer-prompt"
          placeholder={kind === 'video' ? '描述画面里发生什么：主体、动作、镜头……（Enter 生成，Shift Enter 换行）' : '描述你想生成的画面……（Enter 生成，Shift Enter 换行）'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); generate() }
          }} />
      </div>
      {optimizing && (
        <PromptOptimizer kind={kind} targetProfileId={profile?.id} prompt={prompt}
          fromImage={kind === 'video' && usedRefs.length > 0} imageIds={usedRefs.map((r) => r.assetId)}
          autoStart onClose={() => setOptimizing(false)} onApply={(t) => setPrompt(t)} />
      )}
      <div className="cmp-bar">
        <div className="seg2 sm cmp-kind" role="radiogroup" aria-label="生成类型">
          {kinds.map(([k, label]) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => set({ kind: k })} data-testid={`composer-kind-${k}`}>{label}</button>
          ))}
        </div>
        {profile ? (
          <select className="cmp-sel model" title="模型" value={profile.id} onChange={(e) => setChosen((c) => ({ ...c, [kind]: e.target.value }))} aria-label="模型" data-testid="composer-model">
              {ofKind.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
        ) : (
          <button type="button" className="btn sm" onClick={() => openSettings({ tab: 'profiles', addKind: kind })} data-testid="composer-add-model">添加{kind === 'image' ? '图片' : '视频'}模型</button>
        )}
        <select className="cmp-sel short" title="画面比例" value={aspect} onChange={(e) => set({ aspect: e.target.value })} aria-label="画面比例" data-testid="composer-aspect">
            <option value="">默认比例</option>
            {ASPECT_RATIOS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        {kind === 'video' && (
          <select className="cmp-sel short" title="时长" value={String(duration)} onChange={(e) => set({ duration: e.target.value ? Number(e.target.value) : '' })} aria-label="时长" data-testid="composer-duration">
              <option value="">默认时长</option>
              {VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d} 秒</option>)}
            </select>
        )}
        <select className="cmp-sel tiny" title="一次生成几个" value={count} onChange={(e) => set({ count: Number(e.target.value) })} aria-label="数量" data-testid="composer-count">
            {VARIATION_COUNTS.map((n) => <option key={n} value={n}>{n} 个</option>)}
          </select>
        <button type="button" className="btn ghost sm icon" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="添加参考图" title={kind === 'video' ? '添加首帧 / 尾帧（也可以先在画布上选中图片节点）' : '添加参考图（也可以先在画布上选中图片节点）'} data-testid="composer-upload"><ImagePlus /></button>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
        <button type="button" className={`btn ghost sm${optimizing ? ' on' : ''}`} onClick={() => setOptimizing((o) => !o)} aria-pressed={optimizing} data-testid="composer-optimize">优化</button>
        <span className="cmp-spacer" />
        <span className="cmp-cost" data-testid="composer-cost">{cost}</span>
        <button type="button" className="btn primary sm" disabled={!prompt.trim() || !profile} onClick={generate} data-testid="composer-generate">
          <ArrowUp />{running ? '排队生成' : '生成'}
        </button>
      </div>
      {onClose && <button type="button" className="btn ghost xs icon cmp-close" onClick={onClose} aria-label="收起生成栏" title="收起（底部工具条可以再打开）"><X /></button>}
    </div>
  )
}
