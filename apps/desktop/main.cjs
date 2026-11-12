'use strict'
/**
 * Electron shell. It does NOT contain business logic: it starts the same Fastify server
 * used by the WebUI (as a child process running on Electron's own Node runtime), then
 * opens a window on it. Server listens on loopback only, with a random access token.
 */
const { app, BrowserWindow, shell, dialog, safeStorage, session } = require('electron')
const { spawn } = require('node:child_process')
const { createHash, randomBytes } = require('node:crypto')
const fs = require('node:fs')
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
let quitting = false
/** times the background server ended on its own (restarted at most 3 times in 5 minutes) */
let restarts = []
/** windows reloaded after a server restart (the smoke test waits for this) */
let reloads = 0

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

/** A real OS keychain: DPAPI on Windows; on Linux libsecret / KWallet, not the "basic_text" fallback. */
async function keychainUsable() {
  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
    // HZC_KEYCHAIN_ALLOW_BASIC=1 is for tests on machines without a keyring only
    if (process.platform === 'linux' && process.env.HZC_KEYCHAIN_ALLOW_BASIC !== '1') {
      const backend = safeStorage.getSelectedStorageBackend()
      return backend !== 'basic_text' && backend !== 'unknown'
    }
    return true
  } catch { return false }
}

/**
 * The master key that encrypts saved API keys, sealed by the OS keychain (Electron safeStorage)
 * instead of sitting in a plain file. An existing key file is moved into the keychain once.
 * Returns { key, source } — key undefined means the server keeps using its 0600 key file — or
 * { error } when a sealed key exists but cannot be unsealed (never replaced silently: a new key
 * would make every saved API key unreadable).
 */
async function unsealMasterKey(dataDir) {
  const plainFile = path.join(dataDir, 'master.key')
  const sealedFile = path.join(dataDir, 'master.key.sealed')
  const seal = async (key) => {
    const sealed = await safeStorage.encryptStringAsync(key)
    if ((await safeStorage.decryptStringAsync(sealed)).result !== key) throw new Error('keychain round trip failed')
    fs.writeFileSync(`${sealedFile}.tmp`, sealed, { mode: 0o600 })
    fs.renameSync(`${sealedFile}.tmp`, sealedFile)
  }
  if (fs.existsSync(sealedFile)) {
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(fs.readFileSync(sealedFile))
      if (!/^[0-9a-f]{64}$/i.test(result)) throw new Error('unsealed key has the wrong format')
      if (shouldReEncrypt) await seal(result).catch(() => {}) // the keychain rotated its key; the old seal still works
      return { key: result, source: 'keychain' }
    } catch (error) { return { error } }
  }
  if (!(await keychainUsable())) return { source: 'file' }
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    const key = fs.existsSync(plainFile) ? fs.readFileSync(plainFile, 'utf8').trim() : randomBytes(32).toString('hex')
    if (!/^[0-9a-f]{64}$/i.test(key)) return { source: 'file' }
    await seal(key)
    fs.rmSync(plainFile, { force: true }) // the keychain now holds it
    return { key, source: 'keychain' }
  } catch { return { source: 'file' } }
}

/** Unseal, or ask what to do when the keychain refuses (keep keys and quit, or reset them). */
async function masterKeyOrAsk(dataDir) {
  let r = await unsealMasterKey(dataDir)
  if (!r.error) return r
  if (process.env.HZC_SMOKE === '1') throw new Error(`keychain could not unseal the master key: ${r.error.message}`)
  const choice = dialog.showMessageBoxSync({
    type: 'error', title: '无法解锁已保存的 API Key', noLink: true, defaultId: 0, cancelId: 0,
    message: '系统钥匙串无法解开本机保存 API Key 用的加密密钥。',
    detail: '可能是系统用户、钥匙串或桌面环境发生了变化。\n\n· 退出：恢复钥匙串后重新打开，所有 API Key 保持不变。\n· 重置：画布、素材与结果都保留，已保存的 API Key 需要在「设置 → 模型档案」里重新填写。',
    buttons: ['退出', '重置 API Key 并继续'],
  })
  if (choice !== 1) return null
  const sealedFile = path.join(dataDir, 'master.key.sealed')
  fs.renameSync(sealedFile, `${sealedFile}.unreadable-${Date.now()}`) // kept, in case the keychain comes back
  r = await unsealMasterKey(dataDir)
  return r.error ? { source: 'file' } : r
}

/** smoke-test output; also to a file (HZC_SMOKE_OUT) because a Windows GUI app has no console */
function smokeLog(line) {
  console.log(line)
  if (process.env.HZC_SMOKE_OUT) try { fs.appendFileSync(process.env.HZC_SMOKE_OUT, `${line}\n`) } catch { /* ignore */ }
}

let keySource = 'file'
let keyPrint = '' // fingerprint for the smoke log only, never the key

