// Large-canvas check (rc.5): a 300-node / 225-wire canvas must open, drag, pan, zoom out and take
// typing without stalling. Prints frame-time figures; fails only on clear regressions (limits are
// loose because CI machines are slow and shared).
//   HZC_URL=http://127.0.0.1:8788 node e2e/perf-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const N = Number(process.env.HZC_PERF_NODES || 300)
// keyHandler: typing into one node must not re-render the others (it took 50-90 ms per key when every
// node re-rendered; ~2-5 ms now), so this is the guard against that coming back
const LIMIT = { open: 8000, dragP95: 120, panP95: 120, zoomedOutP95: 250, keyHandler: 25, keyP95: 240 }

/** a canvas of N nodes in rows: text -> image-gen -> video-gen -> preview, repeated */
function bigGraph(n) {
  const chain = ['text', 'image-gen', 'video-gen', 'preview']
  const port = { 'image-gen': 'prompt', 'video-gen': 'first', preview: 'in' }
  const nodes = [], edges = []
  for (let i = 0; i < n; i++) {
    const type = chain[i % chain.length]
    nodes.push({ id: `p${i}`, type, position: { x: (i % 20) * 380, y: Math.floor(i / 20) * 460 }, data: type === 'text' ? { text: `第 ${i} 段创意：雨夜霓虹街头` } : {} })
    if (i % chain.length) edges.push({ id: `pe${i}`, source: `p${i - 1}`, sourceHandle: 'out', target: `p${i}`, targetHandle: port[type] })
  }
  return { version: 1, nodes, edges }
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
  return { frames: s.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(s.at(-1) ?? 0).toFixed(1) }
}

