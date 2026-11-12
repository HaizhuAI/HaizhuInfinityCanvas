// E2E for rc.12: running the website. Starts its own server in accounts mode with an admin email and
// a local SMTP sink (no real mail leaves the machine):
//  1. the admin signs up, finds the console from Settings → 账号, sees the overview;
//  2. switches sign-up to invite only and makes an invite link; a visitor without it is turned away,
//     with it signs up;
//  3. the admin disables the account (the person is signed out), enables it, resets its password
//     (a one-time password shown once), and the person signs in with it;
//  4. forgot password: the reset link arrives by mail, the new password works, old sessions end.
//   node e2e/admin-flow.cjs        (needs the built server: apps/server/dist/index.mjs)
const { chromium } = require('playwright')
const { spawn } = require('node:child_process')
const net = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const OUT = process.env.HZC_E2E_OUT || process.cwd()
const SERVER = path.join(__dirname, '..', 'apps', 'server', 'dist', 'index.mjs')

/** the smallest SMTP server that accepts mail and keeps it */
function smtpSink() {
  const mails = []
  const srv = net.createServer((sock) => {
    let buf = '', inData = false, cur = []
    sock.write('220 sink ready\r\n')
    sock.on('data', (d) => {
      buf += d.toString('utf8')
      let i
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2)
        if (inData) {
          if (line === '.') { inData = false; mails.push(cur.join('\n')); cur = []; sock.write('250 queued\r\n') } else cur.push(line.startsWith('..') ? line.slice(1) : line)
          continue
        }
        const cmd = line.slice(0, 4).toUpperCase()
        if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-sink\r\n250 SIZE 10000000\r\n')
        else if (cmd === 'DATA') { inData = true; sock.write('354 end with .\r\n') }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
        else sock.write('250 ok\r\n')
      }
    })
    sock.on('error', () => {})
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, mails, port: srv.address().port })))
}
/** body text of a captured mail (quoted-printable or base64) */
function mailText(raw) {
  const [head, ...rest] = raw.split('\n\n')
  const body = rest.join('\n\n')
  if (/content-transfer-encoding:\s*base64/i.test(head)) return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) {
    const bytes = body.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    return Buffer.from(bytes, 'latin1').toString('utf8')
  }
  return body
}

