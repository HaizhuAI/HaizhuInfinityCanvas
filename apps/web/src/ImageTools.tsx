import { useEffect, useMemo, useRef, useState } from 'react'
import { Grid3x3, Rotate3d, SunMedium, X } from 'lucide-react'
import {
  ANGLE_DISTANCES, ANGLE_PRESETS, ASPECT_RATIOS, LIGHT_DIRECTIONS, RELIGHT_PRESETS,
  angleLabel, buildAnglePrompt, buildRelightPrompt, relightLabel, type AngleSettings,
} from '@hzc/core'
import { useStore } from './store'
import { assetUrl } from './api'
import { enterOverlay } from './motion'

/**
 * 图片工具 (rc.20, after Toonflow's image node): from a picture on the canvas make
 *   换角度 — the same scene from another camera position,
 *   重新打光 — the same picture under other light (both a new image-generation node wired to it),
 *   宫格切分 — a contact sheet cut into its cells (done here in the browser, nothing paid).
 */
type Tab = 'angle' | 'light' | 'grid'
const GRIDS: [number, number][] = [[2, 2], [3, 3], [4, 4], [5, 5], [1, 2], [1, 3], [2, 3], [3, 2]]

/** the listed aspect ratio closest to the picture's own */
function nearestAspect(w: number, h: number): string | undefined {
  if (!w || !h) return undefined
  const r = w / h
  let best: string | undefined, d = Infinity
  for (const a of ASPECT_RATIOS) { const [x, y] = a.split(':').map(Number); const e = Math.abs(Math.log(r / (x! / y!))); if (e < d) { d = e; best = a } }
  return best
}

