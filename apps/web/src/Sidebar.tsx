import { useMemo, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ChevronRight, Info, Plus, Search } from 'lucide-react'
import { CATEGORY_LABEL, NODE_TYPES, type NodeCategory } from '@hzc/core'
import { CATEGORY_COLOR, KIND_COLOR, KIND_ICON, KIND_LABEL, KIND_TO_NODE, NODE_ICON } from './icons'
import { useStore } from './store'

export const DND_MIME = 'application/x-hzc-node'

type Payload = { type: string; profileId?: string }

function startDrag(e: React.DragEvent, payload: Payload) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
}

const CATS: NodeCategory[] = ['input', 'model', 'tool', 'output']

export function Sidebar() {
  const profiles = useStore((s) => s.profiles)
  const addNode = useStore((s) => s.addNode)
  const openSettings = useStore((s) => s.setSettingsOpen)
  const { screenToFlowPosition, getNodes } = useReactFlow()
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  /** click = add at the centre of the visible canvas (drag = add where dropped) */
  function addAtCenter(p: Payload) {
    const el = document.querySelector('.canvas')?.getBoundingClientRect()
    if (!el) return
    const W = 300, H = 240, GAP = 24
    const center = screenToFlowPosition({ x: el.left + el.width / 2 - W / 2, y: el.top + el.height / 2 - H / 2 })
    const tl = screenToFlowPosition({ x: el.left, y: el.top })
    const br = screenToFlowPosition({ x: el.right, y: el.bottom })
    const boxes = getNodes().map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? W, h: n.measured?.height ?? H }))
    const free = (x: number, y: number) => !boxes.some((b) => x < b.x + b.w + GAP && x + W + GAP > b.x && y < b.y + b.h + GAP && y + H + GAP > b.y)
    // nearest free slot to the centre that is still inside the visible canvas; else cascade
    const slots: { x: number; y: number; d: number }[] = []
    for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) {
      const x = center.x + i * (W / 2 + GAP), y = center.y + j * (H / 2 + GAP)
      if (x >= tl.x && y >= tl.y && x + W <= br.x && y + H <= br.y) slots.push({ x, y, d: Math.hypot(i * 1.2, j) })
    }
    slots.sort((a, b) => a.d - b.d)
    let { x, y } = slots.find((c) => free(c.x, c.y)) ?? center
    for (let k = 0; k < 40 && !free(x, y); k++) { x += 48; y += 36 }
    addNode(p.type, { x, y }, p.profileId)
  }

  const match = (...s: string[]) => !query || s.some((x) => x.toLowerCase().includes(query))
  const shownProfiles = useMemo(() => profiles.filter((p) => match(p.name, p.model, KIND_LABEL[p.kind])), [profiles, query]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className="sidebar">
      <div className="sb-search">
        <Search />
        <input placeholder="搜索节点或模型…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜索节点或模型" />
      </div>

      <div className="sb-scroll">
        <details className="sb-section" open>
          <summary>
            <ChevronRight className="chev" />我的模型智能体
            <button className="btn ghost sm icon" title="添加模型档案" onClick={(e) => { e.preventDefault(); openSettings(true) }}><Plus /></button>
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
                    onClick={() => addAtCenter({ type: KIND_TO_NODE[p.kind], profileId: p.id })}>
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
                      onDragStart={(e) => startDrag(e, { type: n.type })} onClick={() => addAtCenter({ type: n.type })}>
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

      <div className="sb-foot"><Info />拖到画布，或单击添加到视图中央</div>
    </aside>
  )
}
