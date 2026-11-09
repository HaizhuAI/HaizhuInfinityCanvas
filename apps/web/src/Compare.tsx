import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Crosshair, GitCompareArrows, Pause, Play, Plus, Trophy, X } from 'lucide-react'
import { MAX_COMPARE, NODE_TYPE_MAP, type PortValue } from '@hzc/core'
import { assetUrl } from './api'
import { KIND_LABEL } from './icons'
import { enterOverlay } from './motion'
import { StatusPill } from './CanvasNode'
import { useEscape } from './Overlays'
import { useStore } from './store'
import { useShallow } from 'zustand/react/shallow'
import { undo } from './history'

/**
 * Multi-model comparison: run one node with several models (same inputs, prompt and parameters),
 * look at the results side by side, keep the one you like.
 */

/** Choose which models to compare a node with. */
export function CompareSetup() {
  const req = useStore((s) => s.compareSetup)
  return req ? <SetupBody nodeId={req.nodeId} /> : null
}

function SetupBody({ nodeId }: { nodeId: string }) {
  const node = useStore((s) => s.nodes.find((n) => n.id === nodeId))
  const group = node?.data.compare
  const inGroup = useStore(useShallow((s) => (group ? s.nodes.filter((n) => n.data.compare === group).map((n) => n.data.profileId ?? '') : [])))
  const profiles = useStore((s) => s.profiles)
  const running = useStore((s) => s.runId !== null)
  const { openCompareSetup, addCompareModels, runNodes, showNodes, openSettings, showToast } = useStore.getState()
  const close = () => openCompareSetup(null)
  const def = node ? NODE_TYPE_MAP[node.type ?? ''] : undefined
  const kind = def?.modelKind
  const have = new Set(group ? inGroup : node?.data.profileId ? [node.data.profileId] : [])
  const options = profiles.filter((p) => p.kind === kind)
  const [picked, setPicked] = useState<string[]>([])
  const room = MAX_COMPARE - Math.max(1, have.size)
  const backRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => { enterOverlay(panelRef.current, backRef.current) }, [])
  useEscape(close)
  if (!node || !def || !kind) return null

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room ? [...p, id] : p))
  const create = (run: boolean) => {
    const ids = addCompareModels(nodeId, picked)
    close()
    showNodes(ids)
    if (run) setTimeout(() => void runNodes(ids), 450)
    else showToast(`已添加 ${picked.length} 个对比节点，运行后可并排查看`)
  }
  const label = node.data.label ?? def.label

  return (
    <div className="modal-back" ref={backRef} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="modal confirm" ref={panelRef} role="dialog" aria-label="多模型对比" data-testid="compare-setup">
        <div className="modal-head"><GitCompareArrows aria-hidden="true" /><h2>多模型对比 · {label}</h2><button className="btn icon ghost" onClick={close} aria-label="关闭"><X /></button></div>
        <div className="pane">
          <p className="muted" style={{ marginTop: 0 }}>用同样的输入、提示词和参数，让几个{KIND_LABEL[kind]}各生成一次，放在一起比较，留下最满意的那个。一次最多比较 {MAX_COMPARE} 个。</p>
          {options.length < 2 ? (
            <div className="hint"><span>至少需要两个{KIND_LABEL[kind]}档案才能比较。</span>
              <button className="btn sm" onClick={() => { close(); openSettings({ addKind: kind }) }} data-testid="compare-add-model"><Plus />添加{KIND_LABEL[kind]}</button></div>
          ) : (
            <div className="est-list" role="group" aria-label="选择要比较的模型">
              {options.map((p) => {
                const current = have.has(p.id)
                const on = current || picked.includes(p.id)
                const full = !on && picked.length >= room
                return (
                  <label key={p.id} className={`est-row cmp-pick${on ? ' on' : ''}${full ? ' off' : ''}`} data-testid="compare-option">
                    <input type="checkbox" checked={on} disabled={current || full} onChange={() => toggle(p.id)} aria-label={p.name} />
                    <div className="txt"><div className="nm">{p.name}</div><div className="ds">{p.model}{p.cost ? ` · ${p.cost.amount} ${p.cost.currency}/次` : ''}</div></div>
                    {current && <span className="tag">{group ? '已在对比中' : '当前'}</span>}
                  </label>
                )
              })}
            </div>
          )}
          {room <= 0 && <div className="hint">这个对比已经有 {MAX_COMPARE} 个模型了。</div>}
        </div>
        <div className="foot">
          <button className="btn" onClick={close}>取消</button>
          <button className="btn" disabled={!picked.length} onClick={() => create(false)} data-testid="compare-create">添加到画布</button>
          <button className="btn primary" disabled={!picked.length || running} onClick={() => create(true)} data-testid="compare-create-run"><Play />添加并运行</button>
        </div>
      </div>
    </div>
  )
}

type Media = Extract<PortValue, { type: 'image' | 'video' | 'audio' }>

/** Results of 2–4 nodes side by side; in a comparison, keep one with 选用这个. */
export function CompareView() {
  const req = useStore((s) => s.compareView)
  return req ? <ViewBody ids={req.ids} /> : null
}

