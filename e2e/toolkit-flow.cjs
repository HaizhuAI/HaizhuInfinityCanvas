// E2E for rc.20 「拆镜头与图片工具」 (ideas from comparing with Toonflow). Needs FFmpeg; starts a mock Replicate.
//  1. 拆镜头: a 3-shot video → keyframes, clips and its soundtrack as grouped nodes beside it
//  2. 图片工具 → 宫格切分 2×2: four image nodes in a group, cut in the browser
//  3. 图片工具 → 换角度 / 重新打光: an image-generation node wired to the picture, its prompt sent with the picture
//  4. a Seedance 2.0 video node offers 4–15 s, 480p / 720p / 1080p and its own sound
//  5. 设置 → Agent 接入 offers the SKILL.md for Claude Code
//   HZC_URL=http://127.0.0.1:8788 node e2e/toolkit-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const hits = []
let seq = 0
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const json = body ? JSON.parse(body) : undefined
        hits.push({ method: req.method, url: req.url, json })
        const base = `http://127.0.0.1:${srv.address().port}`
        const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
        if (req.method === 'POST' && /^\/rep\/v1\/models\//.test(req.url)) { const n = ++seq; return send({ id: `p${n}`, status: 'starting' }) }
        let m = /^\/rep\/v1\/predictions\/p(\d+)$/.exec(req.url)
        if (m) return send({ id: `p${m[1]}`, status: 'succeeded', output: [`${base}/files/out-${m[1]}.png`] })
        m = /^\/files\/out-(\d+)\.png$/.exec(req.url)
        if (m) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.concat([PNG, Buffer.alloc(Number(m[1]), 7)])) }
        send({ error: 'not found' }, 404)
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}
const api = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json()
const upload = async (bytes, mime, name) => (await fetch(`${BASE}/api/assets`, { method: 'POST', headers: { 'content-type': mime, 'x-file-name': name }, body: bytes })).json()

