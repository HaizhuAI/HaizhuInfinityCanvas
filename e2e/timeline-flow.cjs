// E2E for rc.17 「时间线与分组」 (needs FFmpeg, like video-flow).
//  1. the export node's 时间线: clips listed in canvas order; move one, trim another, preview, save
//  2. the export follows the timeline: order and trims (checked on the film with ffprobe)
//  3. groups: Ctrl G frames the selection; dragging the title bar moves the nodes inside; rename
//  4. save the group as 我的模板 and insert it from the "/" palette; ungroup from the context menu
//  5. reload: frames, their size and the timeline are kept
//   HZC_URL=http://127.0.0.1:8788 node e2e/timeline-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const api = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json()

;(async () => {
  // two 2-second clips: red, then blue
  const dir = mkdtempSync(path.join(tmpdir(), 'hzc-tl-'))
  const clip = (color) => {
    const f = path.join(dir, `${color}.mp4`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:d=2:r=25`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f])
    return readFileSync(f)
  }
  const upload = async (bytes, name) => (await fetch(`${BASE}/api/assets`, { method: 'POST', headers: { 'content-type': 'video/mp4', 'x-file-name': name }, body: bytes })).json()
  const red = await upload(clip('red'), 'red.mp4'), blue = await upload(clip('blue'), 'blue.mp4')
  const project = await api('POST', '/api/projects', {
    name: '时间线测试',
    graph: {
      version: 1,
      nodes: [
        { id: 'vr', type: 'video', position: { x: 0, y: 0 }, data: { label: '红色镜头', assetId: red.id, mime: 'video/mp4' } },
        { id: 'vb', type: 'video', position: { x: 0, y: 360 }, data: { label: '蓝色镜头', assetId: blue.id, mime: 'video/mp4' } },
        { id: 'x', type: 'export', position: { x: 520, y: 120 }, data: { label: '成片', params: { size: '320x180', fps: 25 } } },
      ],
      edges: [
        { id: 'e1', source: 'vr', sourceHandle: 'out', target: 'x', targetHandle: 'video' },
        { id: 'e2', source: 'vb', sourceHandle: 'out', target: 'x', targetHandle: 'video' },
      ],
    },
  })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()) })
  await page.addInitScript(() => { try { localStorage.setItem('hzc.composer', 'off') } catch { /* blocked */ } })
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
  // the newest canvas opens first: this one
  await page.waitForSelector('[data-testid="node-export"]')
  const graph = async () => (await api('GET', `/api/projects/${project.id}`)).graph
  const saved = () => page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent?.includes('已保存'), null, { timeout: 15000 })

  // 1. the timeline: canvas order first (red above blue)
  await page.click('[data-testid="open-timeline"]')
  await page.waitForSelector('[data-testid="timeline"]')
  const rows = page.locator('[data-testid="tl-row"]')
  assert.equal(await rows.count(), 2)
  assert.match(await rows.nth(0).innerText(), /红色镜头/)
  await page.waitForFunction(() => document.querySelector('[data-testid="tl-total"]')?.textContent?.includes('0:04.0'), null, { timeout: 10000 })
  // blue first, and only from 0.5 s on; red ends at 1.5 s
  await rows.nth(0).locator('[data-testid="tl-down"]').click()
  assert.match(await rows.nth(0).innerText(), /蓝色镜头/)
  await rows.nth(0).locator('[data-testid="tl-in"]').fill('0.5')
  await rows.nth(1).locator('[data-testid="tl-out"]').fill('1.5')
  await page.waitForFunction(() => document.querySelector('[data-testid="tl-total"]')?.textContent?.includes('0:03.0'))
  await page.click('[data-testid="tl-play"]')
  await page.waitForFunction(() => { const v = document.querySelector('[data-testid="tl-player"]'); return v && !v.paused && v.currentTime > 0.5 }, null, { timeout: 10000 })
  assert.ok((await page.locator('[data-testid="tl-player"]').evaluate((v) => v.currentSrc)).includes(blue.id), 'the preview starts with the first clip of the timeline')
  await page.screenshot({ path: path.join(OUT, 'canvas-timeline-1.png') })
  await page.click('[data-testid="tl-stop"]')
  await page.click('[data-testid="tl-save"]')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="timeline"]', { state: 'detached' })
  await page.waitForSelector('[data-testid="open-timeline"]:has-text("已排序")')
  await saved()
  const xp = (await graph()).nodes.find((n) => n.id === 'x').data.params
  assert.deepEqual(xp.order, ['vb', 'vr'])
  assert.deepEqual(xp.trims, { vb: { in: 0.5 }, vr: { out: 1.5 } })
  console.log('1 timeline: reordered, trimmed, previewed, saved on the export node')

  // 2. the film follows it
  await page.locator('[data-testid="node-export"] [data-testid="run-node"]').click()
  const confirm = page.locator('[data-testid="confirm-run"]')
  await confirm.waitFor({ timeout: 3000 }).then(() => confirm.click()).catch(() => {})
  await page.waitForSelector('[data-testid="node-export"] video.media', { timeout: 60000 })
  const film = (await api('GET', `/api/projects/${project.id}/outputs`)).find((o) => o.nodeId === 'x').outputs.out[0]
  const filmFile = path.join(dir, 'film.mp4')
  writeFileSync(filmFile, Buffer.from(await (await fetch(`${BASE}/api/assets/${film.assetId}`)).arrayBuffer()))
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filmFile]).toString())
  assert.ok(Math.abs(dur - 3) < 0.2, `film is ${dur}s, expected 3s`)
  const px = (t) => [...execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', filmFile, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])]
  assert.ok(px(0.5)[2] > 150 && px(0.5)[0] < 80, 'blue first')
  assert.ok(px(2.2)[0] > 150 && px(2.2)[2] < 80, 'then red')
  console.log('2 the exported film follows the timeline (3.0 s: blue from 0.5 s, then red to 1.5 s)')

  // 3. group the two clips
  const vr = page.locator('[data-testid="node-video"]').nth(0), vb = page.locator('[data-testid="node-video"]').nth(1)
  await vr.locator('.ntitle').click()
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control')
  await vb.locator('.ntitle').click()
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+g' : 'Control+g')
  const group = page.locator('[data-testid="group"]')
  await group.waitFor()
  assert.match(await group.innerText(), /2 个节点/)
  const before = await vb.boundingBox()
  const frameBefore = await group.boundingBox()
  const head = await group.locator('.grp-head').boundingBox()
  await page.mouse.move(head.x + 60, head.y + head.height / 2)
  await page.mouse.down()
  await page.mouse.move(head.x + 160, head.y + head.height / 2 + 80, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const after = await vb.boundingBox()
  const frameAfter = await group.boundingBox()
  const fdx = frameAfter.x - frameBefore.x, fdy = frameAfter.y - frameBefore.y
  assert.ok(fdx > 40 && fdy > 30, `the frame moved (${fdx}, ${fdy})`)
  assert.ok(Math.abs(after.x - before.x - fdx) < 2 && Math.abs(after.y - before.y - fdy) < 2, `members move with the frame: node (${after.x - before.x}, ${after.y - before.y}) vs frame (${fdx}, ${fdy})`)
  await group.locator('.grp-head').dblclick({ position: { x: 30, y: 20 } })
  await page.fill('[data-testid="group-name"]', '开场两镜')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-testid="group"] .grp-name:has-text("开场两镜")')
  await page.screenshot({ path: path.join(OUT, 'canvas-group-1.png') })
  console.log('3 Ctrl G groups the clips; dragging the title bar moves them; renamed')

  // 4. save as a template, insert it again; ungroup from the context menu
  await group.locator('[data-testid="group-save"]').click()
  await page.waitForSelector('[data-testid="toast"]:has-text("已存为模板「开场两镜」")')
  const count0 = await page.locator('.react-flow__node').count()
  await page.keyboard.press('/')
  await page.fill('[data-testid="palette-input"]', '开场两镜')
  await page.waitForSelector('.palette :text("我的模板")')
  await page.keyboard.press('Enter')
  await page.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n + 3, count0)
  assert.equal(await page.locator('[data-testid="group"]').count(), 2)
  await group.first().locator('.grp-head').click({ button: 'right', position: { x: 30, y: 20 } })
  await page.click('[data-testid="ctx-ungroup"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="group"]').length === 1)
  assert.equal(await page.locator('[data-testid="node-video"]').count(), 4, 'ungrouping keeps the nodes')
  console.log('4 saved as 我的模板, inserted from "/", ungrouped (nodes kept)')

  // 5. after a reload the frame (with its size) and the timeline are still there
  await saved()
  const g = await graph()
  const frame = g.nodes.find((n) => n.type === 'group')
  assert.ok(frame && frame.data.size.w > 200 && frame.data.label === '开场两镜')
  await page.reload()
  await page.waitForSelector('[data-testid="group"]')
  const box = await page.locator('[data-testid="group"]').boundingBox()
  assert.ok(box.width > 150 && box.height > 150, 'the frame keeps its size')
  await page.waitForSelector('[data-testid="open-timeline"]:has-text("已排序")')
  console.log('5 reload: frame, size and timeline kept')

  assert.deepEqual(errors, [])
  console.log('timeline-flow: all passed')
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1) })
