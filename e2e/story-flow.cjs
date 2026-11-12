// E2E for rc.15 「参考与分镜」. Starts its own mock OpenAI-compatible chat, Replicate and Seedance (Ark) server.
//  1. a subject node: name, picture, description
//  2. @ in a prompt suggests it; the run sends its description and picture (image model)
//  3. a video prompt mentioning it: Seedance receives the picture as reference_image; a wired 参考图 too
//  4. the director's storyboard in the table: edit a cell, delete a shot, add one, save → new version;
//     expand only the selected shot to the canvas
//   HZC_URL=http://127.0.0.1:8788 node e2e/story-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const path = require('node:path')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const MP4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex')
const STORYBOARD = JSON.stringify({ title: '海边', shots: [
  { title: '开场', visual: '海边的灯塔', camera: '远景', dialogue: '', duration: 4, image_prompt: '灯塔', video_prompt: '推近' },
  { title: '小橘', visual: '小橘看海', camera: '中景', dialogue: '喵', duration: 5, image_prompt: '小橘看海', video_prompt: '抬头' },
  { title: '收尾', visual: '夕阳', camera: '全景', dialogue: '', duration: 3, image_prompt: '夕阳', video_prompt: '拉远' },
] })

const hits = []
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
        if (req.url === '/v1/chat/completions') return send({ choices: [{ message: { content: STORYBOARD } }] })
        if (req.method === 'POST' && /^\/rep\/v1\/models\//.test(req.url)) return send({ id: 'p1', status: 'starting' })
        if (req.url === '/rep/v1/predictions/p1') return send({ id: 'p1', status: 'succeeded', output: [`${base}/files/out.png`] })
        if (req.method === 'POST' && req.url === '/ark/contents/generations/tasks') return send({ id: 'cgt-1' })
        if (req.url === '/ark/contents/generations/tasks/cgt-1') return send({ id: 'cgt-1', status: 'succeeded', content: { video_url: `${base}/files/out.mp4` } })
        if (req.url === '/files/out.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG) }
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
  await api('POST', '/api/profiles', { name: '编剧', kind: 'llm', adapter: 'openai-compat', endpoint: `${M}/v1`, model: 'writer', apiKey: 'sk-llm' })
  await api('POST', '/api/profiles', { name: '画图', kind: 'image', adapter: 'replicate', endpoint: `${M}/rep/v1`, model: 'owner/img', apiKey: 'r8-key' })
  await api('POST', '/api/profiles', { name: 'Seedance', kind: 'video', adapter: 'ark', endpoint: `${M}/ark`, model: 'doubao-seedance-2-5', apiKey: 'ark-key' })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
  const confirmIfAsked = async () => { const b = page.locator('[data-testid="confirm-run"]'); await b.waitFor({ timeout: 4000 }).then(() => b.click()).catch(() => {}) }
  const runDone = () => page.waitForSelector('[data-testid="run-all"]', { timeout: 60000 })
  /** the request the run is expected to make (the run button shows again before a run starts, too) */
  const waitHit = async (test) => { for (let i = 0; i < 200; i++) { const h = hits.find(test); if (h) return h; await page.waitForTimeout(100) } throw new Error('expected request never came') }

  // 1. a subject node
  await page.dragAndDrop('[data-testid="palette-subject"]', '.react-flow__pane', { targetPosition: { x: 60, y: 60 } })
  const subject = page.locator('[data-testid="node-subject"]')
  await subject.locator('[data-testid="subject-name"]').fill('小橘')
  await subject.locator('[data-testid="subject-upload"]').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG })
  await subject.locator('.subj-img img').waitFor()
  await subject.locator('[data-testid="subject-desc"]').fill('橘色短毛猫，绿眼睛，戴红色项圈')
  assert.match(await subject.locator('.ntitle').innerText(), /@小橘/)
  console.log('1 subject node: @小橘 with a picture and a description')

  // 2. @ in an image prompt suggests it; the run carries description + picture
  await page.dragAndDrop('[data-testid="profile-画图"]', '.react-flow__pane', { targetPosition: { x: 460, y: 60 } })
  const img = page.locator('[data-testid="node-image-gen"]')
  const prompt = img.locator('[data-testid="gen-prompt"]')
  await prompt.click()
  // a slow machine (as on CI): typing right after picking a mention must land after it
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await prompt.pressSequentially('@小')
  await page.waitForSelector('[data-testid="mention-list"]')
  await page.screenshot({ path: path.join(OUT, 'canvas-story-1-mention.png') })
  await prompt.press('Enter')
  assert.equal(await prompt.inputValue(), '@小橘 ')
  await prompt.pressSequentially('坐在礁石上')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  assert.equal(await prompt.inputValue(), '@小橘 坐在礁石上')
  await img.locator('[data-testid="run-node"]').click()
  await confirmIfAsked()
  await runDone()
  const rep = await waitHit((h) => h.method === 'POST' && h.url.startsWith('/rep/v1/models/'))
  assert.match(rep.json.input.prompt, /^小橘 坐在礁石上\n\n设定：\n- 小橘（人物）：橘色短毛猫/)
  assert.match(String(rep.json.input.image), /^data:image\/png;base64,/)
  console.log('2 @ suggests the subject; the image model got its description and picture')

  // 3. a video mentioning it: Seedance gets the picture as reference_image
  await page.dragAndDrop('[data-testid="profile-Seedance"]', '.react-flow__pane', { targetPosition: { x: 880, y: 60 } })
  const vid = page.locator('[data-testid="node-video-gen"]')
  await vid.locator('[data-testid="gen-prompt"]').fill('@小橘 跑向镜头，镜头跟拍')
  await vid.locator('[data-testid="run-node"]').click()
  await confirmIfAsked()
  await runDone()
  const ark = await waitHit((h) => h.method === 'POST' && h.url === '/ark/contents/generations/tasks')
  assert.equal(ark.json.content.filter((c) => c.role === 'reference_image').length, 1)
  assert.match(ark.json.content[0].text, /^小橘 跑向镜头/)
  console.log('3 Seedance received the subject picture as reference_image')

  // 4. the storyboard table
  await page.dragAndDrop('[data-testid="palette-director"]', '.react-flow__pane', { targetPosition: { x: 60, y: 560 } })
  const dir = page.locator('[data-testid="node-director"]')
  await dir.locator('[data-testid="director-idea"]').fill('@小橘 在海边的一天')
  await dir.locator('[data-testid="run-node"]').click()
  await confirmIfAsked()
  const chat = (await waitHit((h) => h.url === '/v1/chat/completions')).json
  await dir.locator('[data-testid="edit-storyboard"]').waitFor()
  assert.match(chat.messages.at(-1).content, /小橘（人物）：橘色短毛猫/, 'the director knows the subject')
  await dir.locator('[data-testid="edit-storyboard"]').click()
  await page.waitForSelector('[data-testid="storyboard-table"]')
  assert.equal(await page.locator('[data-testid="storyboard-row"]').count(), 3)
  await page.locator('[data-testid="storyboard-row"]').nth(1).locator('[data-testid="sb-visual"]').fill('小橘在礁石上看日落')
  await page.locator('[data-testid="storyboard-row"]').nth(2).locator('[data-testid="sb-delete"]').click()
  await page.click('[data-testid="sb-add"]')
  await page.locator('[data-testid="storyboard-row"]').nth(2).locator('[data-testid="sb-visual"]').fill('小橘回家')
  await page.screenshot({ path: path.join(OUT, 'canvas-story-2-table.png') })
  await page.click('[data-testid="sb-save"]')
  await page.waitForSelector('.toast:has-text("分镜已保存")')
  const saved = await api('GET', `/api/projects/${(await api('GET', '/api/projects'))[0].id}/outputs`)
  const sb = saved.find((o) => o.outputs.out?.[0]?.type === 'storyboard').outputs.out[0]
  assert.deepEqual(sb.shots.map((s) => s.visual), ['海边的灯塔', '小橘在礁石上看日落', '小橘回家'])
  const before = await page.locator('.react-flow__node').count()
  await page.locator('[data-testid="storyboard-row"]').nth(1).locator('input[type="checkbox"]').check()
  await page.click('[data-testid="sb-expand"]')
  await page.waitForSelector('[data-testid="storyboard-table"]', { state: 'detached' })
  await page.waitForSelector('.react-flow__node .ntitle:has-text("镜头 2 · 画面")')
  assert.equal(await page.locator('.react-flow__node .ntitle:has-text("镜头 1 · 画面")').count(), 0, 'only the selected shot')
  assert.ok((await page.locator('.react-flow__node').count()) > before)
  console.log('4 storyboard table: edit, delete, add, save as a version; expand only the selected shot')

  assert.deepEqual(errors, [])
  console.log('story-flow: all passed')
  await browser.close()
  mock.close()
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1) })
