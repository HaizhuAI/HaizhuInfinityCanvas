import { StrictMode } from 'react'
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

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>)
