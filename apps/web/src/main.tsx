import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './App'
import '@fontsource-variable/inter'
import '@fontsource-variable/geist-mono'
import { setToken } from './api'
import { initMotion } from './motion'
import { initTheme } from './theme'
import './styles.css'

// The desktop shell opens the app as /?token=…; keep it in localStorage and remove it from the URL.
const urlToken = new URLSearchParams(location.search).get('token')
if (urlToken) {
  setToken(urlToken)
  history.replaceState(null, '', location.pathname)
}

initTheme()
initMotion()

// /welcome is the public front page; everything else is the canvas
const landing = location.pathname.replace(/\/+$/, '') === '/welcome'
const Landing = lazy(() => import('./Landing').then((m) => ({ default: m.Landing })))
createRoot(document.getElementById('root')!).render(
  <StrictMode>{landing ? <Suspense fallback={null}><Landing onEnter={() => { location.href = '/' }} /></Suspense> : <Root />}</StrictMode>,
)
