import { useEffect, useRef } from 'react'
import { motionEnabled } from './motion'

/**
 * The page's one effect: a quiet deep-field star ground behind the glass panels.
 * Canvas 2D (no WebGL context), ~30 fps, paused when the tab is hidden; a single static frame
 * when motion is off or the OS asks for reduced motion. Stars sit on three depth layers and
 * shift slightly with canvas panning (parallax) via the `--pan-x/--pan-y` values set by the canvas.
 */
interface Star { x: number; y: number; z: number; r: number; tw: number; hue: number }

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')
    if (!ctx) return
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0
    let stars: Star[] = []
    const rand = (a: number, b: number) => a + Math.random() * (b - a)

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = cv.clientWidth; h = cv.clientHeight
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr)
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round(Math.min(260, (w * h) / 7000))
      stars = Array.from({ length: count }, () => {
        const z = Math.random() < 0.7 ? 1 : Math.random() < 0.75 ? 2 : 3
        return { x: rand(0, w), y: rand(0, h), z, r: z === 3 ? rand(0.9, 1.5) : z === 2 ? rand(0.6, 1.1) : rand(0.3, 0.8), tw: rand(0, Math.PI * 2), hue: Math.random() < 0.15 ? 190 : Math.random() < 0.1 ? 170 : 220 }
      })
    }

    function draw(t: number) {
      const root = document.documentElement
      const px = parseFloat(root.style.getPropertyValue('--pan-x') || '0')
      const py = parseFloat(root.style.getPropertyValue('--pan-y') || '0')
      ctx!.clearRect(0, 0, w, h)
      for (const s of stars) {
        const drift = motionEnabled() ? t * 0.004 * s.z : 0
        const x = ((s.x + px * 0.02 * s.z + drift) % w + w) % w
        const y = ((s.y + py * 0.02 * s.z) % h + h) % h
        const a = motionEnabled() ? 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(s.tw + t * 0.0012 * s.z)) : 0.6
        ctx!.globalAlpha = a * (s.z === 1 ? 0.55 : s.z === 2 ? 0.8 : 1)
        ctx!.fillStyle = `hsl(${s.hue} 80% ${s.z === 3 ? 92 : 85}%)`
        ctx!.beginPath(); ctx!.arc(x, y, s.r, 0, Math.PI * 2); ctx!.fill()
      }
      ctx!.globalAlpha = 1
    }

    function loop(t: number) {
      raf = requestAnimationFrame(loop)
      if (t - last < 33) return // ~30 fps is plenty for a ground
      last = t
      draw(t)
    }

    function start() {
      cancelAnimationFrame(raf)
      // only draw when the optional ambient ground is switched on (dark theme)
      if (!document.documentElement.classList.contains('ambient')) return
      if (motionEnabled() && !document.hidden) raf = requestAnimationFrame(loop)
      else draw(0)
    }

    resize(); start()
    const onResize = () => { resize(); start() }
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', start)
    window.addEventListener('hzc:motion', start)
    window.addEventListener('hzc:theme', start)
    const onPan = () => { if (!motionEnabled()) draw(0) }
    window.addEventListener('hzc:pan', onPan)
    return () => {
      window.removeEventListener('hzc:pan', onPan)
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', start)
      window.removeEventListener('hzc:motion', start)
      window.removeEventListener('hzc:theme', start)
    }
  }, [])

  return <canvas ref={ref} className="starfield" aria-hidden="true" />
}
