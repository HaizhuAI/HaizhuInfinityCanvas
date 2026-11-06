/**
 * The only module that imports GSAP. GSAP is used for this app's own interface feedback
 * (nodes appearing, overlays opening, a success pulse) — a "Permitted Use" under GSAP's
 * Standard "No Charge" License. It must never power a user-facing feature for building
 * animations without code (e.g. a keyframe editor); see docs/00-research/02-license-audit.md.
 * Keeping every call behind these helpers means GSAP can be swapped for Motion (MIT) in one file.
 */
import gsap from 'gsap'

const MOTION_KEY = 'hzc.motion'

export function motionPreferred(): boolean {
  try { if (localStorage.getItem(MOTION_KEY) === 'off') return false } catch { /* ignore */ }
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

let enabled = typeof window !== 'undefined' ? motionPreferred() : false

export function motionEnabled() { return enabled }

export function setMotionEnabled(on: boolean) {
  enabled = on && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  try { localStorage.setItem(MOTION_KEY, on ? 'on' : 'off') } catch { /* ignore */ }
  document.documentElement.classList.toggle('motion-off', !enabled)
  window.dispatchEvent(new CustomEvent('hzc:motion', { detail: enabled }))
}

export function initMotion() {
  document.documentElement.classList.toggle('motion-off', !enabled)
  gsap.defaults({ ease: 'power3.out', duration: 0.22 })
}

/** Elements mounted in the same frame enter as a short cascade (e.g. a template or a storyboard fan-out). */
let batch = 0
let batchFrame = 0
function nextStagger() {
  if (!batchFrame) batchFrame = requestAnimationFrame(() => { batch = 0; batchFrame = 0 })
  return Math.min(batch++, 14) * 0.035
}

export function enterNode(el: Element | null) {
  if (!el || !enabled) return
  gsap.fromTo(el, { opacity: 0, y: 8, scale: 0.985 }, { opacity: 1, y: 0, scale: 1, duration: 0.26, delay: nextStagger(), clearProps: 'transform,opacity' })
}

export function enterOverlay(panel: Element | null, backdrop?: Element | null) {
  if (!enabled) return
  if (backdrop) gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.16, clearProps: 'opacity' })
  if (panel) gsap.fromTo(panel, { opacity: 0, y: 10, scale: 0.98 }, { opacity: 1, y: 0, scale: 1, duration: 0.22, clearProps: 'transform,opacity' })
}

export function enterMenu(el: Element | null) {
  if (!el || !enabled) return
  gsap.fromTo(el, { opacity: 0, y: -4 }, { opacity: 1, y: 0, duration: 0.16, clearProps: 'transform,opacity' })
}

/** Ring that swells and fades once when a node finishes. */
export function successPulse(ring: Element | null) {
  if (!ring || !enabled) return
  gsap.fromTo(ring, { opacity: 0.9, scale: 1 }, { opacity: 0, scale: 1.045, duration: 0.7, ease: 'power2.out' })
}

export function enterToast(el: Element | null) {
  if (!el || !enabled) return
  gsap.fromTo(el, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.2, clearProps: 'opacity' })
}
