'use strict'
/**
 * Electron shell. It does NOT contain business logic: it starts the same Fastify server
 * used by the WebUI (as a child process running on Electron's own Node runtime), then
 * opens a window on it. Server listens on loopback only, with a random access token.
 */
const { app, BrowserWindow, shell, dialog } = require('electron')
const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const net = require('node:net')
const path = require('node:path')

// stable userData dir name in dev and packaged builds (default would be the npm package name)
app.setName('HaizhuInfinityCanvas')

const isPackaged = app.isPackaged
// packaged: <resources>/server, <resources>/web ; dev: ../server/dist, ../web/dist
const serverEntry = isPackaged ? path.join(process.resourcesPath, 'server', 'index.mjs') : path.join(__dirname, '..', 'server', 'dist', 'index.mjs')
const webDir = isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web', 'dist')

let serverProc = null
let mainWindow = null
let origin = ''

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)) })
  })
}

async function waitHealthy(url, token, timeoutMs = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (serverProc && serverProc.exitCode !== null) throw new Error(`server exited with code ${serverProc.exitCode}`)
    try { const r = await fetch(`${url}/api/health`, { headers: { 'x-hzc-token': token } }); if (r.ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error('server did not become healthy in time')
}

async function startServer() {
  const port = await freePort()
  const token = randomBytes(24).toString('hex')
  serverProc = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      HZC_HOST: '127.0.0.1',
      HZC_TOKEN: token,
      HZC_DATA_DIR: path.join(app.getPath('userData'), 'data'),
      HZC_WEB_DIR: webDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  origin = `http://127.0.0.1:${port}`
  await waitHealthy(origin, token)
  return { origin, token }
}

function stopServer() {
  if (serverProc && serverProc.exitCode === null) serverProc.kill()
  serverProc = null
}

async function createWindow() {
  const { origin: o, token } = await startServer()
  mainWindow = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 680, title: 'Haizhu Infinity Canvas',
    backgroundColor: '#0b0b0c',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  mainWindow.setMenuBarVisibility(false)
  // external links open in the system browser; never navigate the app window away from our origin
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(o)) { e.preventDefault(); if (/^https?:\/\//.test(url)) void shell.openExternal(url) } })
  // the web app reads ?token=… once, stores it, and strips it from the URL
  await mainWindow.loadURL(`${o}/?token=${token}`)
  if (process.env.HZC_SMOKE === '1') {
    // headless smoke test hook: report and quit
    const title = await mainWindow.webContents.executeJavaScript(`new Promise(r => setTimeout(() => r(document.querySelector('.topbar .brand')?.textContent ?? 'NO-UI'), 1500))`)
    console.log(`[smoke] window ready, brand="${title}"`)
    app.quit()
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })
  app.whenReady().then(createWindow).catch((err) => {
    dialog.showErrorBox('启动失败', String(err && err.message ? err.message : err))
    stopServer()
    app.exit(1)
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', stopServer)
  process.on('exit', stopServer)
}
