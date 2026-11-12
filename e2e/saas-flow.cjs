// E2E for rc.10 accounts mode (multi-user / SaaS deployment). Starts its own server with
// HZC_ACCOUNTS=1 on a fresh data dir:
//  1. a visitor at / lands on the front page, which offers sign-up / sign-in;
//  2. sign-up -> the canvas, with an account button; work is saved in the user's own workspace;
//  3. sign out -> sign in again -> the same canvas is back;
//  4. a second user sees none of it (canvases, files), and a session that ends sends them to sign-in;
//  5. account settings: storage meter, wrong current password refused.
//   node e2e/saas-flow.cjs        (needs the built server: apps/server/dist/index.mjs)
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const OUT = process.env.HZC_E2E_OUT || process.cwd()
const SERVER = path.join(__dirname, '..', 'apps', 'server', 'dist', 'index.mjs')
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(256, 9)])

function startServer(dataDir, port) {
  const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, HZC_DATA_DIR: dataDir, PORT: String(port), HZC_HOST: '127.0.0.1', HZC_ACCOUNTS: '1', HZC_USER_QUOTA_MB: '50', HZC_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
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
  return { proc, url, ready, log: () => log }
}

;(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzc-saas-'))
  const s = startServer(dataDir, 8890 + Math.floor(Math.random() * 100))
  const browser = await chromium.launch()
  try {
    await s.ready
    const BASE = s.url
    assert.equal((await (await fetch(BASE + '/api/health')).json()).accounts, true)
    assert.equal((await fetch(BASE + '/api/projects')).status, 401)

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b(400|401)\b/.test(m.text())) errors.push('console: ' + m.text()) })

    // 1. a visitor opening the app lands on the front page with sign-up / sign-in
    await page.goto(BASE + '/')
    await page.waitForURL('**/welcome')
    await page.waitForSelector('[data-testid="landing-signup"]')
    assert.equal(await page.locator('[data-testid="landing-enter"]').innerText(), '免费注册')
    await page.screenshot({ path: path.join(OUT, 'canvas-saas-1-landing.png') })
    console.log('1 visitor -> front page with 免费注册 / 登录')

    // 2. sign up
    await page.click('[data-testid="landing-signup"]')
    await page.waitForSelector('[data-testid="auth"]')
    await page.fill('[data-testid="auth-email"]', 'ann@example.com')
    await page.fill('[data-testid="auth-password"]', '12345678')
    await page.click('[data-testid="auth-submit"]')
    await page.waitForSelector('[data-testid="auth-error"]:has-text("太容易被猜到")')
    await page.fill('[data-testid="auth-password"]', 'teal-lantern-42')
    await page.screenshot({ path: path.join(OUT, 'canvas-saas-2-signup.png') })
    await page.click('[data-testid="auth-submit"]')
    await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
    await page.waitForSelector('[data-testid="account-button"]')
    assert.equal(await page.locator('[data-testid="account-button"]').innerText(), 'A')
    const cookies = await ctx.cookies()
    const session = cookies.find((c) => c.name === 'hzc_session')
    assert.ok(session && session.httpOnly && session.sameSite === 'Lax', 'session cookie is HttpOnly + SameSite=Lax')
    // some work: a text node and an uploaded file
    await page.dragAndDrop('[data-testid="palette-text"]', '.react-flow__pane', { targetPosition: { x: 80, y: 120 } })
    await page.fill('[data-testid="node-text"] textarea', 'Ann 的私人创意')
    await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
    const up = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const r = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'ann.png' }, body: bytes })
      return { status: r.status, body: await r.json() }
    }, png.toString('base64'))
    assert.equal(up.status, 201)
    console.log('2 sign-up -> canvas with account button; HttpOnly session cookie; work saved')

    // 5. account settings
    await page.click('[data-testid="account-button"]')
    await page.waitForSelector('[data-testid="account-pane"]')
    await page.waitForSelector('[data-testid="account-email"]:has-text("ann@example.com")')
    await page.waitForSelector('[data-testid="account-storage"]:has-text("/ 50 MB")')
    await page.screenshot({ path: path.join(OUT, 'canvas-saas-3-account.png') })
    await page.fill('input[aria-label="当前密码"]', 'not-my-password')
    await page.fill('input[aria-label="新密码"]', 'another-lantern-9')
    await page.click('button:has-text("修改密码")')
    await page.waitForSelector('.warn:has-text("当前密码不正确")')
    console.log('5 account settings: email, storage 50 MB quota, wrong current password refused')

    // 3. sign out -> sign in -> same canvas
    await page.click('[data-testid="sign-out"]')
    await page.waitForURL('**/welcome')
    assert.equal((await page.evaluate(() => fetch('/api/projects').then((r) => r.status))), 401)
    await page.click('[data-testid="landing-login"]')
    await page.waitForSelector('[data-testid="auth"]')
    await page.fill('[data-testid="auth-email"]', 'ANN@example.com')
    await page.fill('[data-testid="auth-password"]', 'wrong-password-1')
    await page.click('[data-testid="auth-submit"]')
    await page.waitForSelector('[data-testid="auth-error"]:has-text("邮箱或密码不正确")')
    await page.fill('[data-testid="auth-password"]', 'teal-lantern-42')
    await page.click('[data-testid="auth-submit"]')
    await page.waitForSelector('[data-testid="node-text"] textarea')
    assert.equal(await page.inputValue('[data-testid="node-text"] textarea'), 'Ann 的私人创意')
    console.log('3 sign out -> sign in -> the same canvas is back')

    // 4. a second user sees none of it
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
    const bob = await ctx2.newPage()
    await bob.goto(BASE + '/signup')
    await bob.fill('[data-testid="auth-email"]', 'bob@example.com')
    await bob.fill('[data-testid="auth-password"]', 'bob-lantern-77')
    await bob.click('[data-testid="auth-submit"]')
    await bob.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
    assert.equal(await bob.locator('[data-testid="node-text"]').count(), 0, 'Bob starts with an empty canvas')
    const bobView = await bob.evaluate(async (id) => ({
      projects: (await (await fetch('/api/projects')).json()).map((p) => p.name),
      assets: (await (await fetch('/api/assets')).json()).length,
      annAsset: (await fetch(`/api/assets/${id}`)).status,
    }), up.body.id)
    assert.equal(bobView.assets, 0)
    assert.equal(bobView.annAsset, 404)
    // a session that ends (signed out elsewhere) sends the person to sign in, and back afterwards
    await ctx2.clearCookies()
    await bob.click('[data-testid="open-settings"]').catch(() => {})
    await bob.keyboard.press('Escape')
    await bob.evaluate(() => { window.__hzcTest = true })
    await bob.click('[data-testid="rail-projects"]')
    await bob.waitForURL('**/login?next=*', { timeout: 15_000 })
    await bob.waitForSelector('.auth-sub:has-text("登录已过期")')
    await bob.screenshot({ path: path.join(OUT, 'canvas-saas-4-expired.png') })
    console.log('4 second user: empty canvas, no access to the first user\'s files; an ended session goes to sign-in')
    await ctx2.close()

    // workspaces are separate folders on disk
    const users = fs.readdirSync(path.join(dataDir, 'users'))
    assert.equal(users.length, 2)
    for (const u of users) assert.ok(fs.existsSync(path.join(dataDir, 'users', u, 'hzc.sqlite')))
    assert.ok(fs.existsSync(path.join(dataDir, 'accounts.sqlite')))

    assert.deepEqual(errors, [])
    console.log('saas-flow: all passed')
  } finally {
    await browser.close()
    s.proc.kill('SIGTERM')
    await new Promise((r) => s.proc.once('exit', r))
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})().catch((e) => { console.error(e); process.exit(1) })
