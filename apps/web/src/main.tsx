import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './App'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { setToken } from './api'
import { initMotion } from './motion'
import { initTheme } from './theme'
import './styles.css'

// The desktop shell opens the app as /?token=…; keep it in localStorage and remove it from the URL.
// (/reset?token=… is a password-reset link, not an access token: leave it alone)
const urlToken = location.pathname === '/reset' ? null : new URLSearchParams(location.search).get('token')
if (urlToken) {
  setToken(urlToken)
  history.replaceState(null, '', location.pathname)
}

initTheme()
initMotion()

// /welcome is the public front page; /login, /signup, /forgot, /reset and /admin (multi-user deployments);
// everything else is the canvas
const path = location.pathname.replace(/\/+$/, '') || '/'
const Landing = lazy(() => import('./Landing').then((m) => ({ default: m.Landing })))
const Auth = lazy(() => import('./Auth').then((m) => ({ default: m.Auth })))
const Admin = lazy(() => import('./Admin').then((m) => ({ default: m.Admin })))
const AUTH_PAGES: Record<string, 'login' | 'signup' | 'forgot' | 'reset'> = { '/login': 'login', '/signup': 'signup', '/forgot': 'forgot', '/reset': 'reset' }
const page = path === '/welcome' ? <Landing onEnter={() => { location.href = '/' }} />
  : AUTH_PAGES[path] ? <Auth mode={AUTH_PAGES[path]} />
  : path === '/admin' ? <Admin />
  : null
createRoot(document.getElementById('root')!).render(
  <StrictMode>{page ? <Suspense fallback={null}>{page}</Suspense> : <Root />}</StrictMode>,
)