function startServer(dataDir, port, smtpPort) {
  const url = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, HZC_DATA_DIR: dataDir, PORT: String(port), HZC_HOST: '127.0.0.1', HZC_ACCOUNTS: '1', HZC_TOKEN: '', HZC_ADMIN_EMAILS: 'boss@example.com', HZC_SMTP_URL: `smtp://127.0.0.1:${smtpPort}`, HZC_MAIL_FROM: 'Canvas <no-reply@example.com>', HZC_PUBLIC_URL: url },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  proc.stdout.on('data', (d) => { log += d }); proc.stderr.on('data', (d) => { log += d })
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
  const sink = await smtpSink()
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hzc-admin-'))
  const s = startServer(dataDir, 8990 + Math.floor(Math.random() * 100), sink.port)
  const browser = await chromium.launch()
  const errors = []
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*\b(400|401|403)\b/.test(m.text())) errors.push('console: ' + m.text()) })
  }
  try {
    await s.ready
    const BASE = s.url

    // 1. the admin
    const bossCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
    const boss = await bossCtx.newPage(); watch(boss)
    await boss.goto(BASE + '/signup')
    await boss.fill('[data-testid="auth-email"]', 'boss@example.com')
    await boss.fill('[data-testid="auth-password"]', 'boss-lantern-42')
    await boss.click('[data-testid="auth-submit"]')
    await boss.waitForSelector('[data-testid="account-button"]')
    await boss.click('[data-testid="account-button"]')
    await boss.click('[data-testid="open-admin"]')
    await boss.waitForSelector('[data-testid="admin-overview"]')
    assert.match(await boss.innerText('[data-testid="admin-overview"]'), /账号\s*1/)
    console.log('1 the admin finds the console from Settings → 账号; overview shows 1 account')

    // 2. invite only
    await boss.click('[data-testid="signup-invite"]')
    await boss.waitForSelector('[data-testid="admin-note"]:has-text("仅邀请")')
    await boss.fill('.adm-invite input:not([type=number])', '设计组')
    await boss.click('[data-testid="invite-create"]')
    await boss.waitForSelector('[data-testid="invite-made"] code')
    const link = await boss.innerText('[data-testid="invite-made"] code')
    assert.match(link, new RegExp(`^${BASE}/signup\\?invite=[\\w-]{20}$`))
    await boss.waitForSelector('[data-testid="invite-list"] td:has-text("设计组")')
    await boss.screenshot({ path: path.join(OUT, 'canvas-admin-1-console.png') })

    const annCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark' })
    const ann = await annCtx.newPage(); watch(ann)
    await ann.goto(BASE + '/signup')
    await ann.waitForSelector('[data-testid="signup-blocked"]:has-text("邀请")')
    await ann.goto(link)
    await ann.waitForSelector('.auth-sub:has-text("邀请")')
    await ann.fill('[data-testid="auth-email"]', 'ann@example.com')
    await ann.fill('[data-testid="auth-password"]', 'teal-lantern-42')
    await ann.click('[data-testid="auth-submit"]')
    await ann.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
    console.log('2 invite only: turned away without the link, signed up with it')

    // 3. disable / enable / reset password
    await boss.reload()
    await boss.waitForSelector('[data-testid="admin-user-row"][data-email="ann@example.com"]')
    const annRow = boss.locator('[data-testid="admin-user-row"][data-email="ann@example.com"]')
    await annRow.locator('[data-testid="admin-user-menu"]').click()
    await annRow.locator('[data-testid="admin-toggle-disabled"]').click()
    await boss.waitForSelector('[data-testid="admin-note"]:has-text("已停用")')
    assert.equal(await ann.evaluate(() => fetch('/api/projects').then((r) => r.status)), 401)
    await annRow.locator('[data-testid="admin-user-menu"]').click()
    await annRow.locator('[data-testid="admin-toggle-disabled"]').click()
    await boss.waitForSelector('[data-testid="admin-note"]:has-text("已恢复")')
    await annRow.locator('[data-testid="admin-user-menu"]').click()
    await annRow.locator('[data-testid="admin-reset"]').click()
    const temp = await boss.innerText('[data-testid="admin-temp-password"]')
    assert.match(temp, /^[A-Za-z2-9]{18}$/)
    await boss.screenshot({ path: path.join(OUT, 'canvas-admin-2-reset.png') })
    await boss.click('[data-testid="admin-dialog"] button:has-text("完成")')
    await ann.goto(BASE + '/login')
    await ann.fill('[data-testid="auth-email"]', 'ann@example.com')
    await ann.fill('[data-testid="auth-password"]', temp)
    await ann.click('[data-testid="auth-submit"]')
    await ann.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
    console.log('3 disabled (signed out), enabled, password reset by the admin; the person signs in with it')

    // 4. forgot password by mail
    await annCtx.clearCookies()
    await ann.goto(BASE + '/login')
    await ann.click('[data-testid="auth-to-forgot"]')
    await ann.fill('[data-testid="auth-email"]', 'ann@example.com')
    await ann.click('[data-testid="auth-submit"]')
    await ann.waitForSelector('[data-testid="auth-mailed"]')
    await ann.screenshot({ path: path.join(OUT, 'canvas-admin-3-forgot.png') })
    for (let i = 0; i < 40 && sink.mails.length === 0; i++) await new Promise((r) => setTimeout(r, 100))
    assert.equal(sink.mails.length, 1, 'one reset mail')
    const text = mailText(sink.mails[0])
    const resetLink = new RegExp(`${BASE}/reset\\?token=[\\w-]+`).exec(text)?.[0]
    assert.ok(resetLink, `reset link in the mail:\n${text}`)
    assert.match(sink.mails[0], /To:.*ann@example\.com/i)
    await ann.goto(resetLink)
    await ann.fill('[data-testid="auth-password"]', 'fresh-lantern-55')
    await ann.click('[data-testid="auth-submit"]')
    await ann.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
    assert.equal((await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: 'ann@example.com', password: temp }) })).status, 401)
    console.log('4 forgot password: the link arrives by mail, the new password works, the old one does not')

    assert.deepEqual(errors, [])
    console.log('admin-flow: all passed')
  } finally {
    await browser.close()
    s.proc.kill('SIGTERM')
    await new Promise((r) => s.proc.once('exit', r))
    sink.srv.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
})().catch((e) => { console.error(e); process.exit(1) })