export function ImageTools() {
  const t = useStore((s) => s.imageTools)
  const close = () => useStore.getState().openImageTools(null)
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('angle')
  const [angle, setAngle] = useState<Pick<AngleSettings, 'azimuth' | 'elevation' | 'distance' | 'lens'>>({ azimuth: 45, elevation: 0, distance: 4.8, lens: 'standard' })
  const [light, setLight] = useState<{ preset: string; dir: string; brightness: number; note: string }>({ preset: 'portrait', dir: '', brightness: 50, note: '' })
  const [grid, setGrid] = useState<[number, number]>([3, 3])
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [busy, setBusy] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)

  useEffect(() => {
    if (!t) return
    enterOverlay(ref.current)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [t])

  const lightSettings = useMemo(() => {
    const d = LIGHT_DIRECTIONS.find((x) => x.id === light.dir)
    // a direction chosen by hand overrides the preset's own light position
    return { preset: light.preset, ...(d ? { azimuth: d.azimuth, elevation: d.elevation } : {}), ...(light.preset ? {} : { brightness: light.brightness }), note: light.note }
  }, [light])
  const prompt = tab === 'angle' ? buildAnglePrompt(angle) : tab === 'light' ? buildRelightPrompt(lightSettings) : ''

  if (!t) return null
  const aspect = nearestAspect(size.w, size.h)
  const make = () => {
    const label = tab === 'angle' ? `换角度 · ${angleLabel(angle)}` : `重新打光 · ${relightLabel(lightSettings)}`
    useStore.getState().imageVariant(t.nodeId, prompt, label, aspect)
  }
  const split = async () => {
    setBusy(true)
    try {
      const n = await useStore.getState().gridSplit(t.nodeId, t.assetId, grid[0], grid[1], t.name)
      useStore.getState().showToast(`已切成 ${n} 张图片，放在原图旁边`)
    } catch (e) { useStore.getState().showToast(`切分失败：${(e as Error).message}`, { tone: 'error' }) } finally { setBusy(false) }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="modal confirm imgtools" ref={ref} role="dialog" aria-label="图片工具" data-testid="image-tools">
        <div className="modal-head"><h2>图片工具{t.name ? <small> · {t.name}</small> : null}</h2><button className="btn icon ghost" onClick={close} aria-label="关闭"><X /></button></div>
        <div className="pane">
          <div className="it-top">
            <div className="it-pic">
              <img src={assetUrl(t.assetId)} alt={t.name ?? '原图'} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
              {tab === 'grid' && <div className="it-grid" style={{ gridTemplateColumns: `repeat(${grid[1]}, 1fr)`, gridTemplateRows: `repeat(${grid[0]}, 1fr)` }}>{Array.from({ length: grid[0] * grid[1] }, (_, i) => <span key={i} />)}</div>}
            </div>
            <div className="seg2 it-tabs" role="tablist" aria-label="工具">
              <button role="tab" aria-selected={tab === 'angle'} className={tab === 'angle' ? 'on' : ''} onClick={() => setTab('angle')} data-testid="it-tab-angle"><Rotate3d />换角度</button>
              <button role="tab" aria-selected={tab === 'light'} className={tab === 'light' ? 'on' : ''} onClick={() => setTab('light')} data-testid="it-tab-light"><SunMedium />重新打光</button>
              <button role="tab" aria-selected={tab === 'grid'} className={tab === 'grid' ? 'on' : ''} onClick={() => setTab('grid')} data-testid="it-tab-grid"><Grid3x3 />宫格切分</button>
            </div>
          </div>

          {tab === 'angle' && (
            <div className="it-body">
              <div className="it-label">机位</div>
              <div className="it-chips">{ANGLE_PRESETS.map((p) => (
                <button key={p.id} className={`btn sm${angle.azimuth === p.azimuth && angle.elevation === p.elevation ? ' on' : ''}`} onClick={() => setAngle({ ...angle, azimuth: p.azimuth, elevation: p.elevation })} data-testid={`it-angle-${p.id}`}>{p.label}</button>
              ))}</div>
              <div className="grid2">
                <div className="field"><span>景别</span><div className="seg2">{ANGLE_DISTANCES.map((d) => <button key={d.id} className={angle.distance === d.distance ? 'on' : ''} onClick={() => setAngle({ ...angle, distance: d.distance })}>{d.label}</button>)}</div></div>
                <div className="field"><span>镜头</span><div className="seg2"><button className={angle.lens === 'standard' ? 'on' : ''} onClick={() => setAngle({ ...angle, lens: 'standard' })}>标准 50mm</button><button className={angle.lens === 'wide' ? 'on' : ''} onClick={() => setAngle({ ...angle, lens: 'wide' })}>广角 24mm</button></div></div>
              </div>
              <div className="hint">移动的是相机，不是人物：背面视角会画出原图看不到的一面。</div>
            </div>
          )}

          {tab === 'light' && (
            <div className="it-body">
              <div className="it-label">光线风格</div>
              <div className="it-chips">
                {RELIGHT_PRESETS.map((p) => <button key={p.id} className={`btn sm${light.preset === p.id ? ' on' : ''}`} onClick={() => setLight({ ...light, preset: p.id })} data-testid={`it-light-${p.id}`}>{p.label}</button>)}
                <button className={`btn sm${!light.preset ? ' on' : ''}`} onClick={() => setLight({ ...light, preset: '', dir: light.dir || 'front' })}>自定义</button>
              </div>
              <div className="it-label">主光方向{light.preset ? <small>（不选就用风格自带的）</small> : null}</div>
              <div className="seg2">{LIGHT_DIRECTIONS.map((d) => <button key={d.id} className={light.dir === d.id ? 'on' : ''} onClick={() => setLight({ ...light, dir: light.dir === d.id && light.preset ? '' : d.id })}>{d.label}</button>)}</div>
              {!light.preset && (
                <label className="field"><span>亮度 {light.brightness}%</span><input type="range" min={0} max={100} step={5} value={light.brightness} onChange={(e) => setLight({ ...light, brightness: Number(e.target.value) })} /></label>
              )}
              <label className="field"><span>补充说明（可选）</span><input value={light.note} maxLength={200} placeholder="如 窗外透进来的冷光、脸上留一点阴影" onChange={(e) => setLight({ ...light, note: e.target.value })} /></label>
            </div>
          )}

          {tab === 'grid' && (
            <div className="it-body">
              <div className="it-label">行 × 列</div>
              <div className="it-chips">{GRIDS.map(([r, c]) => <button key={`${r}x${c}`} className={`btn sm${grid[0] === r && grid[1] === c ? ' on' : ''}`} onClick={() => setGrid([r, c])} data-testid={`it-grid-${r}x${c}`}>{r}×{c}</button>)}</div>
              <div className="hint">把九宫格分镜、多视图设定图等切成单张，每格一个图片节点，放在原图旁边的分组里。在这台电脑上完成，不调用模型。</div>
            </div>
          )}

          {tab !== 'grid' && (
            <>
              <button className="linkish" onClick={() => setShowPrompt(!showPrompt)}>{showPrompt ? '收起提示词' : '查看提示词'}</button>
              {showPrompt && <pre className="it-prompt" data-testid="it-prompt">{prompt}</pre>}
              <div className="hint">新建一个图片生成节点，原图接到「参考图」{aspect ? `，比例 ${aspect}` : ''}；需要支持参考图的图片模型，运行前会先确认费用。</div>
            </>
          )}
        </div>
        <div className="foot">
          <button className="btn" onClick={close}>取消</button>
          {tab === 'grid'
            ? <button className="btn primary" disabled={busy || !size.w} onClick={() => void split()} data-testid="it-split">{busy ? '切分中…' : `切成 ${grid[0] * grid[1]} 张`}</button>
            : <button className="btn primary" onClick={make} data-testid="it-make">{tab === 'angle' ? '生成这个角度' : '生成这种光线'}</button>}
        </div>
      </div>
    </div>
  )
}
