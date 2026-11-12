// E2E for rc.14 「创作台」. Starts its own mock OpenAI-compatible (chat + images) and fal server.
//  1. empty canvas: the composer is there; two variants of an image from one sentence (Enter), price × 2
//  2. 选用 one variant: the node keeps just it
//  3. 优化提示词 in the composer (the target model's rules reach the text model) and in the inspector
//  4. select the generated image → the composer turns it into a video's first frame
//  5. from the video: continue from the last frame, save the frame you paused on (needs FFmpeg)
//  6. Enter runs the selected node; the composer queues behind a running run instead of cancelling it
//   HZC_URL=http://127.0.0.1:8788 node e2e/studio-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const HAS_FFMPEG = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()

// a real (decodable) 2-second clip, so frames can be taken from it
let MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
if (HAS_FFMPEG) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hzc-studio-')), 'clip.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-pix_fmt', 'yuv420p', f])
  MP4 = fs.readFileSync(f)
}

const hits = []
let images = 0
let falRuns = 0
const polls = {}
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
        if (req.url === '/v1/chat/completions') return send({ choices: [{ message: { content: '提示词：一只橘猫坐在海边礁石上弹吉他，夕阳逆光，中景，镜头缓慢推近' } }] })
        if (req.url === '/v1/images/generations') { images++; return send({ data: [{ b64_json: Buffer.concat([PNG, Buffer.from([images])]).toString('base64') }] }) }
        if (req.method === 'POST' && req.url === '/fal/fal-ai/video') {
          const id = `r${++falRuns}`
          polls[id] = 0
          return send({ request_id: id, status_url: `${base}/fal/fal-ai/video/requests/${id}/status`, response_url: `${base}/fal/fal-ai/video/requests/${id}` })
        }
        const st = /^\/fal\/fal-ai\/video\/requests\/(r\d+)\/status$/.exec(req.url)
        if (st) { polls[st[1]]++; return send(polls[st[1]] < 3 ? { status: 'IN_PROGRESS' } : { status: 'COMPLETED' }) }
        if (/^\/fal\/fal-ai\/video\/requests\/r\d+$/.test(req.url)) return send({ video: { url: `${base}/files/out.mp4` } })
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
  await api('POST', '/api/profiles', { name: '图片模型', kind: 'image', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'gpt-image-1', apiKey: 'sk-img', cost: { amount: 0.2, currency: 'CNY' } })
  await api('POST', '/api/profiles', { name: '视频模型', kind: 'video', adapter: 'fal', endpoint: `${M}/fal`, model: 'fal-ai/video', apiKey: 'fal-key' })
  await api('POST', '/api/profiles', { name: '写手', kind: 'llm', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'writer', apiKey: 'sk-llm' })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
  const toast = (text) => page.waitForSelector(`.toast:has-text("${text}")`)
  const select = async (t, nth = 0) => { await page.locator(`[data-testid="node-${t}"] .ntitle`).nth(nth).click() }

  // 1. the composer on an empty canvas: two variants from one sentence
  await page.waitForSelector('[data-testid="composer"]')
  await page.click('[data-testid="composer-kind-image"]')
  await page.selectOption('[data-testid="composer-count"]', '2')
  assert.match(await page.innerText('[data-testid="composer-cost"]'), /约 0\.4 CNY/)
  await page.fill('[data-testid="composer-prompt"]', '海边弹吉他的橘猫')
  await page.press('[data-testid="composer-prompt"]', 'Enter')
  await page.waitForSelector('[data-testid="node-image-gen"] .nmedia.multi')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-image-gen"] .nmedia img').length === 2)
  assert.equal(images, 2, 'two separate image calls')
  assert.equal(await page.locator('[data-testid="confirm-run"]').count(), 0, 'the composer showed the price, no extra dialog')
  console.log('1 composer: Enter generates 2 variants as a node on the canvas; price shown as 0.4 CNY')

  // 2. pick the second one
  await page.locator('[data-testid="node-image-gen"] .nmedia .nmedia').nth(1).hover()
  await page.locator('[data-testid="node-image-gen"] [data-testid="pick-result"]').nth(1).click()
  await toast('已选用第 2 个结果')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-image-gen"] .nmedia img').length === 1)
  await page.screenshot({ path: path.join(OUT, 'canvas-studio-1-variants.png') })
  console.log('2 选用: the node keeps just the picked result')

  // 3. optimise: in the composer, then in the inspector
  await page.fill('[data-testid="composer-prompt"]', '猫 海边 吉他')
  await page.click('[data-testid="composer-optimize"]')
  await page.waitForSelector('[data-testid="optimize-result"]')
  const chat = hits.filter((h) => h.url === '/v1/chat/completions').at(-1).json
  assert.match(chat.messages[0].content, /GPT Image/, 'the target model family rules were sent')
  assert.equal(chat.messages.at(-1).content, '猫 海边 吉他')
  await page.screenshot({ path: path.join(OUT, 'canvas-studio-2-optimize.png') })
  await page.click('[data-testid="optimize-apply"]')
  assert.match(await page.inputValue('[data-testid="composer-prompt"]'), /^一只橘猫坐在海边礁石上弹吉他/)
  await page.fill('[data-testid="composer-prompt"]', '')
  await select('image-gen')
  await page.click('[data-testid="inspector"] [data-testid="optimize-open"]')
  await page.waitForSelector('[data-testid="inspector"] [data-testid="optimize-result"]')
  await page.click('[data-testid="inspector"] [data-testid="optimize-apply"]')
  assert.match(await page.inputValue('[data-testid="node-image-gen"] [data-testid="gen-prompt"]'), /^一只橘猫坐在海边礁石上弹吉他/)
  console.log('3 优化提示词: the composer and the inspector rewrite with the target model rules')

  // 4. the selected generated image becomes a video's first frame
  await select('image-gen')
  await page.click('[data-testid="composer-kind-video"]')
  await page.selectOption('[data-testid="composer-count"]', '1')
  await page.waitForSelector('.cmp-ref:has-text("首帧")')
  await page.fill('[data-testid="composer-prompt"]', '镜头缓慢推近，猫抬头看向海面')
  await page.click('[data-testid="composer-generate"]')
  await page.waitForSelector('[data-testid="node-video-gen"] video', { timeout: 20000 })
  const firstEdge = await page.locator('.react-flow__edge').count()
  assert.ok(firstEdge >= 1, 'the image is wired to the video as its first frame')
  const submit = hits.find((h) => h.method === 'POST' && h.url === '/fal/fal-ai/video')
  assert.ok(String(submit.json.image_url).startsWith('data:image/'), 'the first frame was sent')
  console.log('4 a selected generated image becomes the first frame of a new video')

  // 5. continue from the last frame / save the frame you paused on
  if (HAS_FFMPEG) {
    const before = await page.locator('.react-flow__node').count()
    await page.locator('[data-testid="node-video-gen"] .nmedia').first().hover()
    await page.locator('[data-testid="node-video-gen"] [data-testid="continue-video"]').first().click()
    await toast('已用最后一帧开始下一段')
    assert.equal(await page.locator('.react-flow__node').count(), before + 2)
    await page.waitForSelector('[data-testid="node-image"] img')
    await page.click('[data-testid="fit-view"]')
    await page.waitForTimeout(400)
    // (double-clicking a <video> with controls goes to the browser's own full screen: use the button)
    const firstVideo = page.locator('[data-testid="node-video-gen"]').first().locator('.nmedia').last()
    await firstVideo.hover()
    await firstVideo.locator('[aria-label="全屏预览"]').click()
    await page.waitForSelector('[data-testid="lightbox"] video')
    await page.click('[data-testid="lightbox-save-frame"]')
    await toast('这一帧已保存为图片节点')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.react-flow__node').count(), before + 3)
    console.log('5 continue from the last frame (image → next video), save the paused frame')
  } else console.log('5 skipped: no FFmpeg on this machine')

  // 6. Enter runs the selected node; the composer queues behind it
  const next = page.locator('[data-testid="node-video-gen"]').last()
  await next.locator('.ntitle').click()
  await next.locator('[data-testid="gen-prompt"]').fill('猫站起来走向镜头')
  await next.locator('.ntitle').click()
  const runsBefore = falRuns
  await page.keyboard.press('Enter')
  // a paid generation: the usual confirmation first
  await page.click('[data-testid="confirm-run"]')
  await page.waitForSelector('[data-testid="stop-run"]')
  await page.fill('[data-testid="composer-prompt"]', '同一只猫的特写')
  await page.click('[data-testid="composer-kind-image"]')
  await page.click('[data-testid="composer-generate"]')
  await toast('已加入队列')
  await page.waitForFunction(() => !document.querySelector('[data-testid="stop-run"]') && document.querySelectorAll('[data-testid="node-image-gen"]').length === 2, null, { timeout: 30000 })
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-image-gen"]')[1]?.querySelector('.nmedia img'), null, { timeout: 30000 })
  assert.equal(falRuns, runsBefore + 1, 'Enter ran the selected video node')
  console.log('6 Enter runs the selected node; the composer queued behind the running run')

  assert.deepEqual(errors, [])
  console.log('studio-flow: all passed')
  await browser.close()
  mock.close()
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1) })
