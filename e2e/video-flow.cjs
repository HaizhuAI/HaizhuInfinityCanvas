// E2E for beta.5/6 (needs ffmpeg on PATH): upload a 3-shot video -> video prompt reverse (keyframes,
// storyboard) -> expand into remake rows + Export; then export the original clip to a finished film.
//   HZC_URL=http://127.0.0.1:8788 node e2e/video-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const seen = []
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
        const j = JSON.parse(body || '{}'); seen.push(j)
        const n = (j.messages?.at(-1)?.content ?? []).filter((c) => c.type === 'image_url').length
        const shots = Array.from({ length: n }, (_, i) => ({ title: ['黑场开场', '白光', '红色收尾'][i] ?? `镜头${i + 1}`, visual: `第 ${i + 1} 个纯色画面`, camera: '固定机位', image_prompt: `solid color frame ${i + 1}, cinematic`, video_prompt: '缓慢推近' }))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: '三色短片', shots }) } }] }))
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}
const api = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json()

;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hzc-e2e-v-'))
  const video = path.join(tmp, 'three.mp4')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=480x270:d=1.5:r=25', '-f', 'lavfi', '-i', 'color=c=white:s=480x270:d=1.5:r=25', '-f', 'lavfi', '-i', 'color=c=red:s=480x270:d=1.5:r=25',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]', '-map', '[v]', '-c:v', 'libx264', video])
  const mock = await startMock()
  const vlm = await api('POST', '/api/profiles', { name: '通义视觉', kind: 'vlm', adapter: 'openai-compat', endpoint: `http://127.0.0.1:${mock.address().port}/v1`, model: 'qwen-vl' })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1840, height: 1000 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(BASE + '/')
  const pick = async (t, nth = 0) => { await page.locator(`[data-testid="node-${t}"] .ntitle`).nth(nth).click(); await page.waitForSelector('[data-testid="inspector"]') }
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')

  // settings shows FFmpeg ready
  await page.click('[data-testid="open-settings"]'); await page.click('.tab:has-text("关于")')
  await page.waitForSelector('[data-testid="ffmpeg-status"]:has-text("已就绪")')
  await page.click('[aria-label="关闭"]')
  console.log('1 settings: FFmpeg detected')

  await page.click('[data-testid="template-video-reverse"]')
  await page.waitForSelector('[data-testid="node-video-reverse"]')
  await page.setInputFiles('[data-testid="upload-video"]', video)
  await page.waitForSelector('[data-testid="node-video"] video')
  await page.selectOption('[data-testid="node-video-reverse"] select[aria-label="模型档案"]', vlm.id)
  await page.locator('[data-testid="node-video-reverse"] [data-testid="run-node"]').click()
  await page.waitForSelector('[data-testid="node-video-reverse"] [data-testid="shot-list"]', { timeout: 30000 })
  assert.equal(await page.locator('[data-testid="node-video-reverse"] .shot img.thumb').count(), 3, 'three shots with keyframe thumbnails')
  assert.equal(seen[0].messages.at(-1).content.filter((c) => c.type === 'image_url').length, 3)
  console.log('2 video reverse: 3 cuts found, 3 keyframes sent to the VLM, storyboard with thumbnails')
  await page.waitForTimeout(400)
  await page.screenshot({ path: OUT + '/ui5-video-reverse.png' })

  const before = await page.locator('.react-flow__node').count()
  await page.click('[data-testid="expand-storyboard"]')
  await page.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n, before + 3 * 3 + 2)
  assert.equal(await page.locator('[data-testid="node-image"] .nmedia img').count(), 3, 'one keyframe image node per shot')
  assert.equal(await page.locator('[data-testid="node-export"]').count(), 1)
  console.log('3 expanded into remake rows: keyframe -> image-gen (reference) -> video-gen, plus subtitles + Export')
  await page.waitForTimeout(600)
  await page.screenshot({ path: OUT + '/ui5-remake.png' })

  // export: wire the uploaded clip straight into the generated Export node and run it
  await page.locator('[data-testid="fit-view"]').click(); await page.waitForTimeout(400)
  const handle = (t, id, kind, nth = 0) => page.locator(`.react-flow__node:has([data-testid="node-${t}"]) .react-flow__handle[data-handleid="${id}"].${kind}`).nth(nth)
  // connect the uploaded clip to the Export node by dragging between the handles
  const src = handle('video', 'out', 'source'), dst = handle('export', 'video', 'target')
  const a = await src.boundingBox(), b = await dst.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 14 }); await page.mouse.up()
  // the three video-gen rows have not been generated: keep only the real clip -> export edge
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")', { timeout: 8000 })
  const proj = (await api('GET', '/api/projects'))[0]
  const p = await api('GET', `/api/projects/${proj.id}`)
  const exportId = p.graph.nodes.find((n) => n.type === 'export').id
  const videoId = p.graph.nodes.find((n) => n.type === 'video').id
  const g = { ...p.graph, edges: p.graph.edges.filter((e) => e.target !== exportId || e.source === videoId) }
  assert.ok(g.edges.some((e) => e.source === videoId && e.target === exportId), 'clip wired into export')
  await api('PUT', `/api/projects/${proj.id}`, { graph: g })
  await page.reload(); await page.waitForSelector('[data-testid="node-export"]')
  await pick('export')
  await page.selectOption('[data-testid="inspector"] [data-testid="export-size"]', '1280x720')
  await page.click('[data-testid="inspector"] label.switch:has([data-testid="export-edit-project"])')
  assert.equal(await page.isChecked('[data-testid="inspector"] [data-testid="export-edit-project"]'), true)
  await page.click('[data-testid="inspector"] [data-testid="insp-run"]')
  await page.waitForSelector('[data-testid="node-export"] video.media', { timeout: 60000 })
  await page.waitForSelector('[data-testid="inspector"] [data-testid="download-output"]')
  console.log('4 export: finished film shown in the node, download offered in the inspector')
  const pkgHref = await page.getAttribute('[data-testid="inspector"] [data-testid="out-file"]', 'href', { timeout: 10000 })
  const pkg = Buffer.from(await (await fetch(BASE + pkgHref)).arrayBuffer())
  assert.equal(pkg.subarray(0, 2).toString(), 'PK')
  for (const name of ['haizhu-edit/project.mlt', 'haizhu-edit/clips/shot-01.mp4', 'haizhu-edit/README.txt']) assert.ok(pkg.includes(name), `editor package lacks ${name}`)
  console.log('5 editor project (Shotcut / MLT) offered under 交付文件, with the clip inside')
  await page.screenshot({ path: OUT + '/ui5-export.png' })

  // portable project bundle: export .hzc from the canvas menu, import it as a new canvas
  await page.click('[data-testid="project-menu"]')
  await page.screenshot({ path: OUT + '/ui6-menu.png' })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="export-bundle"]')])
  const saved = await dl.path()
  const bundle = fs.readFileSync(saved)
  assert.equal(bundle.subarray(0, 2).toString(), 'PK')
  assert.ok(bundle.includes('project.json'))
  assert.match(dl.suggestedFilename(), /\.hzc$/)
  await page.setInputFiles('[data-testid="import-file"]', saved)
  await page.waitForSelector('input[aria-label="画布名称"][value$="（导入）"]', { timeout: 30000 })
  await page.waitForSelector('[data-testid="node-export"] video.media', { timeout: 15000 })
  await page.waitForSelector('[data-testid="node-video"] video', { timeout: 15000 })
  console.log(`6 .hzc round trip (${(bundle.length / 1024).toFixed(0)} KB): source clip and finished film come back in the imported canvas`)

  await browser.close(); mock.close()
  console.log('console/page errors:', errors.length ? errors : 'none')
  if (errors.length) process.exit(2)
  console.log('E2E OK')
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1) })
