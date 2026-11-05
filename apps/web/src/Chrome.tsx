import { useEffect, useRef } from 'react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { Blocks, Download, Images, Maximize, Minus, Plus, Settings as SettingsIcon, X } from 'lucide-react'
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

/** Floating zoom / fit / quick-add bar (replaces React Flow's default controls). */
export function FloatingToolbar() {
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow()
  const { zoom } = useViewport()
  const openPalette = useStore((s) => s.openPalette)
  return (
    <div className="ftoolbar" role="toolbar" aria-label="画布工具">
      <button className="btn ghost sm icon" onClick={() => void zoomOut({ duration: 160 })} aria-label="缩小"><Minus /></button>
      <button className="zoom-label" onClick={() => void zoomTo(1, { duration: 200 })} title="恢复 100%" aria-label={`当前缩放 ${Math.round(zoom * 100)}%，点击恢复 100%`}>{Math.round(zoom * 100)}%</button>
      <button className="btn ghost sm icon" onClick={() => void zoomIn({ duration: 160 })} aria-label="放大"><Plus /></button>
      <span className="sep" />
      <button className="btn ghost sm icon" onClick={() => void fitView({ padding: 0.2, maxZoom: 1, duration: 300 })} aria-label="适应画布" data-testid="fit-view"><Maximize /></button>
      <span className="sep" />
      <button className="btn ghost sm" onClick={() => openPalette()} aria-label="快速添加"><Plus />添加 <kbd>/</kbd></button>
    </div>
  )
}

/** Full-screen preview of an image or video. Esc closes. */
export function Lightbox() {
  const lb = useStore((s) => s.lightbox)
  const close = useStore((s) => s.openLightbox)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!lb) return
    enterOverlay(ref.current)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lb, close])
  if (!lb) return null
  const url = assetUrl(lb.assetId)
  return (
    <div className="lightbox" ref={ref} role="dialog" aria-label="预览" data-testid="lightbox" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null) }}>
      <div className="lightbox-bar">
        <span className="nm">{lb.name ?? (lb.mime.startsWith('video/') ? '视频' : '图片')}</span>
        <a className="btn sm" href={url} download={lb.name ?? true}><Download />下载</a>
        <button className="btn sm icon" onClick={() => close(null)} aria-label="关闭预览"><X /></button>
      </div>
      <div className="lightbox-stage" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null) }}>
        {lb.mime.startsWith('video/') ? <video src={url} controls autoPlay /> : <img src={url} alt={lb.name ?? ''} />}
      </div>
    </div>
  )
}
