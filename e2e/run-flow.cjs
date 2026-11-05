// E2E for v1.0.0-beta.2: upload image -> image prompt reverse (VLM) -> preview, caching, persistence, errors.
// Starts its own mock OpenAI-compatible provider. Usage (server on a FRESH data dir):
//   HZC_URL=http://127.0.0.1:8788 node e2e/run-flow.cjs
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const REVERSED = '电影感特写，一只橘猫坐在木质窗台上，午后柔和侧光，浅景深，暖色调 --ar 1:1'

let calls = []
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const json = JSON.parse(body || '{}')
        calls.push({ url: req.url, auth: req.headers.authorization, json })
        const user = json.messages?.at(-1)?.content
        const hasImage = Array.isArray(user) && user.some((p) => p.type === 'image_url')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: hasImage ? REVERSED : 'LLM-OK' } }] }))
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}

async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  return r.json()
}

;(async () => {
  const mock = await startMock()
  const mockUrl = `http://127.0.0.1:${mock.address().port}/v1`
  const vlm = await api('POST', '/api/profiles', { name: 'Qwen-VL', kind: 'vlm', adapter: 'openai-compat', endpoint: mockUrl, model: 'qwen-vl-max', apiKey: 'sk-e2e-key' })
  assert.ok(vlm.id, 'profile created')

  const pngPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hzc-e2e-')), 'cat.png')
  fs.writeFileSync(pngPath, PNG)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')

  // build: image -> image-reverse -> preview (+ an unbound llm to check error reporting)
  await page.dragAndDrop('[data-testid="palette-image"]', '.react-flow__pane', { targetPosition: { x: 60, y: 60 } })
  await page.dragAndDrop('[data-testid="profile-Qwen-VL"]', '.react-flow__pane', { targetPosition: { x: 420, y: 600 } }) // vlm node (unused, checks icon->kind)
  await page.dragAndDrop('[data-testid="palette-image-reverse"]', '.react-flow__pane', { targetPosition: { x: 420, y: 60 } })
  await page.dragAndDrop('[data-testid="palette-preview"]', '.react-flow__pane', { targetPosition: { x: 820, y: 60 } })
  await page.dragAndDrop('[data-testid="palette-llm"]', '.react-flow__pane', { targetPosition: { x: 820, y: 460 } })
  assert.equal(await page.locator('.react-flow__node').count(), 5)
  assert.equal(await page.locator('[data-testid="node-vlm"] select').inputValue(), vlm.id, 'dragging the VLM profile icon creates a bound vlm node')
  console.log('1 built graph (5 nodes); profile icon created a bound VLM node')

  await page.setInputFiles('[data-testid="upload-image"]', pngPath)
  await page.waitForSelector('[data-testid="node-image"] img.media')
  console.log('2 image uploaded and previewed in node')

  await page.selectOption('[data-testid="node-image-reverse"] select[aria-label="模型档案"]', vlm.id)
  await page.selectOption('[data-testid="reverse-style"]', 'midjourney')

  const handle = (t, id, kind) => page.locator(`.react-flow__node:has([data-testid="node-${t}"]) .react-flow__handle[data-handleid="${id}"].${kind}`).first()
  async function connect(a, b) {
    const ab = await a.boundingBox(), bb = await b.boundingBox()
    await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2); await page.mouse.down()
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 }); await page.mouse.up()
  }
  await connect(handle('image', 'out', 'source'), handle('image-reverse', 'image', 'target'))
  await connect(handle('image-reverse', 'out', 'source'), handle('preview', 'in', 'target'))
  assert.equal(await page.locator('.react-flow__edge').count(), 2)

  // run just the preview (and its ancestors)
  await page.locator('[data-testid="node-preview"] [data-testid="run-node"]').click()
  await page.waitForSelector('[data-testid="node-preview"] [data-testid="out-text"]', { timeout: 15000 })
  assert.equal(await page.locator('[data-testid="node-preview"] [data-testid="out-text"]').innerText(), REVERSED)
  assert.equal(await page.locator('[data-testid="node-image-reverse"] [data-testid="node-status"]').innerText(), '完成')
  assert.equal(calls.length, 1)
  const content = calls[0].json.messages.at(-1).content
  assert.match(content[0].text, /Midjourney/, 'style template applied')
  assert.ok(content[1].image_url.url.startsWith('data:image/png;base64,'), 'image sent as data URL')
  assert.equal(calls[0].auth, 'Bearer sk-e2e-key')
  assert.equal(await page.locator('[data-testid="node-llm"] [data-testid="node-status"]').count(), 0, 'unrelated node not run')
  console.log('3 reverse prompt produced and shown in preview; provider got style template + image + key')

  // run all: reverse is cached, unbound llm errors clearly
  await page.click('[data-testid="run-all"]')
  await page.waitForSelector('[data-testid="node-llm"] [data-testid="node-error"]', { timeout: 15000 })
  assert.equal(await page.locator('[data-testid="node-image-reverse"] [data-testid="node-status"]').innerText(), '复用缓存')
  assert.equal(calls.length, 1, 'cache hit: no second provider call')
  assert.match(await page.locator('[data-testid="node-llm"] [data-testid="node-error"]').innerText(), /没有输入提示|未绑定模型档案/)
  console.log('4 run-all: reverse node cached (no new call); unbound LLM shows a clear error')

  // reload: outputs restored
  await page.reload()
  await page.waitForSelector('[data-testid="node-preview"] [data-testid="out-text"]')
  assert.equal(await page.locator('[data-testid="node-preview"] [data-testid="out-text"]').innerText(), REVERSED)
  await page.waitForSelector('[data-testid="node-image"] img.media')
  console.log('5 reload: outputs and uploaded image restored')

  await page.screenshot({ path: OUT + '/canvas-beta2.png' })
  await browser.close(); mock.close()
  console.log('console/page errors:', errors.length ? errors : 'none')
  if (errors.length) process.exit(2)
  console.log('E2E OK')
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1) })