function ViewBody({ ids }: { ids: string[] }) {
  const nodes = useStore((s) => s.nodes)
  const runStates = useStore((s) => s.runStates)
  const profiles = useStore((s) => s.profiles)
  const running = useStore((s) => s.runId !== null)
  const { openCompareView, pickCompare, focusNode, showToast } = useStore.getState()
  const close = () => openCompareView(null)
  const cols = useMemo(() => ids.flatMap((id) => { const n = nodes.find((x) => x.id === id); return n ? [n] : [] }), [ids, nodes])
  const ref = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => { enterOverlay(ref.current) }, [])
  useEscape(close)
  useEffect(() => { if (cols.length < 2) close() }, [cols.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const videos = () => Array.from(stage.current?.querySelectorAll('video') ?? [])
  const playAll = () => {
    const vs = videos()
    if (playing) { vs.forEach((v) => v.pause()); setPlaying(false); return }
    vs.forEach((v) => { v.currentTime = 0; void v.play().catch(() => undefined) })
    setPlaying(true)
  }
  const hasVideo = cols.some((n) => (runStates[n.id]?.outputs?.out ?? []).some((v) => v.type === 'video'))
  const group = cols[0]?.data.compare
  const sameGroup = !!group && cols.every((n) => n.data.compare === group)

  return (
    <div className="lightbox compare" ref={ref} role="dialog" aria-label="并排比较" data-testid="compare-view" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="lightbox-bar">
        <span className="nm"><GitCompareArrows aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />并排比较 · {cols.length} 个结果</span>
        {hasVideo && <button className="btn sm" onClick={playAll} data-testid="compare-play">{playing ? <Pause /> : <Play />}{playing ? '全部暂停' : '从头同时播放'}</button>}
        <button className="btn sm icon" onClick={close} aria-label="关闭比较"><X /></button>
      </div>
      <div className="cmp-stage" ref={stage} style={{ '--cols': cols.length } as React.CSSProperties}>
        {cols.map((n, i) => {
          const rs = runStates[n.id]
          const out = n.type === 'preview' ? rs?.outputs?.in : rs?.outputs?.out
          const media = (out ?? []).find((v): v is Media => v.type === 'image' || v.type === 'video' || v.type === 'audio')
          const text = (out ?? []).find((v) => v.type === 'text') as Extract<PortValue, { type: 'text' }> | undefined
          const p = profiles.find((x) => x.id === n.data.profileId)
          const took = rs?.startedAt && rs.finishedAt ? (Date.parse(rs.finishedAt) - Date.parse(rs.startedAt)) / 1000 : undefined
          return (
            <section className="cmp-col" key={n.id} data-testid="compare-col">
              <header>
                <span className="cmp-letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
                <div className="txt"><div className="nm">{p?.name ?? n.data.label ?? '未选择模型'}</div><div className="ds">{p?.model ?? NODE_TYPE_MAP[n.type ?? '']?.label}{took !== undefined ? ` · 用时 ${took < 0.1 ? '不到 0.1' : took.toFixed(1)} 秒` : ''}{p?.cost ? ` · ${p.cost.amount} ${p.cost.currency}/次` : ''}</div></div>
                {rs && rs.status !== 'done' && rs.status !== 'cached' && <StatusPill status={rs.status} error={rs.error} />}
              </header>
              <div className="cmp-media">
                {media ? (
                  media.type === 'image' ? <img src={assetUrl(media.assetId)} alt={p?.name ?? ''} />
                    : media.type === 'video' ? <video src={assetUrl(media.assetId)} controls loop playsInline preload="metadata" />
                      : <audio src={assetUrl(media.assetId)} controls preload="metadata" />
                ) : text ? <pre>{text.text}</pre>
                  : <div className="cmp-empty">{rs?.status === 'running' ? '生成中…' : rs?.error ?? '还没有结果，运行后在这里比较'}</div>}
              </div>
              <footer>
                {sameGroup && (
                  <button className="btn sm primary" disabled={running} data-testid="compare-pick"
                    onClick={() => { const removed = pickCompare(n.id); showToast(`已选用「${p?.name ?? n.data.label ?? '这个结果'}」，移除了另外 ${removed} 个`, { action: { label: '撤销', run: () => void undo() } }) }}>
                    <Trophy />选用这个
                  </button>
                )}
                <button className="btn sm" onClick={() => { close(); focusNode(n.id) }}><Crosshair />定位</button>
              </footer>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** On a node that is part of a comparison: which one it is, and the two actions. */
export function CompareBar({ id, group }: { id: string; group: string }) {
  const members = useStore((s) => s.nodes.filter((n) => n.data.compare === group).map((n) => n.id).join(','))
  const running = useStore((s) => s.runId !== null)
  const ids = members ? members.split(',') : []
  const { openCompareView, pickCompare, showToast, endCompare } = useStore.getState()
  if (ids.length < 2) {
    // the rest of the comparison was deleted by hand: nothing left to compare with
    return (
      <div className="cmp-bar nodrag"><span className="cmp-tag">对比已结束</span>
        <button className="btn xs ghost" onClick={() => endCompare(group)}><Check />收起</button></div>
    )
  }
  return (
    <div className="cmp-bar nodrag" data-testid="compare-bar">
      <span className="cmp-tag"><GitCompareArrows aria-hidden="true" />对比 {String.fromCharCode(65 + ids.indexOf(id))} / {ids.length}</span>
      <button className="btn xs" onClick={() => openCompareView(ids)} data-testid="compare-open">并排查看</button>
      <button className="btn xs" disabled={running} title="留下这个，移除其余对比节点"
        onClick={() => { const removed = pickCompare(id); showToast(`已选用这个结果，移除了另外 ${removed} 个`, { action: { label: '撤销', run: () => void undo() } }) }}
        data-testid="compare-pick-node"><Trophy />选用</button>
    </div>
  )
}
