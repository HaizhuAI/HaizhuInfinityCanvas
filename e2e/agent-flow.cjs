// E2E for rc.4 (kaworkai-inspired parts): canvas assistant (plan -> approve -> add / add & run, extends
// the canvas), 我的画布 (duplicate / rename / delete), prompt library, view toggles, theme switch,
// Ctrl S / Esc / F / Alt-drag.
//   HZC_URL=http://127.0.0.1:8788 node e2e/agent-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const asked = []
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        if (req.url === '/v1/images/generations') return res.end(JSON.stringify({ data: [{ b64_json: PNG }] }))
        const j = JSON.parse(body || '{}'); const user = j.messages?.at(-1)?.content ?? ''
        asked.push(user)
        let reply
        const latest = user.split('用户的新消息：').pop() ?? ''
        if (/配音/.test(latest)) {
          // extend the canvas: connect to the existing text node the request mentions
          const id = /@(\S+?)｜text/.exec(user)?.[1]
          reply = { reply: '接上配音。', plan: { nodes: [{ key: 'v', type: 'tts', label: '旁白配音' }], edges: [{ from: `@${id}`, fromPort: 'out', to: 'v', toPort: 'in' }] } }
        } else {
          reply = { reply: '先写画面，再出图。', plan: { nodes: [
            { key: 'a', type: 'text', label: '画面描述', text: '秋日咖啡店橱窗，暖色灯光，落叶' },
            { key: 'b', type: 'image-gen', label: '海报', params: { aspect_ratio: '3:4' } },
          ], edges: [{ from: 'a', fromPort: 'out', to: 'b', toPort: 'prompt' }] } }
        }
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }))
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}
const api = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json()

