import { useMemo, useState } from 'react'
import { ChevronRight, Info, Plus, Search } from 'lucide-react'
import { CATEGORY_LABEL, NODE_TYPES, type NodeCategory } from '@hzc/core'
import { CATEGORY_COLOR, KIND_COLOR, KIND_ICON, KIND_LABEL, KIND_TO_NODE, NODE_ICON } from './icons'
import { useStore } from './store'
import { useAddNode, type AddPayload } from './useAddNode'

export const DND_MIME = 'application/x-hzc-node'

function startDrag(e: React.DragEvent, payload: AddPayload) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
}

const CATS: NodeCategory[] = ['input', 'model', 'tool', 'output']

export function Sidebar() {
  const profiles = useStore((s) => s.profiles)
  const openSettings = useStore((s) => s.setSettingsOpen)
  const { addAt } = useAddNode()
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  const match = (...s: string[]) => !query || s.some((x) => x.toLowerCase().includes(query))
  const shownProfiles = useMemo(() => profiles.filter((p) => match(p.name, p.model, KIND_LABEL[p.kind])), [profiles, query]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className="sidebar">
      <div className="sb-search">
        <Search />
        <input placeholder="搜索节点或模型…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索节点或模型" />
        <kbd title="在画布上按 / 打开快速添加">/</kbd>
      </div>

      <div className="sb-scroll">
        <details className="sb-section" open>
          <summary>
            <ChevronRight className="chev" />我的模型智能体
            <button className="btn ghost sm icon" title="添加模型档案" aria-label="添加模型档案" onClick={(e) => { e.preventDefault(); openSettings(true) }}><Plus /></button>
          </summary>
          {profiles.length === 0 ? (
            <div className="sb-empty">
              还没有模型。添加你的视频、图片、视觉、文本或语音模型后，它们会出现在这里。
              <div><button className="btn primary sm" onClick={() => openSettings(true)}><Plus />添加模型档案</button></div>
            </div>
          ) : (
            <div className="sb-list">
              {shownProfiles.map((p) => {
                const Icon = KIND_ICON[p.kind]
                return (
                  <div key={p.id} className="sb-item" draggable data-testid={`profile-${p.name}`} title={`拖入画布，或点击添加\n${KIND_LABEL[p.kind]} · ${p.model}`}
                    onDragStart={(e) => startDrag(e, { type: KIND_TO_NODE[p.kind], profileId: p.id })}
                    onClick={() => addAt({ type: KIND_TO_NODE[p.kind], profileId: p.id })}>
                    <span className="chip-ico" style={{ '--c': KIND_COLOR[p.kind] } as React.CSSProperties}><Icon /></span>
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
            <details className="sb-section" open key={c}>
              <summary><ChevronRight className="chev" />{CATEGORY_LABEL[c]}<span className="count">{items.length}</span></summary>
              <div className="sb-list">
                {items.map((n) => {
                  const Icon = NODE_ICON[n.type]!
                  return (
                    <div key={n.type} className="sb-item" draggable data-testid={`palette-${n.type}`} title="拖入画布，或点击添加"
                      onDragStart={(e) => startDrag(e, { type: n.type })} onClick={() => addAt({ type: n.type })}>
                      <span className="chip-ico sm" style={{ '--c': CATEGORY_COLOR[c] } as React.CSSProperties}><Icon /></span>
                      <span className="txt"><span className="nm">{n.label}</span><span className="ds">{n.description}</span></span>
                    </div>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>

      <div className="sb-foot"><Info />拖入画布，或单击添加到视图中</div>
    </aside>
  )
}
