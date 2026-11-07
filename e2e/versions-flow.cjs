// E2E for rc.3: drop a wire on empty canvas -> quick-add a compatible node, auto-connected;
// regenerate keeps every version (switch on the node and in the inspector, survives reload);
// top-bar run progress; jump to a canvas node from the palette.
//   HZC_URL=http://127.0.0.1:8788 node e2e/versions-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const zlib = require('node:zlib')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()

/** a solid-colour 8x8 PNG */
function png(r, g, b) {
  const w = 8, h = 8, raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3)
  const chunk = (t, d) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length)
    const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const COLOURS = [[220, 40, 40], [40, 160, 60], [40, 80, 220], [200, 160, 20]]
let calls = 0, slow = false
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      req.resume()
      req.on('end', async () => {
        if (req.url !== '/v1/images/generations') { res.writeHead(404); return res.end() }
        if (slow) await new Promise((r) => setTimeout(r, 2500))
        const [r, g, b] = COLOURS[calls++ % COLOURS.length]
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ b64_json: png(r, g, b).toString('base64') }] }))
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}
const api = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json()

;(async () => {
  const mock = await startMock()
  const prof = await api('POST', '/api/profiles', { name: 'GPT 图片', kind: 'image', adapter: 'openai-compat', endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: 'gpt-image-1', apiKey: 'sk-img' })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
  const imgSrc = () => page.locator('[data-testid="node-image-gen"] img.media').getAttribute('src')
  const confirmIfAsked = async () => { const b = page.locator('[data-testid="confirm-run"]'); await b.waitFor({ timeout: 5000 }).then(() => b.click()).catch(() => {}) }

  // 1. a text node; drag a wire from its output into empty canvas -> only nodes that take text are offered
  await page.dragAndDrop('[data-testid="palette-text"]', '.react-flow__pane', { targetPosition: { x: 80, y: 120 } })
  await page.fill('[data-testid="node-text"] textarea', '霓虹雨夜里的机械猫')
  const handle = page.locator('.react-flow__node:has([data-testid="node-text"]) .react-flow__handle.source').first()
  const hb = await handle.boundingBox()
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + 40 * i, hb.y + 10 * i)
  await page.mouse.up()
  await page.waitForSelector('[data-testid="palette-connect"]')
  assert.match(await page.locator('[data-testid="palette-connect"]').innerText(), /文本/)
  assert.equal(await page.locator('[data-testid="palette-item-n:image"]').count(), 0, 'an image input cannot take a text wire')
  assert.equal(await page.locator('[data-testid="palette-item-t:director"]').count(), 0, 'templates are hidden while connecting')
  await page.screenshot({ path: OUT + '/rc3-quick-connect.png' })
  await page.click(`[data-testid="palette-item-p:${prof.id}"]`)
  await page.waitForSelector('[data-testid="node-image-gen"]')
  assert.equal(await page.locator('.react-flow__edge').count(), 1, 'the new node is connected')
  console.log('1 wire dropped on empty canvas: palette lists only nodes that take text; picking 「GPT 图片」 adds it connected')

  // 2. generate, then regenerate twice: every version is kept
  await page.locator('[data-testid="node-image-gen"] [data-testid="run-node"]').click()
  await confirmIfAsked()
  await page.waitForSelector('[data-testid="node-image-gen"] img.media', { timeout: 15000 })
  const v1 = await imgSrc()
  await page.locator('[data-testid="node-image-gen"] .ntitle').click()
  for (let k = 2; k <= 3; k++) {
    await page.click('[data-testid="inspector"] button:has-text("重新生成")')
    await confirmIfAsked()
    await page.waitForFunction((n) => document.querySelector('[data-testid="node-image-gen"] [data-testid="version-label"]')?.textContent === `${n} / ${n}`, k, { timeout: 15000 })
  }
  const v3 = await imgSrc()
  assert.notEqual(v1, v3)
  console.log('2 regenerating keeps every version: the node shows 3 / 3')

  // 3. flip back on the node; pick the first one in the inspector strip
  await page.click('[data-testid="node-image-gen"] [aria-label="上一版"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="node-image-gen"] [data-testid="version-label"]')?.textContent === '2 / 3')
  assert.notEqual(await imgSrc(), v3)
  await page.waitForSelector('[data-testid="version-strip"]')
  assert.equal(await page.locator('[data-testid="version-cell"]').count(), 3)
  await page.screenshot({ path: OUT + '/rc3-versions.png' })
  await page.locator('[data-testid="version-cell"]').last().click() // oldest
  await page.waitForFunction(() => document.querySelector('[data-testid="node-image-gen"] [data-testid="version-label"]')?.textContent === '1 / 3')
  assert.equal(await imgSrc(), v1)
  console.log('3 ‹ on the node goes to 2 / 3; the inspector strip lists all 3 and switches back to the first')

  // 4. the choice is saved: still the first version after a reload
  await page.reload()
  await page.waitForSelector('[data-testid="node-image-gen"] [data-testid="version-label"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="node-image-gen"] [data-testid="version-label"]')?.textContent === '1 / 3')
  assert.equal(await imgSrc(), v1)
  console.log('4 after a reload the node still shows version 1 of 3')

  // 5. run progress in the top bar during a (slow) run
  slow = true
  await page.locator('[data-testid="node-image-gen"] .ntitle').click()
  await page.click('[data-testid="inspector"] button:has-text("重新生成")')
  await confirmIfAsked()
  await page.waitForSelector('[data-testid="run-progress"]')
  assert.match(await page.locator('[data-testid="run-progress"]').innerText(), /运行中 \d \/ 2/)
  await page.screenshot({ path: OUT + '/rc3-progress.png' })
  await page.waitForSelector('[data-testid="run-progress"]', { state: 'detached', timeout: 15000 })
  slow = false
  console.log('5 the top bar shows "运行中 n / 2" while running')

  // 6. palette search finds nodes already on the canvas and jumps to them
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('/')
  await page.fill('[data-testid="palette-input"]', '机械猫')
  const jump = page.locator('[data-testid^="palette-item-c:"]')
  await jump.first().waitFor()
  await page.keyboard.press('Enter')
  await page.waitForSelector('.react-flow__node.selected [data-testid="node-text"]')
  console.log('6 typing in the palette finds the text node by its content; Enter selects it')

  await browser.close(); mock.close()
  console.log('console/page errors:', errors.length ? errors : 'none')
  if (errors.length) process.exit(2)
  console.log('E2E OK')
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1) })
