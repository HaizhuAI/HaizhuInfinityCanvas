import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Cable, CornerDownLeft, LayoutTemplate, Search } from 'lucide-react'
import { CATEGORY_LABEL, NODE_TYPE_MAP, NODE_TYPES, canConnect, type NodeTypeDef, type PortType } from '@hzc/core'
import { PORT_LABEL } from './icons'
import { CATEGORY_COLOR, KIND_COLOR, KIND_ICON, KIND_LABEL, KIND_TO_NODE, NODE_ICON } from './icons'
import { enterOverlay } from './motion'
import { useStore } from './store'
import { TEMPLATES } from './templates'
import { useAddNode } from './useAddNode'

interface Item { key: string; group: string; label: string; desc: string; color: string; Icon: React.ComponentType; run: () => void; terms: string }

/** the port of `def` a wire of type `t` can attach to: an input when dragging from an output, else an output (exact type first) */
function portFor(def: NodeTypeDef, t: PortType, fromOutput: boolean): string | undefined {
  const ports = fromOutput ? def.inputs : def.outputs
  const fits = ports.filter((p) => (fromOutput ? canConnect(t, p.type) : canConnect(p.type, t)))
  return (fits.find((p) => p.type === t) ?? fits[0])?.id
}

/** "/" (or double-click on empty canvas): search and add any node, model, director skill or template. */
export function CommandPalette() {
  // mounted only while open: the body follows every canvas edit, which a closed palette must not
  const open = useStore((s) => s.palette.open)
  return open ? <PaletteBody /> : null
}

