import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Film, GripVertical, Pause, Play, Save, X } from 'lucide-react'
import { NODE_TYPE_MAP, cleanTrim, timelineOf, timelineOrder, trimmedSpan, type ClipTrim } from '@hzc/core'
import { assetUrl } from './api'
import { enterOverlay } from './motion'
import { useStore, type CanvasNode } from './store'

/** one row: a node wired into the export node's 视频 port, with the video it currently has */
interface Clip { nodeId: string; label: string; assetId?: string; count: number; trim?: ClipTrim }

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** the clips of an export node in canvas order (what the server does without a timeline) */
function wiredClips(exportId: string): Clip[] {
  const { nodes, edges, runStates } = useStore.getState()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const srcs = edges.filter((e) => e.target === exportId && e.targetHandle === 'video').map((e) => byId.get(e.source)).filter((n): n is CanvasNode => !!n)
  srcs.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
  return [...new Map(srcs.map((n) => [n.id, n])).values()].map((n) => {
    const vids = (runStates[n.id]?.outputs?.out ?? []).filter((v) => v.type === 'video') as { assetId: string }[]
    const own = n.type === 'video' && n.data.assetId ? [{ assetId: n.data.assetId }] : []
    const list = vids.length ? vids : own
    return { nodeId: n.id, label: n.data.label ?? NODE_TYPE_MAP[n.type ?? '']?.label ?? '视频', assetId: list[0]?.assetId, count: list.length }
  })
}

/** 时间线: the clips going into an export node — their order, in / out points, and a preview of the cut */
export function Timeline() {
  const edit = useStore((s) => s.timelineEdit)
  if (!edit) return null
  return <Editor key={edit} exportId={edit} />
}

