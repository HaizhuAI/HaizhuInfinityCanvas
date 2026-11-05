import { useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, LayoutTemplate, Search } from 'lucide-react'
import { CATEGORY_LABEL, NODE_TYPES } from '@hzc/core'
import { CATEGORY_COLOR, KIND_COLOR, KIND_ICON, KIND_LABEL, KIND_TO_NODE, NODE_ICON } from './icons'
import { enterOverlay } from './motion'
import { useStore } from './store'
import { TEMPLATES } from './templates'
import { useAddNode } from './useAddNode'

interface Item { key: string; group: string; label: string; desc: string; color: string; Icon: React.ComponentType; run: () => void; terms: string }

/** "/" (or double-click on empty canvas): search and add any node, model, director skill or template. */
export function CommandPalette() {
  const { open, at } = useStore((s) => s.palette)
  const close = useStore((s) => s.closePalette)
  const profiles = useStore((s) => s.profiles)
  const skills = useStore((s) => s.skills)
  const addNode = useStore((s) => s.addNode)
  const setNodeParam = useStore((s) => s.setNodeParam)
  const { addAt, addTemplate } = useAddNode()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const backRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setQ(''); setSel(0); enterOverlay(panelRef.current, backRef.current) } }, [open])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    for (const p of profiles) {
      out.push({ key: `p:${p.id}`, group: '我的模型智能体', label: p.name, desc: `${KIND_LABEL[p.kind]} · ${p.model}`, color: KIND_COLOR[p.kind], Icon: KIND_ICON[p.kind],
        run: () => addAt({ type: KIND_TO_NODE[p.kind], profileId: p.id }, at), terms: `${p.name} ${p.model} ${KIND_LABEL[p.kind]}` })
    }
    for (const s of skills.filter((x) => x.metadata?.['hzc-kind'] === 'director')) {
      out.push({ key: `s:${s.name}`, group: '导演 Skill', label: s.label, desc: s.description, color: CATEGORY_COLOR.tool, Icon: NODE_ICON.director!,
        run: () => {
          const before = new Set(useStore.getState().nodes.map((n) => n.id))
          addAt({ type: 'director' }, at)
          const created = useStore.getState().nodes.find((n) => !before.has(n.id))
          if (created) setNodeParam(created.id, 'skill', s.name)
        }, terms: `${s.label} ${s.name} ${s.description} 导演 分镜` })
    }
    for (const n of NODE_TYPES) {
      out.push({ key: `n:${n.type}`, group: CATEGORY_LABEL[n.category], label: n.label, desc: n.description, color: CATEGORY_COLOR[n.category], Icon: NODE_ICON[n.type]!,
        run: () => addAt({ type: n.type }, at), terms: `${n.label} ${n.description} ${n.type}` })
    }
    for (const t of TEMPLATES) {
      out.push({ key: `t:${t.id}`, group: '示例模板', label: t.name, desc: t.description, color: 'var(--accent)', Icon: LayoutTemplate,
        run: () => addTemplate(t.graph()), terms: `${t.name} ${t.description} 模板` })
    }
    return out
  }, [profiles, skills, at, addAt, addTemplate, setNodeParam, addNode]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = q.trim().toLowerCase()
  const shown = query ? items.filter((i) => i.terms.toLowerCase().includes(query)) : items
  useEffect(() => { setSel(0) }, [query])
  useEffect(() => { listRef.current?.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  if (!open) return null
  const pick = (i: Item | undefined) => { if (!i) return; close(); i.run() }
  let lastGroup = ''

  return (
    <div className="palette-back" ref={backRef} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="palette" ref={panelRef} role="dialog" aria-label="快速添加">
        <div className="palette-input">
          <Search />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索节点、模型、导演 Skill 或模板…" aria-label="搜索" data-testid="palette-input"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, shown.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); pick(shown[sel]) }
              else if (e.key === 'Escape') { e.preventDefault(); close() }
            }} />
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {shown.length === 0 && <div className="palette-empty">没有匹配「{q}」的项目</div>}
          {shown.map((i, idx) => {
            const head = i.group !== lastGroup ? <div className="palette-group" key={`g:${i.group}`}>{i.group}</div> : null
            lastGroup = i.group
            return [
              head,
              <button key={i.key} role="option" aria-selected={idx === sel} className={`palette-item${idx === sel ? ' on' : ''}`}
                onMouseMove={() => setSel(idx)} onClick={() => pick(i)} data-testid={`palette-item-${i.key}`}>
                <span className="chip-ico sm" style={{ '--c': i.color } as React.CSSProperties}><i.Icon /></span>
                <span className="txt"><div className="nm">{i.label}</div><div className="ds">{i.desc}</div></span>
                <CornerDownLeft className="enter" style={{ width: 14, height: 14, color: 'var(--muted)' }} />
              </button>,
            ]
          })}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>Enter</kbd>添加</span><span><kbd>Esc</kbd>关闭</span>
          <span style={{ marginLeft: 'auto' }}>{at ? '添加到双击位置' : '添加到视图中央'}</span>
        </div>
      </div>
    </div>
  )
}