function PaletteBody() {
  const { open, at, connect } = useStore((s) => s.palette)
  const canvasNodes = useStore((s) => s.nodes)
  const close = useStore((s) => s.closePalette)
  const profiles = useStore((s) => s.profiles)
  const skills = useStore((s) => s.skills)
  const addNode = useStore((s) => s.addNode)
  const setNodeParam = useStore((s) => s.setNodeParam)
  const { addAt, addTemplate } = useAddNode()
  const { fitView, getZoom } = useReactFlow()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const backRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) { setQ(''); setSel(0); enterOverlay(panelRef.current, backRef.current) } }, [open])

  // dragging a wire: the type of the port it came from
  const from = connect ? (() => {
    const n = canvasNodes.find((x) => x.id === connect.nodeId)
    const def = n ? NODE_TYPE_MAP[n.type ?? ''] : undefined
    const port = def ? (connect.handleType === 'source' ? def.outputs : def.inputs).find((p) => p.id === connect.handleId) : undefined
    return port && n ? { port, nodeLabel: n.data.label ?? def!.label, out: connect.handleType === 'source' } : undefined
  })() : undefined

  const items = useMemo<Item[]>(() => {
    const out: Item[] = []
    // add a node; when a wire is being dropped, connect it to the new node's matching port
    const add = (type: string, profileId?: string) => {
      const id = addAt({ type, profileId }, at)
      if (!id || !from || !connect) return id
      const port = portFor(NODE_TYPE_MAP[type]!, from.port.type, from.out)
      const c = from.out
        ? { source: connect.nodeId, sourceHandle: connect.handleId, target: id, targetHandle: port ?? null }
        : { source: id, sourceHandle: port ?? null, target: connect.nodeId, targetHandle: connect.handleId }
      const st = useStore.getState()
      if (port && st.isValidConnection(c)) st.onConnect(c)
      requestAnimationFrame(() => requestAnimationFrame(() => void fitView({ nodes: [{ id }, { id: connect.nodeId }], padding: 0.25, maxZoom: getZoom(), minZoom: 0.5, duration: 300 })))
      return id
    }
    const fits = (type: string) => !from || !!portFor(NODE_TYPE_MAP[type]!, from.port.type, from.out)
    for (const p of profiles) {
      if (!fits(KIND_TO_NODE[p.kind])) continue
      out.push({ key: `p:${p.id}`, group: '我的模型智能体', label: p.name, desc: `${KIND_LABEL[p.kind]} · ${p.model}`, color: KIND_COLOR[p.kind], Icon: KIND_ICON[p.kind],
        run: () => add(KIND_TO_NODE[p.kind], p.id), terms: `${p.name} ${p.model} ${KIND_LABEL[p.kind]}` })
    }
    for (const s of fits('director') ? skills.filter((x) => x.kind === 'director') : []) {
      out.push({ key: `s:${s.name}`, group: '导演 Skill', label: s.label, desc: s.description, color: CATEGORY_COLOR.tool, Icon: NODE_ICON.director!,
        run: () => { const id = add('director'); if (id) setNodeParam(id, 'skill', s.name) }, terms: `${s.label} ${s.name} ${s.description} 导演 分镜` })
    }
    for (const s of fits('image-reverse') ? skills.filter((x) => x.kind === 'image-reverse') : []) {
      out.push({ key: `rs:${s.name}`, group: '反推 Skill', label: s.label, desc: s.description, color: CATEGORY_COLOR.tool, Icon: NODE_ICON['image-reverse']!,
        run: () => { const id = add('image-reverse'); if (id) setNodeParam(id, 'skill', s.name) }, terms: `${s.label} ${s.name} ${s.description} 反推 提示词 reverse prompt` })
    }
    for (const n of NODE_TYPES) {
      if (!fits(n.type)) continue
      out.push({ key: `n:${n.type}`, group: CATEGORY_LABEL[n.category], label: n.label, desc: n.description, color: CATEGORY_COLOR[n.category], Icon: NODE_ICON[n.type]!,
        run: () => add(n.type), terms: `${n.label} ${n.description} ${n.type}` })
    }
    if (!from) for (const t of TEMPLATES) {
      out.push({ key: `t:${t.id}`, group: '示例模板', label: t.name, desc: t.description, color: 'var(--accent)', Icon: LayoutTemplate,
        run: () => addTemplate(t.graph()), terms: `${t.name} ${t.description} 模板` })
    }
    return out
  }, [profiles, skills, at, addAt, addTemplate, setNodeParam, addNode, from?.port.id, from?.port.type, from?.out, connect?.nodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = q.trim().toLowerCase()
  // typing also finds nodes already on the canvas (jump to them)
  const jump: Item[] = query && !from ? canvasNodes.filter((n) => `${n.data.label ?? ''} ${NODE_TYPE_MAP[n.type ?? '']?.label ?? ''} ${n.data.text ?? ''}`.toLowerCase().includes(query)).slice(0, 8).map((n) => {
    const def = NODE_TYPE_MAP[n.type ?? '']!
    return { key: `c:${n.id}`, group: '画布上的节点', label: n.data.label ?? def.label, desc: `${def.label} · 跳转到这个节点`, color: CATEGORY_COLOR[def.category], Icon: NODE_ICON[def.type]!,
      run: () => useStore.getState().focusNode(n.id), terms: '' }
  }) : []
  const shown = query ? [...jump, ...items.filter((i) => i.terms.toLowerCase().includes(query))] : items
  useEffect(() => { setSel(0) }, [query])
  useEffect(() => { listRef.current?.querySelector('.palette-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  if (!open) return null
  const pick = (i: Item | undefined) => { if (!i) return; close(); i.run() }
  let lastGroup = ''

  return (
    <div className="palette-back" ref={backRef} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="palette" ref={panelRef} role="dialog" aria-label="快速添加">
        {from && (
          <div className="palette-connect" data-testid="palette-connect">
            <Cable aria-hidden="true" />
            <span>{from.out ? '连接「' : '为「'}{from.nodeLabel}」的「{from.port.label}」{from.out ? '输出' : '输入'}（{PORT_LABEL[from.port.type]}）：只列出能接上的节点，选中后自动连好</span>
          </div>
        )}
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
          <span style={{ marginLeft: 'auto' }}>{from ? '添加到松开连线的位置' : at ? '添加到双击位置' : '添加到视图中央'}</span>
        </div>
      </div>
    </div>
  )
}
