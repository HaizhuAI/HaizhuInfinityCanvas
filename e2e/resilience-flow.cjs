// E2E for rc.9 redundancy:
//  1. the server stops answering saves -> the canvas is kept in the browser, autosave retries and
//     succeeds once the server is back;
//  2. edits that never reached the server survive a page reload and can be restored;
//  3. a damaged database is replaced by the newest good backup at startup (own server instance);
//  4. SIGTERM shuts the server down cleanly.
//   HZC_URL=http://127.0.0.1:8788 node e2e/resilience-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const SERVER = path.join(__dirname, '..', 'apps', 'server', 'dist', 'index.mjs')

const nodeCount = (page) => page.locator('.react-flow__node').count()
const draftKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hzc.draft.')))

async function browserPart() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('dialog', (d) => void d.accept()) // "leave page with unsaved changes?" -> leave
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')

  // 1. saves fail (server unreachable) -> kept in the browser, retried automatically
  let failing = true
  await page.route('**/api/projects/*', (route) => {
    if (failing && route.request().method() === 'PUT') return route.abort('connectionrefused')
    return route.continue()
  })
  await page.dragAndDrop('[data-testid="palette-text"]', '.react-flow__pane', { targetPosition: { x: 200, y: 200 } })
  await page.waitForSelector('[data-testid="save-state"]:has-text("保存失败 · 自动重试")', { timeout: 10_000 })
  assert.equal((await draftKeys(page)).length, 1, 'the unsaved canvas is kept in the browser')
  await page.waitForSelector('.toast:has-text("修改已保存在本浏览器")')
  failing = false
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")', { timeout: 15_000 })
  await page.waitForSelector('.toast:has-text("连接已恢复，修改已保存")') // replaces the failure message
  assert.deepEqual(await draftKeys(page), [], 'a successful retry removes the browser copy')
  console.log('ok: failed saves are kept and retried until the server answers')

  // 2. edits that never reached the server survive a reload and can be restored
  failing = true
  const before = await nodeCount(page)
  await page.dragAndDrop('[data-testid="palette-text"]', '.react-flow__pane', { targetPosition: { x: 520, y: 260 } })
  await page.waitForSelector('[data-testid="save-state"]:has-text("保存失败")', { timeout: 10_000 })
  assert.equal(await nodeCount(page), before + 1)
  await page.reload()
  failing = false
  await page.waitForSelector('.toast:has-text("未保存到服务的修改")', { timeout: 15_000 })
  assert.equal(await nodeCount(page), before, 'the server copy is shown first')
  await page.click('.toast button:has-text("恢复")')
  await page.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n, before + 1)
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")', { timeout: 15_000 })
  assert.deepEqual(await draftKeys(page), [])
  // and the server really has it now
  await page.reload()
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
  assert.equal(await nodeCount(page), before + 1)
  assert.equal(await page.locator('.toast:has-text("未保存到服务的修改")').count(), 0)
  console.log('ok: unsaved edits survive a reload and are restored on request')

  assert.deepEqual(errors, [])
  await browser.close()
}

/** a second server on its own data dir, for the restart / damage tests */
function startServer(dataDir, port) {
  const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, HZC_DATA_DIR: dataDir, PORT: String(port), HZC_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  proc.stdout.on('data', (d) => { log += d })
  proc.stderr.on('data', (d) => { log += d })
  const url = `http://127.0.0.1:${port}`
  const ready = (async () => {
    for (let i = 0; i < 60; i++) {
      if (proc.exitCode !== null) throw new Error(`server exited:\n${log}`)
      try { if ((await fetch(url + '/api/health')).ok) return } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(`server did not start:\n${log}`)
  })()
  return { proc, url, ready, log: () => log, stopped: new Promise((r) => proc.once('exit', (code, signal) => r({ code, signal }))) }
}

async function serverPart() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzc-resilience-'))
  const port = 8790 + Math.floor(Math.random() * 100)
  const json = (r) => r.json()
  try {
    // first start: a startup backup is written; add a project and back up again
    let s = startServer(dataDir, port)
    await s.ready
    const p = await fetch(s.url + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '珍贵的画布' }) }).then(json)
    const made = await fetch(s.url + '/api/backups', { method: 'POST' })
    assert.equal(made.status, 201)
    const list = await fetch(s.url + '/api/backups').then(json)
    assert.ok(list.length >= 1, 'backups are listed')
    const sys = await fetch(s.url + '/api/system').then(json)
    assert.ok(sys.backups.count >= 1 && sys.backups.latest)
    assert.equal(sys.recovery, undefined)

    // 4. SIGTERM: clean shutdown (exit code 0, database closed)
    s.proc.kill('SIGTERM')
    const end = await s.stopped
    assert.equal(end.code, 0, `clean exit expected, got ${JSON.stringify(end)}\n${s.log()}`)
    assert.match(s.log(), /shutting down \(SIGTERM\)/)
    assert.equal(fs.existsSync(path.join(dataDir, 'hzc.sqlite-wal')) && fs.statSync(path.join(dataDir, 'hzc.sqlite-wal')).size > 0, false, 'the write-ahead log was folded back')
    console.log('ok: SIGTERM shuts the server down cleanly')

    // 3. damage the database file, start again: the backup is restored and reported
    const db = path.join(dataDir, 'hzc.sqlite')
    const bytes = fs.readFileSync(db)
    bytes.fill(0x5a, 0, 100)
    fs.writeFileSync(db, bytes)
    s = startServer(dataDir, port)
    await s.ready
    const after = await fetch(s.url + '/api/system').then(json)
    assert.ok(after.recovery?.restoredFrom, `recovery reported: ${JSON.stringify(after.recovery)}\n${s.log()}`)
    assert.ok(fs.existsSync(path.join(dataDir, after.recovery.keptAs)), 'the damaged file is kept')
    const projects = await fetch(s.url + '/api/projects').then(json)
    assert.ok(projects.some((x) => x.id === p.id && x.name === '珍贵的画布'), 'the project came back from the backup')
    s.proc.kill('SIGTERM')
    await s.stopped
    console.log('ok: a damaged database is restored from the newest backup')
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

;(async () => {
  await browserPart()
  await serverPart()
  console.log('resilience-flow: all passed')
})().catch((e) => { console.error(e); process.exit(1) })
