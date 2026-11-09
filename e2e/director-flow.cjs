// E2E for v1.0.0-beta.4: director template -> storyboard -> expand onto canvas, "/" command palette,
// double-click quick add, skill import, motion switch. Starts its own mock LLM.
//   HZC_URL=http://127.0.0.1:8788 node e2e/director-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const SHOTS = {
  title: '雨夜机械猫',
  shots: [
    { title: '霓虹街口', visual: '雨夜霓虹街道，积水倒映招牌', camera: '远景，缓慢推进', dialogue: '', duration: 5, image_prompt: '雨夜霓虹街道，积水倒映，电影感', video_prompt: '雨滴斜落，镜头缓慢推进' },
    { title: '机械猫', visual: '一只铜色机械猫抬头张望', camera: '中景，跟拍', dialogue: '我得回家了。', duration: 4, image_prompt: '铜色机械猫，雨夜，电影感', video_prompt: '猫抬头，向前走两步' },
    { title: '窗前', visual: '猫停在亮着暖光的窗前', camera: '特写，固定机位', dialogue: '', duration: 6, image_prompt: '暖光窗前的铜色机械猫，电影感', video_prompt: '窗内灯光闪烁，猫尾轻摆' },
  ],
}
const seen = []
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const json = body ? JSON.parse(body) : {}
        seen.push(json)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify(SHOTS) + '\n```' } }] }))
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}
const api = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json()

