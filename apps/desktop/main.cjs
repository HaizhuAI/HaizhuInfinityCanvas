'use strict'
/**
 * Electron shell. It does NOT contain business logic: it starts the same Fastify server
 * used by the WebUI (as a child process running on Electron's own Node runtime), then
 * opens a window on it. Server listens on loopback only, with a random access token.
 */
const { app, BrowserWindow, shell, dialog, safeStorage } = require('electron')
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
    smokeLog(`[smoke] window ready, brand="${title}", master key: ${keySource}${keyPrint ? ` (${keyPrint})` : ''}`)
    app.quit()
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus() } })
  app.whenReady().then(createWindow).catch((err) => {
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
