// E2E for rc.19 「短剧工坊」 (methods from shuohao-skills, Apache-2.0). Starts its own mock Replicate server.
//  1. a subject's 生成参考图组: the anchor first (from the description), its picture goes into the subject;
//     then 「出其余视图」: the other views reference only the anchor, and fill the subject in view order
//  2. importing a shuohao-skills project (the 《渡口》 sample) from the command palette: subjects,
//     one group per segment, keyframes, Seedance segment videos and an export, models bound
//  3. the 负面词 field and the 15-second segment length in the inspector
//   HZC_URL=http://127.0.0.1:8788 node e2e/drama-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const path = require('node:path')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const FIX = path.join(__dirname, 'fixtures', 'shuohao-dukou')
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
        // a different picture each time (bytes after IEND), as a real model would give
        if (m) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.concat([PNG, Buffer.alloc(Number(m[1]), 7)])) }
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
  const img = await api('POST', '/api/profiles', { name: '画图', kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'owner/img', apiKey: 'r8-key' })
  const vid = await api('POST', '/api/profiles', { name: 'Seedance', kind: 'video', adapter: 'ark', endpoint: `${M}/ark`, model: 'doubao-seedance-2-5', apiKey: 'ark-key' })
  const project = await api('POST', '/api/projects', { name: '渡口', graph: { version: 1, nodes: [], edges: [] } })
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

  // 1. a subject's reference set
  await page.dragAndDrop('[data-testid="palette-subject"]', '.react-flow__pane', { targetPosition: { x: 60, y: 60 } })
  const subject = page.locator('[data-testid="node-subject"]')
  assert.equal(await subject.locator('[data-testid="make-refset"]').isDisabled(), true, 'an unnamed subject cannot make a set')
  await subject.locator('[data-testid="subject-name"]').fill('小橘')
  await subject.locator('[data-testid="subject-desc"]').fill('橘色短毛猫，绿眼睛，戴红色项圈')
  await subject.locator('[data-testid="refset-look"]').selectOption('realistic')
  await subject.locator('[data-testid="make-refset"]').click()
  await confirmIfAsked()
  // the anchor runs alone; when the run ends the toast offers the other views
  await page.waitForSelector('[data-testid="toast-action"]:has-text("出其余视图")', { timeout: 30000 })
  assert.equal(predictions().length, 1, 'only the anchor ran')
  const anchorIn = predictions()[0].json.input
  assert.match(anchorIn.prompt, /^Full-body front view/)
  assert.match(anchorIn.prompt, /橘色短毛猫/)
  assert.match(anchorIn.prompt, /A real photograph, not a render/)
  assert.match(anchorIn.negative_prompt, /text/)
  assert.equal(await subject.locator('.subj-img img').count(), 1)
  const frame = page.locator('[data-testid="group"]', { hasText: '@小橘 · 参考图组（写实）' })
  await frame.waitFor()
  assert.equal(await page.locator('[data-testid="node-image-gen"]').count(), 4)
  await page.screenshot({ path: OUT + '/drama-refset-anchor.png' })
  console.log('1a 生成参考图组: anchor from the description (realistic look), its picture is in @小橘')

  await page.click('[data-testid="toast-action"]')
  await confirmIfAsked()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-subject"] .subj-img img').length === 4, null, { timeout: 30000 })
  assert.equal(predictions().length, 4, 'the anchor was not generated again')
  for (const h of predictions().slice(1)) assert.ok(h.json.input.image, 'each view gets the anchor as its reference')
  assert.match(predictions().slice(1).map((h) => h.json.input.prompt).join('\n'), /extreme close-up head-and-shoulders/)
  await saved()
  const subj = (await graph()).nodes.find((n) => n.type === 'subject')
  assert.deepEqual(Object.keys(subj.data.params.refSlots).sort(), ['back-full', 'face-front', 'front-full', 'side-full'])
  assert.equal(subj.data.params.images[0].assetId, subj.data.params.refSlots['front-full'], 'the anchor is the first picture')
  assert.equal(new Set(subj.data.params.images.map((i) => i.assetId)).size, 4)
  console.log('1b 出其余视图: three views from the anchor only; @小橘 now has four pictures in view order')

  // 2. import a shuohao-skills project from the command palette
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('/')
  await page.fill('[data-testid="palette-input"]', '短剧')
  const item = page.locator('[data-testid="palette-item-import:drama"]')
  await item.waitFor()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), item.click()])
  assert.equal(chooser.isMultiple(), true)
  await chooser.setFiles(['outline', 'cast', 'art', 'script', 'storyboard'].map((k) => path.join(FIX, `${k}.json`)))
  await page.waitForSelector('[data-testid="toast"]:has-text("已导入")', { timeout: 30000 })
  assert.match(await page.locator('[data-testid="toast"]').innerText(), /10 段分镜（34 张分镜图）/)
  await saved()
  const g = await graph()
  const of = (t) => g.nodes.filter((n) => n.type === t)
  assert.equal(of('video-gen').length, 10)
  assert.equal(of('image-gen').length, 4 + 34)
  assert.equal(of('export').length, 1)
  assert.equal(of('group').length, 1 + 10)
  assert.ok(of('subject').some((n) => n.data.params?.name === '沈知微' && n.data.params?.kind === 'character'))
  assert.ok(of('image-gen').every((n) => n.data.profileId === img.id))
  assert.ok(of('video-gen').every((n) => n.data.profileId === vid.id))
  const v1 = of('video-gen').find((n) => n.data.label === 'E01-01')
  assert.equal(v1.data.params.duration, 15)
  assert.match(v1.data.text, /【镜头1】[\s\S]*【约束】/)
  // the reference set from step 1 is still there, left of the import
  assert.ok(g.nodes.some((n) => n.type === 'subject' && n.data.params?.name === '小橘'))
  // the view moves to the import (its nodes were outside the view, so never measured): its subjects come first
  await page.locator('[data-testid="node-subject"] .ntitle', { hasText: '@沈知微' }).waitFor({ state: 'visible' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: OUT + '/drama-imported.png' })
  console.log('2 import: 10 segments → 10 groups, 34 keyframes, 10 Seedance videos, an export; models bound')

  // 3. the inspector: a 15-second segment, the negative prompt field
  // typing in the palette also finds nodes on the canvas: jump to the first segment's video
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('/')
  await page.fill('[data-testid="palette-input"]', 'E01-01')
  await page.click(`[data-testid="palette-item-c:${v1.id}"]`)
  await page.waitForSelector('[data-testid="gen-negative"]')
  assert.equal(await page.locator('.insp-sec select:has(option[value="15"])').first().inputValue(), '15')
  await page.fill('[data-testid="gen-negative"]', '字幕，水印')
  await saved()
  assert.equal((await graph()).nodes.find((n) => n.id === v1.id).data.params.negative, '字幕，水印')
  await page.screenshot({ path: OUT + '/drama-segment.png' })
  console.log('3 inspector: the segment keeps 15 s; 负面词 is saved on the node')

  assert.deepEqual(errors, [])
  await browser.close()
  mock.close()
  console.log('drama-flow: all passed')
})().catch((e) => { console.error(e); process.exit(1) })
