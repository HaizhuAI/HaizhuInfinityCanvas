// E2E smoke test for the WebUI. Usage: start the server on a FRESH data dir, then
//   HZC_URL=http://127.0.0.1:8788 node e2e/smoke.cjs      (needs 'playwright' resolvable)
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1840, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  const apiBodies = []
  page.on('response', async (r) => { if (r.url().includes('/api/')) { try { apiBodies.push(await r.text()) } catch {} } })

  await page.goto(BASE + '/')

  // select a node (opens it in the inspector) by clicking its title
  const pick = async (t, nth = 0) => { await page.locator(`[data-testid="node-${t}"] .ntitle`).nth(nth).click(); await page.waitForSelector('[data-testid="inspector"]') }
  const insp = (tid) => `[data-testid="inspector"] [data-testid="${tid}"]`
  await page.waitForSelector('.react-flow')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
  console.log('1 loaded, empty canvas hint visible:', await page.locator('.canvas-empty').isVisible())

  // --- add a model profile through the settings UI
  await page.click('[data-testid="open-settings"]')
  await page.click('[data-testid="add-profile"]')
  await page.click('[data-testid="kind-video"]')
  // a provider's own video API: adapter, address and its common models (one click fills the model ID)
  await page.click('[data-testid="preset-kling"]')
  await page.click('[data-testid="pf-advanced"]')
  assert.equal(await page.inputValue('[data-testid="pf-adapter"]'), 'kling')
  assert.equal(await page.inputValue('[data-testid="pf-endpoint"]'), 'https://api-singapore.klingai.com')
  await page.locator('[data-testid="pf-common-model"]', { hasText: 'kling-2.5-turbo' }).click()
  assert.equal(await page.inputValue('[data-testid="pf-model"]'), 'kling-2.5-turbo')
  // switching the kind keeps the provider when it offers that kind (Kling also makes images)
  await page.click('[data-testid="kind-image"]')
  assert.equal(await page.getAttribute('[data-testid="preset-kling"]', 'aria-checked'), 'true')
  assert.equal(await page.inputValue('[data-testid="pf-name"]'), '可灵 Kling · 图片生成')
  // …and falls back to a custom address when it does not (ElevenLabs only does speech)
  await page.click('[data-testid="kind-tts"]')
  await page.click('[data-testid="preset-elevenlabs"]')
  await page.click('[data-testid="kind-video"]')
  assert.equal(await page.getAttribute('[data-testid="preset-custom"]', 'aria-checked'), 'true')
  // choosing a provider fills adapter + endpoint (shown under 高级设置)
  await page.click('[data-testid="preset-replicate"]')
  assert.equal(await page.inputValue('[data-testid="pf-adapter"]'), 'replicate')
  assert.equal(await page.inputValue('[data-testid="pf-endpoint"]'), 'https://api.replicate.com/v1')
  await page.fill('[data-testid="pf-name"]', 'Kling')
  await page.fill('[data-testid="pf-model"]', 'kling-v2')
  await page.fill('[data-testid="pf-key"]', 'sk-SUPER-SECRET-KEY')
  await page.click('[data-testid="pf-save"]')
  await page.waitForSelector('[data-testid="pcard-Kling"]')
  assert.equal(await page.locator('[data-testid="pcard-Kling"] [data-testid="pcard-key"]').innerText(), '已设置 Key')
  console.log('2 profile created, card shows key set')
  await page.click('[aria-label="关闭"]')

  // --- sidebar shows the profile icon; drag it + palette nodes onto the canvas
  const canvas = page.locator('.canvas')
  const box = await canvas.boundingBox()
  const at = (dx, dy) => ({ x: dx, y: dy })
  await page.dragAndDrop('[data-testid="profile-Kling"]', '.react-flow__pane', { targetPosition: at(820, 60) })
  await page.dragAndDrop('[data-testid="palette-text"]', '.react-flow__pane', { targetPosition: at(40, 40) })
  await page.dragAndDrop('[data-testid="palette-image"]', '.react-flow__pane', { targetPosition: at(40, 440) })
  await page.dragAndDrop('[data-testid="palette-image-gen"]', '.react-flow__pane', { targetPosition: at(430, 200) })
  await page.waitForSelector('.react-flow__node >> nth=3')
  const nodeCount = await page.locator('.react-flow__node').count()
  assert.equal(nodeCount, 4)
  assert.equal(await page.locator('.canvas-empty').count(), 0)
  console.log('3 dragged 4 nodes onto canvas; video-gen bound to profile:', await page.locator('[data-testid="node-video-gen"] select[aria-label="模型档案"]').inputValue() === '' ? 'NOT bound' : 'bound')
  // dropping a profile icon must pre-bind the node to that profile
  assert.notEqual(await page.locator('[data-testid="node-video-gen"] select[aria-label="模型档案"]').inputValue(), '')

  // --- connections
  const handle = (nodeType, id, kind) =>
    page.locator(`.react-flow__node:has([data-testid="node-${nodeType}"]) .react-flow__handle[data-handleid="${id}"].${kind}`).first()
  async function connect(a, b) {
    const ab = await a.boundingBox(), bb = await b.boundingBox()
    await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2)
    await page.mouse.down()
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 })
    await page.mouse.up()
  }
  const edges = () => page.locator('.react-flow__edge').count()

  await connect(handle('text', 'out', 'source'), handle('image-gen', 'prompt', 'target'))
  assert.equal(await edges(), 1, 'text -> image-gen.prompt should connect')
  console.log('4 valid connection text -> prompt: accepted')

  await connect(handle('image', 'out', 'source'), handle('image-gen', 'prompt', 'target'))
  assert.equal(await edges(), 1, 'image -> prompt must be rejected (type mismatch / single input)')
  console.log('5 invalid connection image -> prompt: rejected')

  await connect(handle('image', 'out', 'source'), handle('image-gen', 'ref', 'target'))
  assert.equal(await edges(), 2, 'image -> ref should connect')
  console.log('6 valid connection image -> ref: accepted')

  await connect(handle('image-gen', 'out', 'source'), handle('video-gen', 'first', 'target'))
  assert.equal(await edges(), 3, 'image-gen.out(image) -> video-gen.first(image) should connect')
  console.log('7 image-gen -> video-gen first frame: accepted')

  // text content + autosave
  await page.fill('[data-testid="node-text"] textarea', '一只猫在海边弹吉他')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")', { timeout: 8000 })
  await page.waitForTimeout(300)

  // --- reload: graph persisted
  await page.reload()
  await page.waitForSelector('.react-flow__node >> nth=3')
  assert.equal(await page.locator('.react-flow__node').count(), 4)
  assert.equal(await page.locator('.react-flow__edge').count(), 3)
  assert.equal(await page.locator('[data-testid="node-text"] textarea').inputValue(), '一只猫在海边弹吉他')
  console.log('8 reload: 4 nodes, 3 edges, text restored')

  // --- secret never reaches the browser
  const leaked = apiBodies.some((b) => b.includes('sk-SUPER-SECRET-KEY'))
  assert.equal(leaked, false, 'API key leaked to browser!')
  console.log('9 API key never present in any API response seen by the browser')

  // canvas file round trip: export via the canvas menu, import it back as a new canvas
  await page.click('[data-testid="project-menu"]')
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="export-canvas"]')])
  const saved = await dl.path()
  const exported = JSON.parse(require('node:fs').readFileSync(saved, 'utf8'))
  assert.equal(exported.format, 'haizhu-canvas')
  assert.equal(exported.graph.nodes.length, 4)
  await page.click('[data-testid="project-menu"]')
  await page.setInputFiles('[data-testid="import-file"]', saved)
  await page.waitForSelector('input[aria-label="画布名称"][value$="（导入）"]')
  assert.equal(await page.locator('.react-flow__node').count(), 4)
  assert.equal(await page.locator('.react-flow__edge').count(), 3)
  console.log('10 canvas export -> import round trip: same 4 nodes and 3 edges in a new canvas')

  await page.screenshot({ path: OUT + '/canvas-beta1.png' })
  console.log('console/page errors:', errors.length ? errors : 'none')
  await browser.close()
  if (errors.length) process.exit(2)
  console.log('E2E OK')
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1) })