;(async () => {
  const mock = await startMock()
  const M = `http://127.0.0.1:${mock.address().port}/v1`
  const llm = await api('POST', '/api/profiles', { name: 'DeepSeek 导演', kind: 'llm', adapter: 'openai-compat', endpoint: M, model: 'deepseek-chat' })
  await api('POST', '/api/profiles', { name: 'Flux 图片', kind: 'image', adapter: 'fal', endpoint: M, model: 'fal-ai/flux' })
  await api('POST', '/api/profiles', { name: 'Kling 视频', kind: 'video', adapter: 'fal', endpoint: M, model: 'fal-ai/kling' })
  await api('POST', '/api/profiles', { name: '配音', kind: 'tts', adapter: 'openai-compat', endpoint: M, model: 'tts-1' })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1840, height: 1000 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(BASE + '/')

  // select a node (opens it in the inspector) by clicking its title
  const pick = async (t, nth = 0) => { await page.locator(`[data-testid="node-${t}"] .ntitle`).nth(nth).click(); await page.waitForSelector('[data-testid="inspector"]') }
  const insp = (tid) => `[data-testid="inspector"] [data-testid="${tid}"]`
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')
  await page.screenshot({ path: OUT + '/ui4-empty.png' })

  // template -> director
  await page.click('[data-testid="template-director"]')
  await page.waitForSelector('[data-testid="node-director"]')
  await page.selectOption('[data-testid="node-director"] select[aria-label="模型档案"]', llm.id)
  await pick('director')
  await page.selectOption(insp('director-shots'), '3')
  await page.locator('[data-testid="node-director"] [data-testid="run-node"]').click()
  await page.waitForSelector('[data-testid="node-director"] [data-testid="shot-list"]', { timeout: 15000 })
  assert.equal(await page.locator('[data-testid="node-director"] .shot').count(), 3)
  const sys = seen[0].messages.find((m) => m.role === 'system').content
  assert.match(sys, /短片导演/); assert.match(sys, /shots 恰好 3 个/); assert.match(sys, /16:9/)
  console.log('1 director template ran: 3-shot storyboard shown; system prompt = short-film skill + contract (3 shots, 16:9)')
  await page.waitForTimeout(500)
  await page.screenshot({ path: OUT + '/ui4-director.png' })

  // expand onto the canvas
  const before = await page.locator('.react-flow__node').count()
  await page.click('[data-testid="expand-storyboard"]')
  await page.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n, before + 9)
  assert.equal(await page.locator('[data-testid="node-image-gen"]').count(), 3)
  assert.equal(await page.locator('[data-testid="node-video-gen"]').count(), 3)
  assert.equal(await page.locator('[data-testid="node-tts"]').count(), 1, 'one voice node: only shot 2 has a line')
  assert.equal(await page.locator('[data-testid="node-image-gen"] [data-testid="gen-prompt"]').first().inputValue(), '雨夜霓虹街道，积水倒映，电影感')
  assert.equal(await page.locator('[data-testid="node-tts"] [data-testid="tts-text"]').inputValue(), '我得回家了。')
  assert.equal(await page.locator('[data-testid="node-export"]').count(), 1, 'an Export node closes the rows')
  assert.equal(await page.locator('.react-flow__edge').count(), 1 + 3 + 3 + 1 + 1, 'image->video per shot, every video + the voice + subtitles -> export')
  assert.equal(await page.locator('[data-testid="node-video-gen"] [data-testid="gen-prompt"]').count(), 3, 'video prompt stays editable (first-frame edge is not a prompt edge)')
  console.log('2 expanded: 3 image + 3 video (first frame) + 1 voice + subtitles + Export, all wired; prompts editable')
  await page.waitForTimeout(700)
  await page.screenshot({ path: OUT + '/ui4-expanded.png' })

  // "/" command palette
  await page.click('.react-flow__pane', { position: { x: 20, y: 20 } })
  await page.keyboard.press('/')
  await page.waitForSelector('[data-testid="palette-input"]')
  await page.fill('[data-testid="palette-input"]', '产品广告')
  await page.waitForTimeout(150)
  await page.screenshot({ path: OUT + '/ui4-palette.png' })
  await page.keyboard.press('Enter')
  await page.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length === n, before + 10)
  await pick('director', 1)
  assert.equal(await page.locator(insp('director-skill')).inputValue(), 'director-product-ad')
  console.log('3 "/" palette: search "产品广告" + Enter adds a director bound to the product-ad skill')

  // double-click on empty canvas opens the palette at that point
  await page.locator('[data-testid="fit-view"]').click()
  await page.waitForTimeout(300)
  const pane = await page.locator('.react-flow__pane').boundingBox()
  await page.mouse.dblclick(pane.x + pane.width - 60, pane.y + 30)
  await page.waitForSelector('.palette-foot:has-text("添加到双击位置")')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[data-testid="palette-input"]').count(), 0)
  console.log('4 double-click on empty canvas opens quick add at that point; Esc closes')

  // settings: skills + import, appearance switch
  await page.click('[data-testid="open-settings"]')
  await page.click('.tab:has-text("Skill")')
  await page.waitForSelector('[data-testid="skill-director-short-film"]')
  await page.click('[data-testid="import-skill"]')
  await page.fill('[data-testid="skill-text"]', '---\nname: long-take\ndescription: 长镜头导演，少剪辑多运镜。\nmetadata:\n  hzc-kind: director\n  hzc-label: 长镜头导演\n---\n\n# 长镜头\n\n每个镜头至少 8 秒。\n')
  await page.click('[data-testid="skill-save"]')
  await page.waitForSelector('[data-testid="skill-long-take"]')
  await page.screenshot({ path: OUT + '/ui4-skills.png' })
  await page.click('.tab:has-text("外观与动效")')
  await page.locator('.switch:has([data-testid="motion-switch"])').click()
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('motion-off')), true)
  await page.locator('.switch:has([data-testid="motion-switch"])').click()
  await page.click('[data-testid="theme-light"]')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light')
  await page.click('[data-testid="theme-dark"]')
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('motion-off')), false)
  await page.click('[aria-label="关闭"]')
  await pick('director')
  const opts = await page.locator(insp('director-skill')).locator('option').allTextContents()
  assert.ok(opts.includes('长镜头导演'), 'imported skill offered in director nodes')
  console.log('5 settings: built-in skills listed, SKILL.md imported and offered in director nodes; motion switch toggles')

  await browser.close(); mock.close()
  console.log('console/page errors:', errors.length ? errors : 'none')
  if (errors.length) process.exit(2)
  console.log('E2E OK')
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1) })