;(async () => {
  const mock = await startMock()
  const M = `http://127.0.0.1:${mock.address().port}/v1`
  await api('POST', '/api/profiles', { name: '编剧', kind: 'llm', adapter: 'openai-compat', endpoint: M, model: 'writer' })
  const img = await api('POST', '/api/profiles', { name: '海报图', kind: 'image', adapter: 'openai-compat', endpoint: M, model: 'img' })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const count = (sel) => page.locator(sel).count()
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')

  // 1. the assistant turns a sentence into a plan; nothing changes until it is approved
  await page.click('[data-testid="open-assistant"]')
  await page.waitForSelector('[data-testid="assistant"]')
  assert.ok(await count('[data-testid="asst-starter"]') >= 4)
  await page.fill('[data-testid="asst-input"]', '做一张咖啡店秋季新品海报')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-testid="plan-card"]')
  assert.equal(await count('.react-flow__node'), 0, 'not added before approval')
  assert.match(await page.locator('[data-testid="plan-card"]').innerText(), /方案 · 2 个节点[\s\S]*画面描述[\s\S]*海报/)
  await page.screenshot({ path: OUT + '/rc4-assistant-plan.png' })
  await page.click('[data-testid="plan-apply"]')
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 2)
  assert.equal(await count('.react-flow__edge'), 1)
  assert.equal(await page.inputValue('[data-testid="node-image-gen"] select[aria-label="模型档案"]'), img.id, 'the image step uses the configured image model')
  assert.match(await page.locator('[data-testid="plan-card"]').innerText(), /已添加到画布/)
  console.log('1 assistant: request -> plan card (nothing added yet) -> 添加到画布 adds 2 connected nodes with the image model chosen')

  // 2. it reads the canvas: a follow-up connects to the existing text node
  await page.fill('[data-testid="asst-input"]', '再给画面描述加一段配音')
  await page.click('[data-testid="asst-send"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="plan-card"]').length === 2)
  assert.match(asked.at(-1), /@\S+｜text｜画面描述/)
  assert.match(asked.at(-1), /此前的对话/)
  await page.locator('[data-testid="plan-apply"]').last().click()
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 3 && document.querySelectorAll('.react-flow__edge').length === 2)
  console.log('2 follow-up sees the canvas and the conversation; the new TTS node is wired to the existing text node')

  // 3. 添加并运行: a new plan is added and run straight away (through the usual checks)
  await page.fill('[data-testid="asst-input"]', '再来一张海报')
  await page.click('[data-testid="asst-send"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="plan-card"]').length === 3)
  await page.locator('[data-testid="plan-apply-run"]').last().click()
  await page.locator('[data-testid="confirm-run"]').click({ timeout: 10000 }).catch(() => {})
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="node-image-gen"]')].some((n) => n.querySelector('img.media')), null, { timeout: 15000 })
  console.log('3 添加并运行 adds the plan and generates the image')

  // 4. view toggles, theme switch, Ctrl S, Esc, F, Alt-drag
  assert.equal(await count('.react-flow__minimap'), 1)
  await page.click('[data-testid="toggle-minimap"]')
  assert.equal(await count('.react-flow__minimap'), 0)
  await page.click('[data-testid="toggle-snap"]')
  assert.equal(await page.getAttribute('[data-testid="toggle-snap"]', 'aria-pressed'), 'true')
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.click('[data-testid="theme-toggle"]')
  assert.notEqual(await page.evaluate(() => document.documentElement.dataset.theme), theme)
  await page.click('[data-testid="theme-toggle"]')
  await page.click('[data-testid="fit-view"]'); await page.waitForTimeout(400)
  await page.locator('[data-testid="node-tts"] .ntitle').click()
  await page.keyboard.press(`${mod}+s`)
  await page.waitForSelector('[data-testid="toast"]:has-text("已保存")')
  const vp = () => page.evaluate(() => document.querySelector('.react-flow__viewport').style.transform)
  const before = await vp()
  await page.keyboard.press('f')
  await page.waitForFunction((b) => document.querySelector('.react-flow__viewport').style.transform !== b, before)
  await page.keyboard.press('Escape')
  assert.equal(await count('.react-flow__node.selected'), 0)
  const n0 = await count('.react-flow__node')
  const box = await page.locator('[data-testid="node-tts"] .ntitle').boundingBox()
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + 20, box.y + 8); await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 20 + i * 15, box.y + 8 + i * 12)
  await page.mouse.up(); await page.keyboard.up('Alt')
  await page.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n + 1, n0)
  console.log('4 minimap / snap toggles, theme switch, Ctrl S saves, F zooms to the selection, Esc deselects, Alt-drag leaves a copy')

  // 5. prompt library: style word into the selected node; a saved prompt; drag makes a text node
  await page.click('[data-testid="rail-prompts"]')
  await page.click('[data-testid="fit-view"]'); await page.waitForTimeout(400)
  await page.locator('[data-testid="node-image-gen"] .ntitle').first().click()
  await page.locator('[data-testid="prompt-item"]', { hasText: '电影感' }).first().click()
  // this image node takes its prompt from 「画面描述」 over a wire: the style word goes there
  await page.waitForSelector('[data-testid="toast"]:has-text("已加到「画面描述」")')
  const fed = await page.locator('[data-testid="node-text"] textarea').evaluateAll((els) => els.map((e) => e.value))
  assert.ok(fed.some((v) => /秋日咖啡店橱窗.*电影感画面/.test(v)), JSON.stringify(fed))
  await page.fill('[data-testid="prompt-new"]', '暖色窗光，清晨，薄雾')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-testid="prompt-item"]:has-text("暖色窗光")')
  const texts = await count('[data-testid="node-text"]')
  await page.dragAndDrop('[data-testid="prompt-item"]:has-text("暖色窗光")', '.react-flow__pane', { targetPosition: { x: 200, y: 700 } })
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="node-text"]').length === n + 1, texts)
  await page.screenshot({ path: OUT + '/rc4-prompts.png' })
  console.log('5 prompt library: a style word goes into the selected node, a prompt is saved, dragging one makes a text node')

  // 6. 我的画布: duplicate, rename, delete
  await page.click('[data-testid="rail-projects"]')
  await page.waitForSelector('[data-testid="projects"]')
  assert.equal(await count('[data-testid="project-card"]'), 1)
  await page.click('[data-testid="project-duplicate"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="project-card"]').length === 2)
  await page.screenshot({ path: OUT + '/rc4-projects.png' })
  const copy = page.locator('[data-testid="project-card"]', { hasText: '副本' })
  await copy.locator('[data-testid="project-rename"]').click()
  await page.fill('[data-testid="project-rename-input"]', '秋季海报 B')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-testid="project-card"]:has-text("秋季海报 B")')
  await page.locator('[data-testid="project-card"]', { hasText: '秋季海报 B' }).locator('[data-testid="project-delete"]').click()
  await page.click('[data-testid="project-delete-confirm"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="project-card"]').length === 1)
  assert.equal((await api('GET', '/api/projects')).length, 1)
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="projects"]', { state: 'detached' })
  console.log('6 我的画布: 创建副本 (with results), 重命名, 删除 (with confirmation)')

  await browser.close(); mock.close()
  console.log('console/page errors:', errors.length ? errors : 'none')
  if (errors.length) process.exit(2)
  console.log('E2E OK')
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1) })