function Editor({ exportId }: { exportId: string }) {
  const close = useStore((s) => s.openTimeline)
  const setNodeParam = useStore((s) => s.setNodeParam)
  const showToast = useStore((s) => s.showToast)
  const params = useStore((s) => s.nodes.find((n) => n.id === exportId)?.data.params)
  const [rows, setRows] = useState<Clip[]>(() => {
    const tl = timelineOf(params)
    const wired = wiredClips(exportId)
    return timelineOrder(wired.map((c) => c.nodeId), tl.order).map((i) => ({ ...wired[i]!, trim: tl.trims[wired[i]!.nodeId] }))
  })
  const [durations, setDurations] = useState<Record<string, number>>({})
  const [dirty, setDirty] = useState(false)
  const [playing, setPlaying] = useState<number | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const player = useRef<HTMLVideoElement>(null)

  const span = (c: Clip) => trimmedSpan(cleanTrim(c.trim), durations[c.nodeId] ?? c.trim?.out ?? 5)
  const playable = rows.filter((c) => c.assetId)
  const total = useMemo(() => playable.reduce((t, c) => t + span(c).length, 0), [rows, durations]) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (fn: (rs: Clip[]) => Clip[]) => { setRows(fn); setDirty(true) }
  const move = (from: number, to: number) => change((rs) => { const n = [...rs]; const [x] = n.splice(from, 1); n.splice(to, 0, x!); return n })
  // what is typed is kept as typed (a half-typed number must not vanish); it is checked when used and saved
  const setTrim = (nodeId: string, key: 'in' | 'out', v: string) =>
    change((rs) => rs.map((c) => (c.nodeId === nodeId ? { ...c, trim: { ...c.trim, [key]: v === '' ? undefined : Number(v) } } : c)))
  const tryClose = () => { if (!dirty || confirm('时间线有未保存的修改，确定关闭？')) close(null) }

  function save() {
    setNodeParam(exportId, 'order', rows.map((c) => c.nodeId))
    const trims = Object.fromEntries(rows.flatMap((c) => { const t = cleanTrim(c.trim); return t ? [[c.nodeId, t]] : [] }))
    setNodeParam(exportId, 'trims', Object.keys(trims).length ? trims : undefined)
    setDirty(false)
    showToast('时间线已保存：导出节点下次运行时按这个顺序和剪辑合成')
  }

  // the preview: each clip from its in to its out, one after another
  const startClip = (k: number) => {
    const list = playable
    const v = player.current
    if (!v || k >= list.length) { setPlaying(null); return }
    const c = list[k]!
    setPlaying(k)
    v.src = assetUrl(c.assetId!)
    v.onloadedmetadata = () => { v.currentTime = span(c).start; void v.play().catch(() => setPlaying(null)) }
  }
  const onTime = () => {
    const v = player.current
    if (!v || playing === null) return
    const c = playable[playing]
    if (c && v.currentTime >= span(c).start + span(c).length - 0.04) startClip(playing + 1)
  }
  const stop = () => { player.current?.pause(); setPlaying(null) }

  useEffect(() => { enterOverlay(ref.current) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); tryClose() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className="sbt-back" onMouseDown={(e) => { if (e.target === e.currentTarget) tryClose() }}>
      <div className="sbt tl" ref={ref} role="dialog" aria-label="时间线" data-testid="timeline">
        <div className="sbt-head">
          <Film aria-hidden="true" />
          <b>时间线</b>
          <span className="muted" data-testid="tl-total">{playable.length} 个片段 · 共 {fmt(total)}{dirty ? ' · 未保存' : ''}</span>
          <span className="sbt-spacer" />
          <button type="button" className="btn sm icon ghost" onClick={tryClose} aria-label="关闭时间线"><X /></button>
        </div>
        <div className="tl-body">
          <div className="tl-player">
            <video ref={player} muted={false} playsInline onTimeUpdate={onTime} onEnded={() => playing !== null && startClip(playing + 1)} data-testid="tl-player" />
            <div className="tl-player-bar">
              {playing === null
                ? <button type="button" className="btn sm" disabled={!playable.length} onClick={() => startClip(0)} data-testid="tl-play"><Play />整段预览</button>
                : <button type="button" className="btn sm" onClick={stop} data-testid="tl-stop"><Pause />停止</button>}
              <span className="muted">{playing !== null ? `正在播放第 ${playing + 1} / ${playable.length} 段` : '按顺序播放每段剪好的部分（不含配音和字幕）'}</span>
            </div>
          </div>
          {rows.length === 0
            ? <div className="tl-empty muted">还没有片段：把视频节点连到导出节点的「视频」端口。</div>
            : (
              <ol className="tl-list">
                {rows.map((c, i) => {
                  const d = durations[c.nodeId]
                  const sp = span(c)
                  return (
                    <li key={c.nodeId} className={`tl-row${drag === i ? ' dragging' : ''}${playable[playing ?? -1]?.nodeId === c.nodeId ? ' live' : ''}`} data-testid="tl-row"
                      draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDrag(null)}
                      onDragOver={(e) => { if (drag !== null) e.preventDefault() }} onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) move(drag, i); setDrag(null) }}>
                      <span className="tl-grip" aria-hidden="true"><GripVertical /></span>
                      <span className="tl-no">{i + 1}</span>
                      {c.assetId
                        ? <video className="tl-thumb" src={`${assetUrl(c.assetId)}#t=${sp.start}`} muted preload="metadata"
                            onLoadedMetadata={(e) => { const dur = e.currentTarget.duration; if (Number.isFinite(dur)) setDurations((m) => ({ ...m, [c.nodeId]: dur })) }} />
                        : <span className="tl-thumb none">未生成</span>}
                      <div className="tl-meta">
                        <span className="tl-name" title={c.label}>{c.label}{c.count > 1 ? `（${c.count} 个结果，都会用上）` : ''}</span>
                        <span className="muted">{d ? `原长 ${fmt(d)} · 使用 ${fmt(sp.length)}` : c.assetId ? '读取时长…' : '运行上游节点后才有画面'}</span>
                        <div className="tl-bar" aria-hidden="true">{d ? <span style={{ left: `${(sp.start / d) * 100}%`, width: `${(sp.length / d) * 100}%` }} /> : null}</div>
                      </div>
                      <label className="tl-cut">入点
                        <input type="number" min={0} step={0.1} max={d} value={c.trim?.in ?? ''} placeholder="0" onChange={(e) => setTrim(c.nodeId, 'in', e.target.value)} aria-label={`片段 ${i + 1} 入点（秒）`} data-testid="tl-in" />
                      </label>
                      <label className="tl-cut">出点
                        <input type="number" min={0} step={0.1} max={d} value={c.trim?.out ?? ''} placeholder={d ? d.toFixed(1) : '结尾'} onChange={(e) => setTrim(c.nodeId, 'out', e.target.value)} aria-label={`片段 ${i + 1} 出点（秒）`} data-testid="tl-out" />
                      </label>
                      <span className="tl-ops">
                        <button type="button" className="btn xs icon ghost" disabled={i === 0} aria-label="前移" onClick={() => move(i, i - 1)} data-testid="tl-up"><ArrowUp /></button>
                        <button type="button" className="btn xs icon ghost" disabled={i === rows.length - 1} aria-label="后移" onClick={() => move(i, i + 1)} data-testid="tl-down"><ArrowDown /></button>
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
        </div>
        <div className="sbt-foot">
          <span className="muted">拖动或用箭头调整顺序；入点 / 出点留空表示从头 / 到尾。配音与字幕仍按导出节点的规则对齐。</span>
          <span className="sbt-spacer" />
          <button type="button" className="btn sm primary" disabled={!dirty} onClick={save} data-testid="tl-save"><Save />保存</button>
        </div>
      </div>
    </div>
  )
}
