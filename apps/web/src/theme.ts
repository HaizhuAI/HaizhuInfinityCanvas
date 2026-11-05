/** Theme (system / dark / light) and the optional ambient star ground. Persisted per browser. */
export type ThemePref = 'system' | 'dark' | 'light'

const THEME_KEY = 'hzc.theme'
const AMBIENT_KEY = 'hzc.ambient'
const INSPECTOR_KEY = 'hzc.inspector'

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

let pref: ThemePref = (read(THEME_KEY) as ThemePref) || 'system'
const mq = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: light)') : undefined

function apply() {
  const resolved = pref === 'system' ? (mq?.matches ? 'light' : 'dark') : pref
  document.documentElement.dataset.theme = resolved
  document.documentElement.classList.toggle('ambient', ambientOn() && resolved === 'dark')
  window.dispatchEvent(new CustomEvent('hzc:theme', { detail: resolved }))
}

export function themePref() { return pref }
export function setThemePref(p: ThemePref) { pref = p; write(THEME_KEY, p); apply() }
export function resolvedTheme(): 'dark' | 'light' { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' }

/** The star ground is off by default: a neutral canvas keeps colour judgement accurate. */
export function ambientOn() { return read(AMBIENT_KEY) === 'on' }
export function setAmbient(on: boolean) { write(AMBIENT_KEY, on ? 'on' : 'off'); apply() }

export function inspectorPref() { return read(INSPECTOR_KEY) !== 'off' }
export function setInspectorPref(on: boolean) { write(INSPECTOR_KEY, on ? 'on' : 'off') }

export function initTheme() {
  apply()
  mq?.addEventListener?.('change', () => { if (pref === 'system') apply() })
}
