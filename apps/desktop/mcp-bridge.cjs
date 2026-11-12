'use strict'
/**
 * Haizhu Infinity Canvas · MCP bridge (stdio ⇄ the running app).
 *
 * An MCP client such as Claude Code starts this with the app's own executable in Node mode:
 *   ELECTRON_RUN_AS_NODE=1 <app executable> <userData>/mcp/haizhu-mcp.cjs
 * It reads newline-delimited JSON-RPC messages on stdin, forwards each to the app's local server
 * (POST /mcp with the agent key from the data folder) and writes the answers to stdout, one per line.
 * The app picks a new port every launch: the bridge finds it in <data>/agent-endpoint.json, and opens
 * the app when it is not running. Nothing else is written to stdout; diagnostics go to stderr.
 *
 * The app copies this file to <userData>/mcp/ at every start, so the path stays the same across updates.
 */
const fs = require('node:fs')
const path = require('node:path')
const readline = require('node:readline')
const { spawn } = require('node:child_process')

const dataDir = process.env.HZC_DATA_DIR || path.join(__dirname, '..', 'data')
const endpointFile = path.join(dataDir, 'agent-endpoint.json')
const tokenFile = path.join(dataDir, 'agent-token')
const log = (...a) => process.stderr.write(`[haizhu-mcp] ${a.join(' ')}\n`)

let endpoint = null
let protocol = null
let launching = null

function readEndpoint() {
  try { const e = JSON.parse(fs.readFileSync(endpointFile, 'utf8')); return typeof e.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+$/.test(e.url) ? e.url : null } catch { return null }
}
function readToken() {
  try { const t = fs.readFileSync(tokenFile, 'utf8').trim(); return /^hzc_[\w-]{20,}$/.test(t) ? t : null } catch { return null }
}
async function healthy(url) {
  if (!url) return false
  try { const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2500) }); return r.ok } catch { return false }
}

/** the app's executable (an AppImage runs from its own file, not from the folder it mounts) */
function appExecutable() {
  if (process.env.HZC_APP_EXE) return process.env.HZC_APP_EXE
  if (process.env.APPIMAGE) return process.env.APPIMAGE
  const base = path.basename(process.execPath).toLowerCase()
  return /^node(\.exe)?$/.test(base) ? null : process.execPath // under plain Node (tests) there is no app to open
}

/** a running app's address: the one on record, or open the app and wait for it */
async function ensureApp() {
  const known = readEndpoint()
  if (await healthy(known)) return (endpoint = known)
  if (launching) return launching
  launching = (async () => {
    const exe = process.env.HZC_MCP_NO_LAUNCH === '1' ? null : appExecutable()
    if (!exe) throw new Error('海柱无限画布没有在运行：请先打开应用')
    log(`starting the app: ${exe}`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    spawn(exe, [], { detached: true, stdio: 'ignore', env, windowsHide: false }).on('error', (e) => log(`could not start the app: ${e.message}`)).unref()
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const url = readEndpoint()
      if (url && await healthy(url)) return (endpoint = url)
    }
    throw new Error('海柱无限画布没有在 60 秒内启动：请手动打开应用后重试')
  })()
  try { return await launching } finally { launching = null }
}

const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`)
const errorFor = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function post(url, body) {
  const token = readToken()
  if (!token) return { status: 401, json: errorFor(null, -32001, 'Agent 接入没有开启：打开海柱无限画布 → 设置 → Agent 接入 → 打开「允许 Agent 访问」') }
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` }
  if (protocol) headers['mcp-protocol-version'] = protocol
  const r = await fetch(`${url}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await r.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = errorFor(null, -32603, `unexpected answer from the app (${r.status})`) }
  return { status: r.status, json }
}

async function handle(line) {
  let msg
  try { msg = JSON.parse(line) } catch { write(errorFor(null, -32700, 'Parse error')); return }
  const id = msg && typeof msg === 'object' && !Array.isArray(msg) ? msg.id : undefined
  const isRequest = id !== undefined && id !== null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = endpoint && attempt === 0 ? endpoint : await ensureApp()
      const { status, json } = await post(url, msg)
      if (status === 202 || json === null) return
      if (json && json.error && (json.id === null || json.id === undefined) && isRequest) json.id = id // auth errors name no request
      if (msg.method === 'initialize' && json && json.result && typeof json.result.protocolVersion === 'string') protocol = json.result.protocolVersion
      if (isRequest || Array.isArray(json)) write(json)
      return
    } catch (e) {
      // the app was closed or restarted on another port: find it again once
      endpoint = null
      if (attempt === 1) {
        log(e && e.message ? e.message : String(e))
        if (isRequest) write(errorFor(id, -32002, e && e.message ? e.message : '连接不上海柱无限画布'))
      }
    }
  }
}

const pending = new Set()
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line.trim()) return
  const p = handle(line).catch((e) => log(e && e.stack ? e.stack : String(e)))
  pending.add(p)
  p.finally(() => pending.delete(p))
})
rl.on('close', () => { void Promise.allSettled([...pending]).then(() => process.exit(0)) })
