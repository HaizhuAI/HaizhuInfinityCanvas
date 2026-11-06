// E2E for the rc.2 usability work: first model with a connection test, auto-bound templates,
// undo / redo, duplicate, copy / paste, the pre-run check (locate), shortcuts sheet, Escape,
// and dropping a file onto the canvas.
//   HZC_URL=http://127.0.0.1:8788 node e2e/ux-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
// a tiny valid PNG (1x1)
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(req.url === '/v1/models' && req.headers.authorization === 'Bearer sk-ux' ? 200 : 401, { 'content-type': 'application/json' })
      res.end(JSON.stringify(req.url === '/v1/models' && req.headers.authorization === 'Bearer sk-ux' ? { data: [{ id: 'story-pro' }, { id: 'story-mini' }] } : { error: 'unauthorized' }))
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}

;(async () => {
  const mock = await startMock()
  const M = `http://127.0.0.1:${mock.address().port}/v1`
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  const count = (sel) => page.locator(sel).count()
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')

  // 1. first model, straight from the empty canvas into the add form (text model preselected)
  await page.click('[data-testid="empty-add-model"]')
  await page.waitForSelector('[data-testid="pf-name"]')
  assert.equal(await page.getAttribute('[data-testid="kind-llm"]', 'aria-checked'), 'true')
  await page.click('[data-testid="preset-custom"]')
  await page.fill('[data-testid="pf-endpoint"]', M)
  await page.fill('[data-testid="pf-key"]', 'sk-wrong')
  await page.click('[data-testid="pf-test"]')
  await page.waitForSelector('[data-testid="pf-test-result"]:has-text("API Key 无效")')
  await page.fill('[data-testid="pf-key"]', 'sk-ux')
  await page.click('[data-testid="pf-test"]')
  await page.waitForSelector('[data-testid="pf-test-result"]:has-text("可用模型 2 个")')
  await page.locator('[data-testid="pf-model-chip"]', { hasText: 'story-pro' }).click()
  assert.equal(await page.inputValue('[data-testid="pf-model"]'), 'story-pro')
  await page.fill('[data-testid="pf-name"]', '编剧')
  await page.screenshot({ path: OUT + '/rc2-add-model.png' })
  await page.click('[data-testid="pf-save"]')
  await page.waitForSelector('[data-testid="pcard-编剧"]', { state: 'detached' }).catch(() => {})
  // opened from the empty canvas with a kind: saving returns to the canvas
  await page.waitForSelector('[role="dialog"][aria-label="设置"]', { state: 'detached' })
  console.log('1 first model: wrong key explained, models listed by 测试连接, chip fills the model ID, save returns to the canvas')

  // 2. a template is bound to the only text model automatically
  await page.click('[data-testid="template-director"]')
  await page.waitForSelector('[data-testid="node-director"]')
  const bound = await page.inputValue('[data-testid="node-director"] select[aria-label="模型档案"]')
  assert.notEqual(bound, '', 'director node bound to the new text model')
  assert.equal(await count('.react-flow__node'), 2)
  console.log('2 template nodes use the configured model without any extra step')

  // 3. undo / redo (the template insert is one step)
  await page.waitForTimeout(600) // let the edit settle into history
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press(`${mod}+z`)
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 0)
  await page.keyboard.press(`${mod}+Shift+z`)
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 2)
  console.log('3 undo removes the template, redo brings it back')

  // 4. duplicate and copy / paste the selected node
  await page.locator('[data-testid="node-director"] .ntitle').click()
  await page.keyboard.press(`${mod}+d`)
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-director"]').length === 2)
  await page.keyboard.press(`${mod}+c`)
  await page.keyboard.press(`${mod}+v`)
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-director"]').length === 3)
  await page.waitForSelector('[data-testid="undo"]:not([disabled])')
  await page.click('[data-testid="undo"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-director"]').length === 2)
  console.log('4 Ctrl+D duplicates, Ctrl+C / Ctrl+V pastes, the toolbar undo button reverts the paste')

  // 5. pre-run check: an empty idea is caught before any model call; 定位 jumps to the node
  await page.fill('[data-testid="node-text"] textarea', '')
  await page.waitForTimeout(500)
  await page.click('[data-testid="run-all"]')
  await page.waitForSelector('[data-testid="preflight"]')
  assert.match(await page.locator('[data-testid="preflight"]').innerText(), /连接的文本节点还是空的/)
  await page.screenshot({ path: OUT + '/rc2-preflight-empty-idea.png' })
  await page.locator('[data-testid="preflight-locate"]').first().click()
  await page.waitForSelector('[data-testid="preflight"]', { state: 'detached' })
  await page.waitForSelector('.react-flow__node.selected')
  console.log('5 empty idea caught before running; 定位 closes the check and selects the node')

  // 6. shortcuts sheet and Escape on overlays
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  await page.keyboard.press('?')
  await page.waitForSelector('[data-testid="shortcuts"]')
  await page.screenshot({ path: OUT + '/rc2-shortcuts.png' })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="shortcuts"]', { state: 'detached' })
  await page.click('[data-testid="open-settings"]')
  await page.click('[data-testid="add-profile"]')
  await page.keyboard.press('Escape') // first Escape leaves the form
  await page.waitForSelector('[data-testid="add-profile"]')
  await page.keyboard.press('Escape') // second closes Settings
  await page.waitForSelector('[role="dialog"][aria-label="设置"]', { state: 'detached' })
  console.log('6 ? opens the shortcuts; Escape closes it; in Settings, Escape leaves the form, then closes')

  // 7. drop an image file from the desktop onto the canvas: it becomes an image node
  const before = await count('[data-testid="node-image"]')
  const dt = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const d = new DataTransfer()
    d.items.add(new File([bytes], 'moodboard.png', { type: 'image/png' }))
    return d
  }, PNG)
  await page.dispatchEvent('.react-flow__pane', 'drop', { dataTransfer: dt, clientX: 700, clientY: 700 })
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="node-image"] img').length === n + 1, before, { timeout: 10000 })
  console.log('7 a file dropped on the canvas becomes an image node')

  // 8. right-click menus: duplicate a node; paste at the pointer on empty canvas
  const directors = await count('[data-testid="node-director"]')
  await page.locator('[data-testid="node-director"] .ntitle').first().click({ button: 'right' })
  await page.waitForSelector('[data-testid="context-menu"]')
  await page.screenshot({ path: OUT + '/rc2-context-node.png' })
  await page.click('[data-testid="ctx-duplicate"]')
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="node-director"]').length === n + 1, directors)
  await page.keyboard.press(`${mod}+c`)
  await page.locator('.react-flow__pane').click({ button: 'right', position: { x: 24, y: 24 } })
  await page.click('[data-testid="ctx-paste"]')
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="node-director"]').length === n + 2, directors)
  console.log('8 right-click: 创建副本 on a node, 粘贴到这里 on the canvas')

  // 9. a failed input node shows why, and the error clears once it is fixed
  await page.dragAndDrop('[data-testid="palette-image"]', '.react-flow__pane', { targetPosition: { x: 200, y: 120 } })
  const empty = page.locator('[data-testid="node-image"]:not(:has(img))')
  await empty.waitFor()
  await page.fill('[data-testid="node-text"] textarea', '雨夜霓虹街头的机械猫') // give the directors an idea again
  await page.waitForTimeout(500)
  await page.click('[data-testid="run-all"]')
  await page.waitForSelector('[data-testid="preflight"]')
  assert.match(await page.locator('[data-testid="preflight"]').innerText(), /还没有上传图片/)
  await page.click('[data-testid="preflight-run-anyway"]')
  await empty.locator('[data-testid="node-error"]').waitFor({ timeout: 15000 })
  assert.match(await empty.locator('[data-testid="node-error"]').innerText(), /还没有上传/)
  // the mock rejects chat calls: the director's error offers to check the model profile
  await page.locator('[data-testid="node-director"] [data-testid="error-action"]:has-text("检查模型档案")').first().waitFor({ timeout: 15000 })
  await page.screenshot({ path: OUT + '/rc2-errors.png' })
  await empty.locator('[data-testid="upload-image"]').setInputFiles({ name: 'fix.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') })
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="node-image"]')].every((n) => !n.querySelector('[data-testid="node-error"]')))
  console.log('9 an empty image node shows "还没有上传" after a run; uploading clears the error; a 401 offers 检查模型档案')

  await page.screenshot({ path: OUT + '/rc2-canvas.png' })
  await browser.close(); mock.close()
  console.log('console/page errors:', errors.length ? errors : 'none')
  if (errors.length) process.exit(2)
  console.log('E2E OK')
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1) })
