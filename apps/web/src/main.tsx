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

// /welcome is the public front page, /login and /signup sign in (multi-user deployments);
// everything else is the canvas
const path = location.pathname.replace(/\/+$/, '') || '/'
const Landing = lazy(() => import('./Landing').then((m) => ({ default: m.Landing })))
const Auth = lazy(() => import('./Auth').then((m) => ({ default: m.Auth })))
const page = path === '/welcome' ? <Landing onEnter={() => { location.href = '/' }} />
  : path === '/login' || path === '/signup' ? <Auth mode={path === '/login' ? 'login' : 'signup'} />
  : null
createRoot(document.getElementById('root')!).render(
  <StrictMode>{page ? <Suspense fallback={null}>{page}</Suspense> : <Root />}</StrictMode>,
)
