// E2E for rc.5: multi-model comparison — choose models for a node, add & run the variants (same
// inputs), compare side by side, keep one (it takes the original place and wires), undo; compare
// any two results from the selection; the inspector entry.
//   HZC_URL=http://127.0.0.1:8788 node e2e/compare-flow.cjs      (server on a FRESH data dir)
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
/** each model paints its own colour, so the variants' results differ */
const COLOUR = { 'model-a': [220, 40, 40], 'model-b': [40, 160, 60], 'model-c': [40, 80, 220] }
const calls = []
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        if (req.url !== '/v1/images/generations') { res.writeHead(404); return res.end() }
        const { model, prompt } = JSON.parse(body)
        calls.push({ model, prompt })
        const [r, g, b] = COLOUR[model] ?? [128, 128, 128]
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
  const endpoint = `http://127.0.0.1:${mock.address().port}/v1`
  const profs = []
  for (const [name, model] of [['甲 模型', 'model-a'], ['乙 模型', 'model-b'], ['丙 模型', 'model-c']]) {
    profs.push(await api('POST', '/api/profiles', { name, kind: 'image', adapter: 'openai-compat', endpoint, model, apiKey: 'sk-img' }))
  }
  const graph = {
    version: 1,
    nodes: [
      { id: 'idea', type: 'text', position: { x: 0, y: 0 }, data: { text: '海边灯塔，黄昏' } },
      { id: 'gen', type: 'image-gen', position: { x: 380, y: 0 }, data: { profileId: profs[0].id, label: profs[0].name } },
      { id: 'view', type: 'preview', position: { x: 800, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'idea', sourceHandle: 'out', target: 'gen', targetHandle: 'prompt' },
      { id: 'e2', source: 'gen', sourceHandle: 'out', target: 'view', targetHandle: 'in' },
    ],
  }
  const project = await api('POST', '/api/projects', { name: '对比测试', graph })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="node-image-gen"]')
  const gens = () => page.locator('[data-testid="node-image-gen"]').count()
  const confirmIfAsked = async () => { const b = page.locator('[data-testid="confirm-run"]'); await b.waitFor({ timeout: 5000 }).then(() => b.click()).catch(() => {}) }
  const saved = () => page.waitForSelector('[data-testid="save-state"]:has-text("已保存")', { timeout: 10000 })

  // 1. right-click the image node -> 多模型对比… -> the current model is fixed, pick the other two
  await page.locator('[data-testid="node-image-gen"] .ntitle').click({ button: 'right' })
  await page.click('[data-testid="ctx-compare"]')
  await page.waitForSelector('[data-testid="compare-setup"]')
  assert.equal(await page.locator('[data-testid="compare-option"]').count(), 3)
  const current = page.locator('[data-testid="compare-option"]', { hasText: '甲 模型' })
  assert.ok(await current.locator('input').isChecked())
  assert.ok(await current.locator('input').isDisabled(), 'the node\'s own model is always included')
  assert.ok(await page.locator('[data-testid="compare-create-run"]').isDisabled(), 'nothing picked yet')
  await page.locator('[data-testid="compare-option"]', { hasText: '乙 模型' }).locator('input').check()
  await page.locator('[data-testid="compare-option"]', { hasText: '丙 模型' }).locator('input').check()
  await page.screenshot({ path: OUT + '/rc5-compare-setup.png' })
  await page.click('[data-testid="compare-create-run"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-image-gen"]').length === 3)
  // the variants share the input (idea -> each image node); only the original feeds the preview
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 4, null, { timeout: 5000 })
  await confirmIfAsked()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-image-gen"] img.media').length === 3, null, { timeout: 20000 })
  assert.deepEqual(calls.map((c) => c.model).sort(), ['model-a', 'model-b', 'model-c'])
  assert.ok(calls.every((c) => c.prompt.includes('海边灯塔')), 'every model got the same prompt')
  const tags = await page.locator('[data-testid="compare-bar"] .cmp-tag').allInnerTexts()
  assert.deepEqual(tags.map((t) => t.trim()).sort(), ['对比 A / 3', '对比 B / 3', '对比 C / 3'])
  await page.screenshot({ path: OUT + '/rc5-compare-canvas.png' })
  console.log('1 多模型对比: two more models picked -> 3 wired variants run with the same prompt; each shows 对比 A/B/C')

  // 2. side by side: one column per model, with its name and result
  await page.locator('[data-testid="compare-open"]').first().click()
  await page.waitForSelector('[data-testid="compare-view"]')
  assert.equal(await page.locator('[data-testid="compare-col"]').count(), 3)
  const names = await page.locator('[data-testid="compare-col"] header .nm').allInnerTexts()
  assert.deepEqual(names, ['甲 模型', '乙 模型', '丙 模型'])
  assert.equal(await page.locator('[data-testid="compare-col"] .cmp-media img').count(), 3)
  const srcs = await page.locator('[data-testid="compare-col"] .cmp-media img').evaluateAll((els) => els.map((e) => e.getAttribute('src')))
  assert.equal(new Set(srcs).size, 3, 'three different results')
  await page.waitForTimeout(500) // let the overlay finish fading in
  await page.screenshot({ path: OUT + '/rc5-compare-view.png' })
  console.log('2 并排查看: 3 columns (甲 / 乙 / 丙) with three different images')

  // 3. keep 乙: it takes the original place and the wire to the preview; the others go; undo brings them back
  await page.locator('[data-testid="compare-col"]', { hasText: '乙 模型' }).locator('[data-testid="compare-pick"]').click()
  await page.waitForSelector('[data-testid="compare-view"]', { state: 'detached' })
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-image-gen"]').length === 1)
  assert.equal(await page.inputValue('[data-testid="node-image-gen"] select[aria-label="模型档案"]'), profs[1].id)
  assert.equal(await page.locator('[data-testid="compare-bar"]').count(), 0, 'the comparison has ended')
  await saved()
  let g = (await api('GET', `/api/projects/${project.id}`)).graph
  const winner = g.nodes.find((n) => n.type === 'image-gen')
  assert.deepEqual(winner.position, { x: 380, y: 0 }, 'the winner sits where the original was')
  assert.ok(!winner.data.compare)
  assert.deepEqual(g.edges.map((e) => [e.source, e.target]).sort(), [['idea', winner.id], [winner.id, 'view']].sort())
  await page.locator('[data-testid="toast-action"]').click() // 撤销
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-image-gen"]').length === 3)
  assert.equal(await page.locator('[data-testid="compare-bar"]').count(), 3)
  console.log('3 选用 乙: it takes the original place and the wire to the preview, 甲 / 丙 removed; 撤销 restores all three')

  // 4. keep one from the node itself (选用 on the node), then run the preview
  await page.locator('.react-flow__node', { has: page.locator('select[aria-label="模型档案"] option:checked', { hasText: '丙 模型' }) }).locator('[data-testid="compare-pick-node"]').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-image-gen"]').length === 1)
  assert.equal(await page.inputValue('[data-testid="node-image-gen"] select[aria-label="模型档案"]'), profs[2].id)
  const before = calls.length
  await page.locator('[data-testid="node-preview"] [data-testid="run-node"]').click()
  await confirmIfAsked()
  await page.waitForSelector('[data-testid="node-preview"] img.media', { timeout: 15000 })
  assert.equal(calls.length, before, 'the kept result is reused: no new model call')
  console.log('4 选用 on the node keeps 丙; the preview then shows its result without calling the model again')

  // 5. any 2 results can be compared from the selection (no 选用 outside a comparison)
  await page.locator('[data-testid="node-image-gen"] .ntitle').click()
  await page.locator('[data-testid="node-preview"] .ntitle').click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] })
  await page.locator('[data-testid="node-preview"] .ntitle').click({ button: 'right' })
  await page.click('[data-testid="ctx-compare-view"]')
  await page.waitForSelector('[data-testid="compare-view"]')
  assert.equal(await page.locator('[data-testid="compare-col"]').count(), 2)
  assert.equal(await page.locator('[data-testid="compare-pick"]').count(), 0)
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="compare-view"]', { state: 'detached' })
  console.log('5 two selected results: 并排比较 shows them side by side (no 选用 outside a comparison); Esc closes')

  // 6. the inspector offers the same entry
  await page.keyboard.press('Escape') // clear the two-node selection
  await page.waitForFunction(() => !document.querySelector('.react-flow__node.selected'))
  await page.locator('[data-testid="node-image-gen"] .ntitle').click()
  await page.click('[data-testid="insp-compare"]')
  await page.waitForSelector('[data-testid="compare-setup"]')
  assert.ok(await page.locator('[data-testid="compare-option"]', { hasText: '丙 模型' }).locator('input').isChecked())
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="compare-setup"]', { state: 'detached' })
  console.log('6 属性面板「多模型对比…」 opens the same chooser with the current model fixed')

  console.log('console/page errors:', errors.length ? errors : 'none')
  assert.equal(errors.length, 0)
  await browser.close()
  mock.close()
  console.log('E2E OK')
})().catch((e) => { console.error(e); process.exit(1) })