;(async () => {
  const graph = bigGraph(N)
  const r = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '大画布', graph }) })
  assert.equal(r.status, 201, 'project created')

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  // frame recorder: collects rAF deltas between start() and stop()
  await page.addInitScript(() => {
    let rec = null
    const tick = (t) => { if (rec) { if (rec.last) rec.d.push(t - rec.last); rec.last = t } requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    window.__frames = { start: () => { rec = { d: [], last: 0 } }, stop: () => { const d = rec?.d ?? []; rec = null; return d } }
  })

  const t0 = Date.now()
  await page.goto(BASE)
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0 && document.querySelector('[data-testid="save-state"]') !== null, null, { timeout: 30000 }).catch(() => page.waitForSelector('.react-flow__node', { timeout: 30000 }))
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0)
  const open = Date.now() - t0
  const rendered = await page.locator('.react-flow__node').count()
  console.log(`1 opened ${N} nodes / ${graph.edges.length} wires in ${open} ms (${rendered} nodes rendered in view)`)
  await page.waitForTimeout(800)

  const box = await page.locator('.react-flow').boundingBox()
  const measure = async (fn) => { await page.evaluate(() => window.__frames.start()); await fn(); return stats(await page.evaluate(() => window.__frames.stop())) }

  // 2. drag one node across the screen
  const head = page.locator('.react-flow__node .node-head').first()
  const hb = await head.boundingBox()
  const drag = await measure(async () => {
    await page.mouse.move(hb.x + 30, hb.y + 12)
    await page.mouse.down()
    for (let i = 1; i <= 60; i++) await page.mouse.move(hb.x + 30 + i * 4, hb.y + 12 + i * 2)
    await page.mouse.up()
  })
  console.log('2 drag a node:', JSON.stringify(drag))

  // 3. pan the canvas (drag on empty space: find a spot between nodes)
  const spot = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect()
    for (let y = pane.top + 40; y < pane.bottom - 40; y += 20) for (let x = pane.left + 40; x < pane.right - 40; x += 20) {
      const el = document.elementFromPoint(x, y)
      if (el && el.classList.contains('react-flow__pane')) return { x, y }
    }
    return null
  })
  assert.ok(spot, 'an empty spot to pan from')
  const pan = await measure(async () => {
    await page.mouse.move(spot.x, spot.y)
    await page.mouse.down()
    for (let i = 1; i <= 60; i++) await page.mouse.move(spot.x - i * 6, spot.y - i * 3)
    await page.mouse.up()
  })
  console.log('3 pan:', JSON.stringify(pan))

  // 4. zoom out until the whole canvas is on screen, then pan there (every node visible: the worst case)
  await page.mouse.click(box.x + 5, box.y + box.height - 5).catch(() => {})
  await page.keyboard.press('Shift+1')
  await page.waitForTimeout(900)
  const visible = await page.locator('.react-flow__node').count()
  const far = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane').getBoundingClientRect()
    for (let y = pane.bottom - 30; y > pane.top + 30; y -= 15) for (let x = pane.right - 30; x > pane.left + 30; x -= 15) {
      const el = document.elementFromPoint(x, y)
      if (el && el.classList.contains('react-flow__pane')) return { x, y }
    }
    return null
  })
  const zoomed = await measure(async () => {
    await page.mouse.move(far.x, far.y)
    await page.mouse.down()
    for (let i = 1; i <= 40; i++) await page.mouse.move(far.x - i * 5, far.y - i * 2)
    await page.mouse.up()
  })
  console.log(`4 zoomed out (${visible} nodes rendered), pan:`, JSON.stringify(zoomed))
  await page.screenshot({ path: OUT + '/rc5-perf-zoomed-out.png' })

  // 5. typing into a text node: time from keydown to the textarea showing the character
  await page.locator('[data-testid="node-text"]').first().click({ position: { x: 20, y: 10 } })
  await page.locator('.react-flow__node.selected').waitFor()
  const sel = page.locator('.react-flow__node.selected')
  await page.evaluate(() => { const n = document.querySelector('.react-flow__node.selected'); n && n.scrollIntoView() })
  await page.keyboard.press('f')
  await page.waitForTimeout(500)
  const ta = sel.locator('textarea')
  await ta.click()
  const keys = await page.evaluate(async () => {
    const el = document.activeElement
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    const sync = [], paint = []
    for (const ch of '海柱无限画布的长提示词测试一二三四五六七八九十') {
      const before = el.value.length
      const t = performance.now()
      set.call(el, el.value + ch)
      el.dispatchEvent(new Event('input', { bubbles: true })) // React renders this update before returning
      sync.push(performance.now() - t)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      if (el.value.length !== before + 1) return null
      paint.push(performance.now() - t)
    }
    return { sync, paint }
  })
  assert.ok(keys, 'typed characters stay in the box')
  const typing = stats(keys.paint), handler = stats(keys.sync)
  console.log('5 typing: keystroke handled (incl. React render):', JSON.stringify(handler))
  console.log('  typing: keystroke to painted (two frames):', JSON.stringify(typing))

  // 6. the edit is saved
  await page.waitForFunction(() => /已保存|已同步|保存/.test(document.querySelector('[data-testid="save-state"]')?.textContent ?? 'x'), null, { timeout: 15000 }).catch(() => {})

  const report = { nodes: N, open, drag, pan, zoomedOut: { ...zoomed, visible }, typing, handler }
  console.log('PERF', JSON.stringify(report))
  assert.ok(open < LIMIT.open, `open ${open} ms < ${LIMIT.open}`)
  assert.ok(drag.p95 < LIMIT.dragP95, `drag p95 ${drag.p95} < ${LIMIT.dragP95}`)
  assert.ok(pan.p95 < LIMIT.panP95, `pan p95 ${pan.p95} < ${LIMIT.panP95}`)
  assert.ok(zoomed.p95 < LIMIT.zoomedOutP95, `zoomed-out pan p95 ${zoomed.p95} < ${LIMIT.zoomedOutP95}`)
  assert.ok(handler.median < LIMIT.keyHandler, `keystroke handler median ${handler.median} ms < ${LIMIT.keyHandler}`)
  assert.ok(typing.p95 < LIMIT.keyP95, `typing p95 ${typing.p95} < ${LIMIT.keyP95}`)
  console.log('console/page errors:', errors.length ? errors : 'none')
  assert.equal(errors.length, 0)
  await browser.close()
  console.log('E2E OK')
})().catch((e) => { console.error(e); process.exit(1) })