;(async () => {
  // a 6-second video of three very different shots with a tone under them, and a 640×360 picture
  const tmp = mkdtempSync(path.join(tmpdir(), 'hzc-toolkit-'))
  const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])
  ff('-f', 'lavfi', '-i', 'color=c=black:s=320x180:d=2:r=25', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:d=2:r=25', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2:r=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]',
    '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', path.join(tmp, 'three.mp4'))
  ff('-f', 'lavfi', '-i', 'testsrc2=size=640x360:duration=1', '-frames:v', '1', path.join(tmp, 'sheet.png'))
  const video = await upload(readFileSync(path.join(tmp, 'three.mp4')), 'video/mp4', 'three.mp4')
  const pic = await upload(readFileSync(path.join(tmp, 'sheet.png')), 'image/png', 'sheet.png')
  rmSync(tmp, { recursive: true, force: true })

  const mock = await startMock()
  const M = `http://127.0.0.1:${mock.address().port}`
  await api('POST', '/api/profiles', { name: '画图', kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'owner/img', apiKey: 'r8-key' })
  const vid = await api('POST', '/api/profiles', { name: 'Seedance 2.0', kind: 'video', adapter: 'ark', endpoint: `${M}/ark`, model: 'doubao-seedance-2-0-260128', apiKey: 'ark-key' })
  const project = await api('POST', '/api/projects', { name: '工具箱', graph: { version: 1, edges: [], nodes: [
    { id: 'v', type: 'video', position: { x: 0, y: 0 }, data: { label: '参考片', assetId: video.id, mime: 'video/mp4' } },
    { id: 'i', type: 'image', position: { x: 0, y: 900 }, data: { label: '设定图', assetId: pic.id, mime: 'image/png' } },
    { id: 'g', type: 'video-gen', position: { x: 0, y: 1500 }, data: { label: '下一段', profileId: vid.id, text: '镜头缓慢推近' } },
  ] } })
  const graph = async () => (await api('GET', `/api/projects/${project.id}`)).graph

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await page.addInitScript(() => { try { localStorage.setItem('hzc.composer', 'off') } catch { /* blocked */ } })
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
  const saved = () => page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent?.includes('已保存'), null, { timeout: 15000 })
  const confirmIfAsked = async () => { const b = page.locator('[data-testid="confirm-run"]'); await b.waitFor({ timeout: 4000 }).then(() => b.click()).catch(() => {}) }
  const predictions = () => hits.filter((h) => h.method === 'POST' && /^\/rep\/v1\/models\//.test(h.url))
  const node = (id) => page.locator(`.react-flow__node[data-id="${id}"]`)
  const focus = async (id) => { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('/'); await page.fill('[data-testid="palette-input"]', id); await page.click(`[data-testid^="palette-item-c:"]:has-text("${id}")`) }

  // 1. 拆镜头
  await focus('参考片')
  await node('v').locator('.nmedia').hover()
  await node('v').locator('[data-testid="split-shots"]').click()
  await page.waitForSelector('[data-testid="toast"]:has-text("已拆出")', { timeout: 60000 })
  assert.match(await page.locator('[data-testid="toast"]').innerText(), /3 个镜头的关键帧、3 段片段、原音轨/)
  await saved()
  let g = await graph()
  assert.deepEqual(g.nodes.filter((n) => n.type === 'group').map((n) => n.data.label), ['关键帧 · 参考片', '镜头片段 · 参考片', '原音轨 · 参考片'])
  assert.equal(g.nodes.filter((n) => n.type === 'image').length, 1 + 3)
  assert.equal(g.nodes.filter((n) => n.type === 'video').length, 1 + 3)
  assert.equal(g.nodes.filter((n) => n.type === 'audio').length, 1)
  await page.waitForTimeout(500)
  await page.screenshot({ path: OUT + '/toolkit-split.png' })
  console.log('1 拆镜头: three keyframes, three clips and the soundtrack in groups beside the video')

  // 2. 宫格切分
  await focus('设定图')
  await node('i').locator('.nmedia').hover()
  await node('i').locator('[data-testid="image-tools-open"]').click()
  await page.waitForSelector('[data-testid="image-tools"]')
  await page.click('[data-testid="it-tab-grid"]')
  await page.click('[data-testid="it-grid-2x2"]')
  await page.screenshot({ path: OUT + '/toolkit-grid.png' })
  await page.click('[data-testid="it-split"]')
  await page.waitForSelector('[data-testid="toast"]:has-text("已切成 4 张")', { timeout: 30000 })
  await saved()
  await page.waitForTimeout(500)
  await page.screenshot({ path: OUT + '/toolkit-grid-done.png' })
  g = await graph()
  const cells = g.nodes.filter((n) => n.type === 'image' && /^格 /.test(n.data.label ?? ''))
  assert.equal(cells.length, 4)
  assert.ok(g.nodes.some((n) => n.type === 'group' && /^宫格切分 2×2/.test(n.data.label)))
  const cell = await (await fetch(`${BASE}/api/assets/${cells[0].data.assetId}`)).arrayBuffer()
  assert.equal(Buffer.from(cell).readUInt32BE(16), 320) // PNG width: half of 640
  console.log('2 宫格切分 2×2: four 320×180 pictures as image nodes in a group')

  // 3. 换角度, then 重新打光
  await focus('设定图')
  await node('i').locator('.nmedia').hover()
  await node('i').locator('[data-testid="image-tools-open"]').click()
  await page.click('[data-testid="it-tab-angle"]')
  await page.click('[data-testid="it-angle-back"]')
  await page.click('[data-testid="it-make"]')
  await confirmIfAsked()
  for (let i = 0; i < 100 && !predictions().length; i++) await page.waitForTimeout(100)
  const angleIn = predictions()[0].json.input
  assert.match(angleIn.prompt, /REVERSE VIEW/)
  assert.ok(angleIn.image, 'the picture goes along as the reference')
  await page.waitForSelector('[data-testid="run-all"]', { timeout: 30000 })
  await node('i').locator('.nmedia').hover()
  await node('i').locator('[data-testid="image-tools-open"]').click()
  await page.click('[data-testid="it-tab-light"]')
  await page.click('[data-testid="it-light-neon"]')
  await page.click('[data-testid="it-make"]')
  await confirmIfAsked()
  for (let i = 0; i < 100 && predictions().length < 2; i++) await page.waitForTimeout(100)
  assert.match(predictions()[1].json.input.prompt, /cyan and pink light/)
  await saved()
  g = await graph()
  const made = g.nodes.filter((n) => n.type === 'image-gen').map((n) => n.data.label)
  assert.deepEqual(made.sort(), ['换角度 · 背面 · 中景', '重新打光 · 霓虹夜色'])
  assert.equal(g.edges.filter((e) => e.source === 'i' && e.targetHandle === 'ref').length, 2)
  assert.ok(g.nodes.filter((n) => n.type === 'image-gen').every((n) => n.data.params.aspect_ratio === '16:9'))
  console.log('3 换角度 / 重新打光: wired image-generation nodes; prompt and picture reach the model; 16:9 kept')

  // 4. Seedance 2.0 in the inspector
  await focus('下一段')
  const dur = page.locator('.insp-sec select:has(option[value="15"])').first()
  const opts = await dur.locator('option').allTextContents()
  assert.ok(opts.includes('4 秒') && opts.includes('15 秒') && !opts.includes('30 秒'), opts.join(','))
  assert.deepEqual(await page.locator('[data-testid="gen-resolution"] option').allTextContents(), ['模型默认', '480p', '720p', '1080p'])
  await dur.selectOption('12')
  await page.selectOption('[data-testid="gen-resolution"]', '1080p')
  await page.locator('[data-testid="gen-audio"]').click({ force: true })
  await saved()
  assert.deepEqual((await graph()).nodes.find((n) => n.id === 'g').data.params, { duration: 12, resolution: '1080p', audio: true })
  await page.screenshot({ path: OUT + '/toolkit-video-caps.png' })
  console.log('4 Seedance 2.0: 4–15 s, 480p / 720p / 1080p and its own sound, saved on the node')

  // 5. the agent skill
  await page.click('[data-testid="open-settings"]')
  await page.click('[data-testid="settings-tab-agent"]')
  await page.locator('[data-testid="agent-switch"]').click({ force: true })
  await page.waitForSelector('[data-testid="agent-skill"]')
  await page.waitForFunction(() => !document.querySelector('[data-testid="agent-skill-copy"]')?.hasAttribute('disabled'))
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="agent-skill-download"]')])
  assert.equal(dl.suggestedFilename(), 'SKILL.md')
  assert.match(readFileSync(await dl.path(), 'utf8'), /^---\nname: haizhu-canvas\n/)
  console.log('5 设置 → Agent 接入: SKILL.md for Claude Code')

  assert.deepEqual(errors, [])
  await browser.close()
  mock.close()
  console.log('toolkit-flow: all passed')
})().catch((e) => { console.error(e); process.exit(1) })
