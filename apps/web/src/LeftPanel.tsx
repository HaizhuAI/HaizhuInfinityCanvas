import { useMemo, useRef, useState } from 'react'
import { AudioLines, ChevronRight, Image as ImageIcon, Info, Plus, Search, Upload, Video } from 'lucide-react'
import { CATEGORY_LABEL, NODE_TYPES, type NodeCategory } from '@hzc/core'
import { api, assetUrl } from './api'
import { mediaKind, startDrag } from './dnd'
import { CATEGORY_COLOR, KIND_COLOR, KIND_ICON, KIND_LABEL, KIND_TO_NODE, NODE_ICON } from './icons'
import { useStore } from './store'
import { useAddNode } from './useAddNode'

const CATS: NodeCategory[] = ['input', 'model', 'tool', 'output']

/** Models + all node types. Drag to place, click to add near the centre of the view. */
export function Library() {
  const profiles = useStore((s) => s.profiles)
  const openSettings = useStore((s) => s.openSettings)
  const { addAt } = useAddNode()
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const match = (...s: string[]) => !query || s.some((x) => x.toLowerCase().includes(query))
  const shownProfiles = useMemo(() => profiles.filter((p) => match(p.name, p.model, KIND_LABEL[p.kind])), [profiles, query]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="lpanel-head"><h2>组件库</h2></div>
      <div className="lsearch">
        <Search aria-hidden="true" />
        <input placeholder="搜索节点或模型" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索节点或模型" />
        <kbd title="在画布上按 / 打开快速添加">/</kbd>
      </div>
      <div className="lscroll">
        <details className="lsec" open>
          <summary>
            <ChevronRight className="chev" aria-hidden="true" />我的模型
            <button className="btn ghost xs icon" title="添加模型" aria-label="添加模型" onClick={(e) => { e.preventDefault(); openSettings({ addKind: 'llm' }) }} data-testid="lib-add-model"><Plus /></button>
          </summary>
          {profiles.length === 0 ? (
            <div className="lempty">
              接入你的文本、视觉、图片、视频与语音模型，它们会作为智能体出现在这里。
              <div><button className="btn primary sm" onClick={() => openSettings({ addKind: 'llm' })}><Plus />添加模型</button></div>
            </div>
          ) : (
            <div className="llist">
              {shownProfiles.map((p) => {
                const Icon = KIND_ICON[p.kind]
                return (
                  <div key={p.id} className="litem" draggable role="button" tabIndex={0} data-testid={`profile-${p.name}`} title={`${KIND_LABEL[p.kind]} · ${p.model}`}
                    onDragStart={(e) => startDrag(e, { type: KIND_TO_NODE[p.kind], profileId: p.id })}
                    onClick={() => addAt({ type: KIND_TO_NODE[p.kind], profileId: p.id })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addAt({ type: KIND_TO_NODE[p.kind], profileId: p.id }) } }}>
                    <span className="chip-ico" style={{ '--c': KIND_COLOR[p.kind] } as React.CSSProperties} aria-hidden="true"><Icon /></span>
                    <span className="txt"><span className="nm">{p.name}</span><span className="ds">{KIND_LABEL[p.kind]} · {p.model}</span></span>
                  </div>
                )
              })}
            </div>
          )}
        </details>
        {CATS.map((c) => {
          const items = NODE_TYPES.filter((n) => n.category === c && match(n.label, n.description, n.type))
          if (!items.length) return null
          return (
            <details className="lsec" open key={c}>
              <summary><ChevronRight className="chev" aria-hidden="true" />{CATEGORY_LABEL[c]}<span className="count">{items.length}</span></summary>
              {items.map((n) => {
                const Icon = NODE_ICON[n.type]!
                return (
                  <div key={n.type} className="litem" draggable role="button" tabIndex={0} data-testid={`palette-${n.type}`} title={n.description}
                    onDragStart={(e) => startDrag(e, { type: n.type })} onClick={() => addAt({ type: n.type })}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addAt({ type: n.type }) } }}>
                    <span className="chip-ico sm" style={{ '--c': CATEGORY_COLOR[c] } as React.CSSProperties} aria-hidden="true"><Icon /></span>
                    <span className="txt"><span className="nm">{n.label}</span><span className="ds">{n.description}</span></span>
                  </div>
                )
              })}
            </details>
          )
        })}
      </div>
      <div className="lfoot"><Info aria-hidden="true" />拖入画布，或单击 / 回车添加</div>
    </>
  )
}

type Filter = 'all' | 'image' | 'video' | 'audio'

/** Everything uploaded or generated, newest first. Drag onto the canvas (or click) to reuse. */
export function Assets() {
  const assets = useStore((s) => s.assets)
  const loadAssets = useStore((s) => s.loadAssets)
  const showToast = useStore((s) => s.showToast)
  const openLightbox = useStore((s) => s.openLightbox)
  const { addAt } = useAddNode()
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const shown = assets.filter((a) => filter === 'all' || a.mime.startsWith(`${filter}/`))

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try { for (const f of Array.from(files)) await api.uploadAsset(f); await loadAssets(); showToast(`已导入 ${files.length} 个素材`) }
    catch (e) { showToast(`导入失败：${(e as Error).message}`) } finally { setBusy(false) }
  }

  const FILTERS: [Filter, string][] = [['all', '全部'], ['image', '图片'], ['video', '视频'], ['audio', '音频']]
  return (
    <>
      <div className="lpanel-head">
        <h2>素材库</h2>
        <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" hidden onChange={(e) => void upload(e.target.files)} data-testid="assets-upload" />
        <button className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}><Upload />{busy ? '导入中…' : '导入'}</button>
      </div>
      <div className="chips" role="tablist" aria-label="素材类型">
        {FILTERS.map(([k, l]) => <button key={k} role="tab" aria-selected={filter === k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <div className="lscroll">
        {shown.length === 0 ? (
          <div className="lempty">还没有素材。导入图片、视频或音频，或运行生成节点——结果会自动收进这里。</div>
        ) : (
          <div className="agrid" data-testid="asset-grid">
            {shown.map((a) => {
              const kind = mediaKind(a.mime)!
              const payload = { type: kind, assetId: a.id, mime: a.mime, name: a.name }
              const add = () => addAt({ type: kind }, undefined, { assetId: a.id, mime: a.mime, label: a.name })
              return (
                <button key={a.id} className={`acell${kind === 'audio' ? ' audio' : ''}`} draggable title={`${a.name} · 单击添加到画布，双击预览`}
                  onDragStart={(e) => startDrag(e, payload)} onClick={add}
                  onDoubleClick={() => kind !== 'audio' && openLightbox({ assetId: a.id, mime: a.mime, name: a.name })} data-testid="asset-cell">
                  {kind === 'image' && <img src={assetUrl(a.id)} alt={a.name} loading="lazy" draggable={false} />}
                  {kind === 'video' && <video src={assetUrl(a.id)} muted preload="metadata" />}
                  {kind === 'audio' && <AudioLines aria-hidden="true" />}
                  <span className="badge">{kind === 'image' ? <ImageIcon aria-hidden="true" /> : kind === 'video' ? <Video aria-hidden="true" /> : <AudioLines aria-hidden="true" />}{kind === 'audio' ? a.name.slice(0, 14) : ''}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="lfoot"><Info aria-hidden="true" />单击添加 · 拖入画布 · 双击预览</div>
    </>
  )
}
