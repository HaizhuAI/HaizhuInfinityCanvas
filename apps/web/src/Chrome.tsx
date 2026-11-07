import { useEffect, useRef, useState } from 'react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { Blocks, ChevronLeft, ChevronRight, Download, Images, LayoutDashboard, Maximize, Minus, Plus, Redo2, Settings as SettingsIcon, Undo2, X } from 'lucide-react'
import type { NodeOutputs } from '@hzc/core'
import { redo, undo } from './history'
import { MOD } from './Overlays'
import { assetUrl } from './api'
import { enterOverlay } from './motion'
import { useStore } from './store'

/** Left icon rail: switches the left panel; settings at the bottom. */
export function Rail() {
  const panel = useStore((s) => s.leftPanel)
  const setPanel = useStore((s) => s.setLeftPanel)
  const openSettings = useStore((s) => s.setSettingsOpen)
  const btn = (id: 'library' | 'assets', label: string, Icon: typeof Blocks) => (
    <button className={`rail-btn${panel === id ? ' on' : ''}`} aria-label={label} aria-pressed={panel === id} data-testid={`rail-${id}`}
      onClick={() => setPanel(panel === id ? null : id)}>
      <Icon aria-hidden="true" /><span className="tip" aria-hidden="true">{label}</span>
    </button>
  )
  return (
    <nav className="rail" aria-label="工作区">
      {btn('library', '组件库', Blocks)}
      {btn('assets', '素材库', Images)}
      <span className="rail-sep" />
      <button className="rail-btn" aria-label="设置" onClick={() => openSettings(true)} data-testid="rail-settings">
        <SettingsIcon aria-hidden="true" /><span className="tip" aria-hidden="true">设置</span>
      </button>
    </nav>
  )
}

/** Lay the canvas out left to right, then fit it; undo restores the previous arrangement. */
export function tidyCanvas(fitView: (o: { padding: number; maxZoom: number; duration: number }) => Promise<boolean> | unknown) {
  const st = useStore.getState()
  const moved = st.tidy()
  if (!moved) { st.showToast('已经很整齐了'); return }
  requestAnimationFrame(() => void fitView({ padding: 0.15, maxZoom: 1, duration: 350 }))
  st.showToast(`已整理 ${moved} 个节点`, { action: { label: '撤销', run: () => void undo() } })
}

