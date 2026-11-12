import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, LayoutGrid, Plus, Save, Trash, X } from 'lucide-react'
import type { Shot } from '@hzc/core'
import { assetUrl } from './api'
import { enterOverlay } from './motion'
import { useStore, uid } from './store'

type Row = Shot & { key: string }
type Col = 'title' | 'visual' | 'camera' | 'dialogue' | 'duration' | 'imagePrompt' | 'videoPrompt'
const COLS: { id: Col; label: string; wide?: boolean }[] = [
  { id: 'title', label: '标题' }, { id: 'visual', label: '画面', wide: true }, { id: 'camera', label: '景别与运镜' },
  { id: 'dialogue', label: '台词 / 旁白' }, { id: 'duration', label: '时长' },
  { id: 'imagePrompt', label: '图片提示词', wide: true }, { id: 'videoPrompt', label: '视频提示词', wide: true },
]
const COLS_KEY = 'hzc.storyboard.cols'
function loadCols(): Col[] {
  try { const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') as Col[] | null; if (Array.isArray(v) && v.length) return v } catch { /* default */ }
  return COLS.map((c) => c.id)
}

/** 分镜表：the storyboard of a director / video-reverse node as an editable table */
export function StoryboardTable() {
  const edit = useStore((s) => s.storyboardEdit)
  if (!edit) return null
  return <Editor key={edit.nodeId} nodeId={edit.nodeId} />
}

function Editor({ nodeId }: { nodeId: string }) {
  const close = useStore((s) => s.openStoryboard)
  const save = useStore((s) => s.saveStoryboard)
  const expand = useStore((s) => s.expandStoryboard)
  const showNodes = useStore((s) => s.showNodes)
  const showToast = useStore((s) => s.showToast)
  const running = useStore((s) => s.runId !== null)
  const label = useStore((s) => s.nodes.find((n) => n.id === nodeId)?.data.label ?? '分镜')
  const sb = useStore((s) => s.runStates[nodeId]?.outputs?.out?.find((v) => v.type === 'storyboard'))
  const initial = sb && sb.type === 'storyboard' ? sb : undefined
  const [title, setTitle] = useState(initial?.title ?? '')
  const [rows, setRows] = useState<Row[]>(() => (initial?.shots ?? []).map((s) => ({ ...s, key: uid() })))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cols, setCols] = useState<Col[]>(loadCols)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const total = useMemo(() => rows.reduce((t, r) => t + (Number(r.duration) || 0), 0), [rows])
  const keyframes = rows.some((r) => r.keyframe)

  const change = (fn: (rs: Row[]) => Row[]) => { setRows((rs) => fn(rs)); setDirty(true) }
  const setCell = (key: string, col: Col, v: string) => change((rs) => rs.map((r) => (r.key === key ? { ...r, [col]: col === 'duration' ? Math.min(60, Math.max(1, Math.round(Number(v)) || 1)) : v } : r)))
  const blank = (): Row => ({ key: uid(), index: 0, title: '', visual: '', camera: '', dialogue: '', duration: 5, imagePrompt: '', videoPrompt: '' })
  const tryClose = () => { if (!dirty || confirm('分镜有未保存的修改，确定关闭？')) close(null) }

  async function persist(): Promise<boolean> {
    if (!rows.length) { showToast('分镜里至少要有一个镜头'); return false }
    setBusy(true)
    const ok = await save(nodeId, { title: title.trim() || undefined, shots: rows.map(({ key: _k, ...s }) => s) })
    setBusy(false)
    if (ok) setDirty(false)
    return ok
  }

  async function expandSelected() {
    if (dirty && !(await persist())) return
    const only = rows.map((r, i) => (selected.has(r.key) ? i + 1 : 0)).filter(Boolean)
    const ids = expand(nodeId, only.length ? only : undefined)
    close(null)
    if (ids.length) { showNodes(ids); showToast(`已展开 ${only.length || rows.length} 个镜头到画布`) }
  }

  useEffect(() => { enterOverlay(ref.current) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); tryClose() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); void persist().then((ok) => ok && showToast('分镜已保存')) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }) // re-bound each render: the handlers read the latest rows

  if (!initial) return null
  const shown = COLS.filter((c) => cols.includes(c.id))
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.key))
  return (
    <div className="sbt-back" onMouseDown={(e) => { if (e.target === e.currentTarget) tryClose() }}>
      <div className="sbt" ref={ref} role="dialog" aria-label="分镜表" data-testid="storyboard-table">
        <div className="sbt-head">
          <input className="sbt-title" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true) }} placeholder={`${label} · 片名`} aria-label="片名" />
          <span className="muted">{rows.length} 个镜头 · 共 {total} 秒{dirty ? ' · 未保存' : ''}</span>
          <span className="sbt-spacer" />
          <div className="sbt-cols" role="group" aria-label="显示的列">
            {COLS.map((c) => (
              <button type="button" key={c.id} className={`pchip mono${cols.includes(c.id) ? ' on' : ''}`} aria-pressed={cols.includes(c.id)}
                onClick={() => { const next = cols.includes(c.id) ? cols.filter((x) => x !== c.id) : COLS.map((x) => x.id).filter((x) => x === c.id || cols.includes(x)); if (!next.length) return; setCols(next); try { localStorage.setItem(COLS_KEY, JSON.stringify(next)) } catch { /* blocked */ } }}>{c.label}</button>
            ))}
          </div>
          <button type="button" className="btn sm icon ghost" onClick={tryClose} aria-label="关闭分镜表"><X /></button>
        </div>
        <div className="sbt-scroll">
          <table>
            <thead>
              <tr>
                <th className="sbt-check"><input type="checkbox" className="box" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.key)))} aria-label="全选" /></th>
                <th className="sbt-no">#</th>
                {keyframes && <th>关键帧</th>}
                {shown.map((c) => <th key={c.id} className={c.wide ? 'wide' : c.id === 'duration' ? 'narrow' : ''}>{c.label}</th>)}
                <th className="sbt-ops" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={selected.has(r.key) ? 'on' : ''} data-testid="storyboard-row">
                  <td className="sbt-check"><input type="checkbox" className="box" checked={selected.has(r.key)} aria-label={`选择镜头 ${i + 1}`}
                    onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })} /></td>
                  <td className="sbt-no">{i + 1}</td>
                  {keyframes && <td>{r.keyframe ? <img className="sbt-kf" src={assetUrl(r.keyframe.assetId)} alt="" /> : null}</td>}
                  {shown.map((c) => (
                    <td key={c.id} className={c.wide ? 'wide' : c.id === 'duration' ? 'narrow' : ''}>
                      {c.id === 'duration'
                        ? <input type="number" min={1} max={60} value={r.duration} onChange={(e) => setCell(r.key, 'duration', e.target.value)} aria-label={`镜头 ${i + 1} 时长（秒）`} />
                        : <textarea value={String(r[c.id] ?? '')} rows={c.wide ? 3 : 2} onChange={(e) => setCell(r.key, c.id, e.target.value)} aria-label={`镜头 ${i + 1} ${c.label}`} data-testid={`sb-${c.id}`} />}
                    </td>
                  ))}
                  <td className="sbt-ops">
                    <button type="button" className="btn xs icon ghost" disabled={i === 0} aria-label="上移" onClick={() => change((rs) => { const n = [...rs]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n })}><ArrowUp /></button>
                    <button type="button" className="btn xs icon ghost" disabled={i === rows.length - 1} aria-label="下移" onClick={() => change((rs) => { const n = [...rs]; [n[i], n[i + 1]] = [n[i + 1]!, n[i]!]; return n })}><ArrowDown /></button>
                    <button type="button" className="btn xs icon ghost" aria-label="复制这个镜头" onClick={() => change((rs) => [...rs.slice(0, i + 1), { ...r, key: uid() }, ...rs.slice(i + 1)])}><Copy /></button>
                    <button type="button" className="btn xs icon ghost" disabled={rows.length <= 1} aria-label="删除这个镜头" onClick={() => change((rs) => rs.filter((x) => x.key !== r.key))} data-testid="sb-delete"><Trash /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sbt-foot">
          <button type="button" className="btn sm" onClick={() => change((rs) => [...rs, blank()])} data-testid="sb-add"><Plus />添加镜头</button>
          <span className="sbt-spacer" />
          <span className="muted">{selected.size ? `已选 ${selected.size} 个镜头` : '不选则全部展开'}</span>
          <button type="button" className="btn sm" disabled={busy || running || !dirty} onClick={() => void persist().then((ok) => ok && showToast('分镜已保存，成为这个节点的新版本'))} data-testid="sb-save"><Save />保存</button>
          <button type="button" className="btn sm primary" disabled={busy || running} onClick={() => void expandSelected()} data-testid="sb-expand"><LayoutGrid />{selected.size ? '展开选中的镜头' : '展开全部镜头'}</button>
        </div>
      </div>
    </div>
  )
}
