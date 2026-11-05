// E2E for v1.0.0-beta.3: text -> image generation -> video generation (first frame) -> preview,
// cost confirmation dialog, live progress, cache on re-run. Starts its own mock OpenAI-images + fal server.
//   HZC_URL=http://127.0.0.1:8788 node e2e/gen-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')

const hits = []
let falPolls = 0
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const json = body ? JSON.parse(body) : undefined
        hits.push({ method: req.method, url: req.url, auth: req.headers.authorization, json })
        const base = `http://127.0.0.1:${srv.address().port}`
        const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
        if (req.url === '/v1/images/generations') return send({ data: [{ b64_json: PNG.toString('base64') }] })
        if (req.method === 'POST' && req.url === '/fal/fal-ai/video') { falPolls = 0; return send({ request_id: 'r1', status_url: `${base}/fal/fal-ai/video/requests/r1/status`, response_url: `${base}/fal/fal-ai/video/requests/r1` }) }
        if (req.url === '/fal/fal-ai/video/requests/r1/status') { falPolls++; return send(falPolls < 2 ? { status: 'IN_QUEUE', queue_position: 0 } : falPolls < 3 ? { status: 'IN_PROGRESS' } : { status: 'COMPLETED' }) }
        if (req.url === '/fal/fal-ai/video/requests/r1') return send({ video: { url: `${base}/files/out.mp4` } })
        if (req.url === '/files/out.mp4') { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(MP4) }
        send({ error: 'not found' }, 404)
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}
const api = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json()

;(async () => {
  const mock = await startMock()
  const M = `http://127.0.0.1:${mock.address().port}`
  await api('POST', '/api/profiles', { name: 'GPT 图片', kind: 'image', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'gpt-image-1', apiKey: 'sk-img', cost: { amount: 0.3, currency: 'CNY' } })
  await api('POST', '/api/profiles', { name: 'Kling 视频', kind: 'video', adapter: 'fal', endpoint: `${M}/fal`, model: 'fal-ai/video', apiKey: 'fal-key', cost: { amount: 2, currency: 'CNY' } })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 920 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')

  await page.dragAndDrop('[data-testid="palette-text"]', '.react-flow__pane', { targetPosition: { x: 30, y: 40 } })
  await page.dragAndDrop('[data-testid="profile-GPT 图片"]', '.react-flow__pane', { targetPosition: { x: 400, y: 40 } })
  await page.dragAndDrop('[data-testid="profile-Kling 视频"]', '.react-flow__pane', { targetPosition: { x: 780, y: 40 } })
  await page.dragAndDrop('[data-testid="palette-preview"]', '.react-flow__pane', { targetPosition: { x: 1080, y: 520 } })
  assert.equal(await page.locator('.react-flow__node').count(), 4)
  await page.fill('[data-testid="node-text"] textarea', '雨夜霓虹街头的机械猫，电影感')
  await page.selectOption('[data-testid="node-video-gen"] [data-testid="gen-aspect"]', '16:9')

  const handle = (t, id, kind) => page.locator(`.react-flow__node:has([data-testid="node-${t}"]) .react-flow__handle[data-handleid="${id}"].${kind}`).first()
  async function connect(a, b) {
    const ab = await a.boundingBox(), bb = await b.boundingBox()
    await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2); await page.mouse.down()
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 }); await page.mouse.up()
  }
  await connect(handle('text', 'out', 'source'), handle('image-gen', 'prompt', 'target'))
  await connect(handle('text', 'out', 'source'), handle('video-gen', 'prompt', 'target'))
  await connect(handle('image-gen', 'out', 'source'), handle('video-gen', 'first', 'target'))
  await connect(handle('video-gen', 'out', 'source'), handle('preview', 'in', 'target'))
  assert.equal(await page.locator('.react-flow__edge').count(), 4)
  assert.equal(await page.locator('[data-testid="node-image-gen"] [data-testid="gen-prompt"]').count(), 0, 'prompt box hidden when an upstream prompt is connected')
  console.log('1 built text -> image-gen -> video-gen(first frame) -> preview')

  // run all -> confirmation dialog with the configured prices
  await page.click('[data-testid="run-all"]')
  await page.waitForSelector('[data-testid="confirm-run"]')
  assert.equal(await page.locator('[data-testid="estimate-total"]').innerText(), '¥2.3')
  assert.equal(hits.length, 0, 'nothing called before confirming')
  console.log('2 confirm dialog shows 2 paid calls, total ¥2.3; no provider called yet')

  await page.click('[data-testid="confirm-run"]')
  await page.waitForSelector('[data-testid="node-video-gen"] [data-testid="node-progress"]', { timeout: 15000 })
  const progressText = await page.locator('[data-testid="node-video-gen"] [data-testid="node-progress"]').innerText()
  console.log('3 live progress on video node:', JSON.stringify(progressText))
  await page.waitForSelector('[data-testid="node-preview"] video.media', { timeout: 30000 })
  assert.ok(await page.locator('[data-testid="node-image-gen"] img.media').count() >= 1, 'image result shown in node')
  const falSubmit = hits.find((h) => h.method === 'POST' && h.url === '/fal/fal-ai/video')
  assert.equal(falSubmit.auth, 'Key fal-key')
  assert.equal(falSubmit.json.aspect_ratio, '16:9')
  assert.ok(String(falSubmit.json.image_url).startsWith('data:image/png;base64,'), 'generated image passed as first frame')
  console.log('4 image generated, video generated from it (first frame), shown in preview')

  // re-run: everything cached -> no dialog, no new provider calls
  const before = hits.length
  await page.click('[data-testid="run-all"]')
  await page.waitForSelector('[data-testid="node-video-gen"] [data-testid="node-status"]:has-text("复用缓存")', { timeout: 10000 })
  assert.equal(await page.locator('[data-testid="confirm-run"]').count(), 0, 'no confirmation when nothing will be charged')
  assert.equal(hits.length, before, 'no provider calls on cached re-run')
  console.log('5 re-run: all cached, no confirmation, no provider calls')

  await page.screenshot({ path: OUT + '/canvas-beta3.png' })
  await browser.close(); mock.close()
  console.log('console/page errors:', errors.length ? errors : 'none')
  if (errors.length) process.exit(2)
  console.log('E2E OK')
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1) })