/** Floating zoom / fit / quick-add bar (replaces React Flow's default controls). */
export function FloatingToolbar() {
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow()
  const { zoom } = useViewport()
  const openPalette = useStore((s) => s.openPalette)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  return (
    <div className="ftoolbar" role="toolbar" aria-label="画布工具">
      <button className="btn ghost sm icon" onClick={() => undo()} disabled={!canUndo} aria-label="撤销" title={`撤销（${MOD} Z）`} data-testid="undo"><Undo2 /></button>
      <button className="btn ghost sm icon" onClick={() => redo()} disabled={!canRedo} aria-label="重做" title={`重做（${MOD} Shift Z）`} data-testid="redo"><Redo2 /></button>
      <span className="sep" />
      <button className="btn ghost sm icon" onClick={() => void zoomOut({ duration: 160 })} aria-label="缩小"><Minus /></button>
      <button className="zoom-label" onClick={() => void zoomTo(1, { duration: 200 })} title="恢复 100%" aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击恢复 100%`}>{Math.round(zoom * 100)}%</button>
      <button className="btn ghost sm icon" onClick={() => void zoomIn({ duration: 160 })} aria-label="放大"><Plus /></button>
      <span className="sep" />
      <button className="btn ghost sm icon" onClick={() => void fitView({ padding: 0.2, maxZoom: 1, duration: 300 })} aria-label="适应画布" title="适应画布（Shift 1）" data-testid="fit-view"><Maximize /></button>
      <button className="btn ghost sm icon" onClick={() => tidyCanvas(fitView)} aria-label="整理画布" title="整理画布：从左到右排好（可撤销）" data-testid="tidy"><LayoutDashboard /></button>
      <span className="sep" />
      <button className="btn ghost sm" onClick={() => openPalette()} aria-label="快速添加"><Plus />添加 <kbd>/</kbd></button>
    </div>
  )
}

/** first image/video in a set of outputs (the main result shown for a version) */
function firstMedia(outputs: NodeOutputs | undefined): { assetId: string; mime: string } | undefined {
  for (const v of Object.values(outputs ?? {}).flat()) if ((v.type === 'image' || v.type === 'video') && 'assetId' in v) return { assetId: v.assetId, mime: v.mime }
  return undefined
}

/** Full-screen preview of an image or video. Esc closes; ← / → browse the node's versions. */
export function Lightbox() {
  const lb = useStore((s) => s.lightbox)
  const close = useStore((s) => s.openLightbox)
  const nodeId = lb?.nodeId
  const count = useStore((s) => (nodeId ? s.runStates[nodeId]?.versions ?? 0 : 0))
  const list = useStore((s) => (nodeId ? s.versionLists[nodeId] : undefined))
  const current = useStore((s) => (nodeId ? s.runStates[nodeId]?.outputs : undefined))
  const running = useStore((s) => s.runId !== null)
  const loadVersions = useStore((s) => s.loadVersions)
  const switchTo = useStore((s) => s.useVersion)
  const showToast = useStore((s) => s.showToast)
  const [idx, setIdx] = useState<number | null>(null) // null = the version in use
  const ref = useRef<HTMLDivElement>(null)
  const asc = list && count >= 2 ? [...list].reverse() : undefined
  const curIdx = asc ? asc.findIndex((v) => JSON.stringify(v.outputs) === JSON.stringify(current)) : -1
  const shownIdx = idx ?? curIdx
  const step = (d: number) => { if (asc) setIdx(Math.min(asc.length - 1, Math.max(0, (idx ?? curIdx) + d))) }
  useEffect(() => { setIdx(null) }, [lb])
  useEffect(() => { if (nodeId && count >= 2 && !list) void loadVersions(nodeId).catch(() => undefined) }, [nodeId, count, list, loadVersions])
  useEffect(() => {
    if (!lb) return
    enterOverlay(ref.current)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null)
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lb, close, asc?.length, idx, curIdx]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!lb) return null
  const shown = (asc && shownIdx >= 0 ? firstMedia(asc[shownIdx]!.outputs) : undefined) ?? { assetId: lb.assetId, mime: lb.mime }
  const url = assetUrl(shown.assetId)
  return (
    <div className="lightbox" ref={ref} role="dialog" aria-label="预览" data-testid="lightbox" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null) }}>
      <div className="lightbox-bar">
        <span className="nm">{lb.name ?? (shown.mime.startsWith('video/') ? '视频' : '图片')}</span>
        {asc && shownIdx >= 0 && (
          <span className="lb-versions" data-testid="lightbox-versions">
            <button className="btn sm" onClick={() => step(-1)} disabled={shownIdx <= 0} aria-label="上一版（←）"><ChevronLeft /></button>
            第 {shownIdx + 1} / {asc.length} 版{shownIdx === curIdx ? '（当前）' : ''}
            <button className="btn sm" onClick={() => step(1)} disabled={shownIdx >= asc.length - 1} aria-label="下一版（→）"><ChevronRight /></button>
          </span>
        )}
        {asc && shownIdx >= 0 && shownIdx !== curIdx && (
          <button className="btn sm primary" disabled={running} data-testid="lightbox-use"
            onClick={() => { const v = asc[shownIdx]!; void switchTo(nodeId!, v.seq).then(() => { setIdx(null); showToast(`已切换到第 ${shownIdx + 1} 版`) }) }}>使用这一版</button>
        )}
        <a className="btn sm" href={url} download={lb.name ?? true}><Download />下载</a>
        <button className="btn sm icon" onClick={() => close(null)} aria-label="关闭预览"><X /></button>
      </div>
      <div className="lightbox-stage" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null) }}>
        {shown.mime.startsWith('video/') ? <video key={url} src={url} controls autoPlay /> : <img src={url} alt={lb.name ?? ''} />}
      </div>
    </div>
  )
}