async function startServer() {
  const port = await freePort()
  const token = randomBytes(24).toString('hex')
  const dataDir = path.join(app.getPath('userData'), 'data')
  const master = await masterKeyOrAsk(dataDir)
  if (!master) { app.exit(1); return new Promise(() => {}) }
  keySource = master.source
  if (master.key) keyPrint = createHash('sha256').update(master.key).digest('hex').slice(0, 8)
  serverProc = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(port),
      HZC_HOST: '127.0.0.1',
      HZC_TOKEN: token,
      HZC_DATA_DIR: dataDir,
      HZC_WEB_DIR: webDir,
      ...(master.key ? { HZC_MASTER_KEY: master.key } : {}),
    },
    // the IPC channel lets the app ask the server to stop cleanly (Windows has no SIGTERM), and lets
    // the server notice when the app is gone
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  serverProc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
  serverProc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))
  watchServer(serverProc)
  origin = `http://127.0.0.1:${port}`
  await waitHealthy(origin, token)
  return { origin, token }
}

/**
 * The window is useless without its server: if the server ends unexpectedly (a crash, killed by the
 * system), start a new one and reload the window. Work is safe — the canvas autosaves and keeps
 * unsaved edits in the window, running provider jobs are resumed. Gives up after 3 restarts in 5 min.
 */
function watchServer(proc) {
  proc.once('exit', (code, signal) => {
    if (quitting || proc !== serverProc) return
    const now = Date.now()
    restarts = restarts.filter((t) => now - t < 5 * 60_000)
    restarts.push(now)
    smokeLog(`[server] exited unexpectedly (${signal || code}); restart ${restarts.length}/3`)
    if (restarts.length > 3) {
      if (process.env.HZC_SMOKE !== '1') dialog.showErrorBox('后台服务多次意外退出', '海柱无限画布的后台服务在 5 分钟内意外退出了 3 次以上。你的画布已自动保存。请重新打开应用；如果仍然出现，请把日志发给我们。')
      app.exit(1)
      return
    }
    startServer()
      .then(({ origin: o, token }) => mainWindow?.loadURL(`${o}/?token=${token}`))
      .then(() => { reloads++; smokeLog(`[server] restarted, window reloaded`) })
      .catch((err) => { smokeLog(`[server] restart failed: ${err && err.message}`); if (process.env.HZC_SMOKE !== '1') dialog.showErrorBox('后台服务无法重新启动', String(err && err.message ? err.message : err)); app.exit(1) })
  })
}

/** Ask the server to finish its requests and close the database; force it after 8 s. */
function stopServer() {
  quitting = true
  const proc = serverProc
  serverProc = null
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return
  try {
    if (proc.connected) {
      proc.send({ type: 'shutdown' })
      setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill() }, 8000).unref()
      return
    }
  } catch { /* channel already closed */ }
  proc.kill()
}

async function createWindow() {
  const { origin: o, token } = await startServer()
  mainWindow = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 680, title: 'Haizhu Infinity Canvas',
    backgroundColor: '#161719',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  mainWindow.setMenuBarVisibility(false)
  // external links open in the system browser; never navigate the app window away from our origin
  // (the current one: it changes if the server has to be restarted)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  const leaving = (url) => !(url === origin || url.startsWith(`${origin}/`))
  mainWindow.webContents.on('will-navigate', (e, url) => { if (leaving(url)) { e.preventDefault(); if (/^https?:\/\//.test(url)) void shell.openExternal(url) } })
  mainWindow.webContents.on('will-redirect', (e, url) => { if (leaving(url)) e.preventDefault() })
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault())
  // the page asks before closing with unsaved edits (a browser shows a prompt); it has already kept them
  // for restoring next time, so the app window closes / reloads without a prompt Electron can't show
  mainWindow.webContents.on('will-prevent-unload', (e) => e.preventDefault())
  // the web app reads ?token=… once, stores it, and strips it from the URL
  await mainWindow.loadURL(`${o}/?token=${token}`)
  if (process.env.HZC_SMOKE === '1') {
    // headless smoke test hook: report and quit
    const title = await mainWindow.webContents.executeJavaScript(`new Promise(r => setTimeout(() => r(document.querySelector('.topbar .brand')?.textContent ?? 'NO-UI'), 1500))`)
    smokeLog(`[smoke] window ready, brand="${title}", master key: ${keySource}${keyPrint ? ` (${keyPrint})` : ''}`)
    if (process.env.HZC_SMOKE_RESTART === '1') {
      // kill the server on purpose: the app must bring it back and show its UI again
      const seen = reloads
      serverProc.kill('SIGKILL')
      for (let i = 0; i < 90 && reloads === seen; i++) await new Promise((r) => setTimeout(r, 500))
      const again = await mainWindow.webContents.executeJavaScript(`new Promise(r => setTimeout(() => r(document.querySelector('.topbar .brand')?.textContent ?? 'NO-UI'), 1500))`)
      smokeLog(`[smoke] after server restart, brand="${again}"`)
    }
    app.quit()
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })
  app.whenReady().then(() => {
    // the app needs no camera, microphone, location, notifications…: refuse every permission request
    // except putting text on the clipboard (copy buttons) and going full screen (videos)
    const ok = new Set(['clipboard-sanitized-write', 'fullscreen'])
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(ok.has(permission)))
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => ok.has(permission))
    return createWindow()
  }).catch((err) => {
    const msg = String(err && err.message ? err.message : err)
    // headless smoke runs have nobody to close a dialog
    if (process.env.HZC_SMOKE === '1') smokeLog(`[smoke] startup failed: ${msg}`)
    else dialog.showErrorBox('启动失败', msg)
    stopServer()
    app.exit(1)
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', stopServer)
  process.on('exit', stopServer)
}
