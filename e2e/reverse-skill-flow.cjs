// E2E for rc.6: image-reverse skills (e.g. LunarXuan/image-prompt-reverse). Import a skill folder
// as a .zip in Settings → Skill (license, references shown) → pick it as the reverse method → run
// image → reverse (skill) → image generation: the model gets SKILL.md + references, the prompt and
// the negative go to their own ports, the generator gets both. The / palette offers the skill.
// The skill used here is a small fixture written for this test, not third-party text.
//   HZC_URL=http://127.0.0.1:8788 node e2e/reverse-skill-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const zlib = require('node:zlib')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

/** a minimal zip (stored entries) — enough for an upload */
function zip(files) {
  const locals = [], central = []
  let off = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text)
    const n = Buffer.from(name)
    const crc = zlib.crc32(data) >>> 0
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42)
    locals.push(lh, n, data); central.push(ch, n)
    off += 30 + n.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}
const SKILL = zip({
  'photo-reverse-main/SKILL.md': '---\nname: photo-reverse\ndescription: Reverse-engineer image-generation prompts from reference images.\n---\n\n# 照片反推\n\n先读 [framework](references/framework.md)，再读 [negatives](references/negatives.md)。\n',
  'photo-reverse-main/references/framework.md': '# FRAMEWORK-RULES-E2E\n构图、光线、色彩。',
  'photo-reverse-main/references/negatives.md': '# NEGATIVE-RULES-E2E\n按媒介排除错误风格。',
  'photo-reverse-main/LICENSE': 'GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007\n(test fixture header)',
  'photo-reverse-main/agents/openai.yaml': 'interface:\n  display_name: "照片反推"\n',
  'photo-reverse-main/scripts/setup.sh': 'echo never stored',
})
const ANSWER = '### 1. 正向 Prompt\n\n中文：清晨海边的白色灯塔位于画面右侧，低机位仰视，柔和逆光。\n\nEnglish: A white lighthouse on the right at dawn, low angle, soft backlight.\n\n### 2. Negative Prompt\n\ncartoon, 3d render, watermark, blurry'

const seen = { system: [], images: [] }
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        const j = body ? JSON.parse(body) : {}
        res.writeHead(200, { 'content-type': 'application/json' })
        if (req.url === '/v1/chat/completions') {
          seen.system.push(String(j.messages.find((m) => m.role === 'system')?.content ?? ''))
          return res.end(JSON.stringify({ choices: [{ message: { content: ANSWER } }] }))
        }
        if (req.url === '/v1/images/generations') {
          seen.images.push(j.prompt)
          return res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
        }
        res.end('{}')
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}
const api = async (m, u, b, headers = { 'content-type': 'application/json' }) => (await fetch(BASE + u, { method: m, headers, body: b && (Buffer.isBuffer(b) ? b : JSON.stringify(b)) })).json()

;(async () => {
  const mock = await startMock()
  const endpoint = `http://127.0.0.1:${mock.address().port}/v1`
  const vlm = await api('POST', '/api/profiles', { name: '看图', kind: 'vlm', adapter: 'openai-compat', endpoint, model: 'vision', apiKey: 'sk-v' })
  const img = await api('POST', '/api/profiles', { name: '出图', kind: 'image', adapter: 'openai-compat', endpoint, model: 'gpt-image-1', apiKey: 'sk-i' })
  const asset = await api('POST', '/api/assets', PNG, { 'content-type': 'image/png', 'x-file-name': 'ref.png' })
  const project = await api('POST', '/api/projects', { name: '反推', graph: {
    version: 1,
    nodes: [
      { id: 'src', type: 'image', position: { x: 0, y: 0 }, data: { assetId: asset.id, mime: 'image/png', label: '参考图' } },
      { id: 'rev', type: 'image-reverse', position: { x: 380, y: 0 }, data: { profileId: vlm.id } },
      { id: 'gen', type: 'image-gen', position: { x: 780, y: 0 }, data: { profileId: img.id } },
    ],
    edges: [
      { id: 'e1', source: 'src', sourceHandle: 'out', target: 'rev', targetHandle: 'image' },
      { id: 'e2', source: 'rev', sourceHandle: 'out', target: 'gen', targetHandle: 'prompt' },
      { id: 'e3', source: 'rev', sourceHandle: 'negative', target: 'gen', targetHandle: 'negative' },
    ],
  } })

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, colorScheme: 'dark' })
  const errors = []
  let refusing = false // the refused link answers 400, which the browser logs
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !(refusing && /status of 400/.test(m.text()))) errors.push('console: ' + m.text()) })
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="node-image-reverse"]')
  const confirmIfAsked = async () => { const b = page.locator('[data-testid="confirm-run"]'); await b.waitFor({ timeout: 5000 }).then(() => b.click()).catch(() => {}) }

  // 1. the reverse node points to Settings → Skill; import the skill folder as a .zip
  await page.locator('[data-testid="node-image-reverse"] .ntitle').click()
  await page.click('[data-testid="reverse-import-skill"]')
  await page.waitForSelector('[data-testid="skill-import"]')
  await page.setInputFiles('[data-testid="skill-zip-input"]', { name: 'photo-reverse-main.zip', mimeType: 'application/zip', buffer: SKILL })
  await page.waitForSelector('[data-testid="skill-photo-reverse"]')
  assert.match(await page.locator('[data-testid="toast"]').innerText(), /已导入「照片反推」（图片反推 · GPL-3\.0 · 2 份参考文件）/)
  const card = await page.locator('[data-testid="skill-photo-reverse"]').innerText()
  assert.match(card, /GPL-3\.0/)
  assert.match(card, /2 份参考文件/)
  assert.equal(await page.inputValue('[data-testid="skill-kind-photo-reverse"]'), 'image-reverse')
  assert.match(await page.locator('.skill-group', { has: page.locator('[data-testid="skill-photo-reverse"]') }).locator('h4').innerText(), /图片反推 Skill/)
  await page.screenshot({ path: OUT + '/rc6-skills.png' })
  // a link that isn't GitHub is refused with an explanation
  await page.fill('[data-testid="skill-url"]', 'https://example.com/a/b')
  refusing = true
  await page.click('[data-testid="skill-url-import"]')
  await page.waitForSelector('[data-testid="skill-error"]:has-text("只支持 GitHub")')
  refusing = false
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="dialog"][aria-label="设置"]', { state: 'detached' })
  console.log('1 Settings → Skill: a skill .zip is imported (照片反推 · 图片反推 · GPL-3.0 · 2 references); non-GitHub links are refused')

  // 2. choose it as the reverse method; the node shows which skill it uses
  await page.locator('[data-testid="node-image-reverse"] .ntitle').click()
  await page.selectOption('[data-testid="inspector"] [data-testid="reverse-style"]', 'skill:photo-reverse')
  await page.waitForSelector('[data-testid="reverse-skill-chip"]:has-text("照片反推")')
  assert.match(await page.locator('[data-testid="reverse-skill-info"]').innerText(), /GPL-3\.0/)
  console.log('2 反推方式 → 照片反推: the node shows the skill, the inspector its license and references')

  // 3. run the generator: reverse with the skill, then generate with prompt + negative
  await page.locator('[data-testid="node-image-gen"] [data-testid="run-node"]').click()
  await confirmIfAsked()
  await page.waitForSelector('[data-testid="node-image-gen"] img.media', { timeout: 20000 })
  assert.ok(seen.system[0].includes('FRAMEWORK-RULES-E2E') && seen.system[0].includes('NEGATIVE-RULES-E2E'), 'the model got SKILL.md with its reference files')
  assert.ok(!seen.system[0].includes('never stored'), 'scripts are never part of it')
  assert.equal(seen.images[0], '清晨海边的白色灯塔位于画面右侧，低机位仰视，柔和逆光。\n\nAvoid: cartoon, 3d render, watermark, blurry')
  assert.match(await page.locator('[data-testid="node-image-reverse"] [data-testid="out-text"]').first().innerText(), /^清晨海边的白色灯塔/)
  assert.match(await page.locator('[data-testid="node-image-reverse"] [data-testid="reverse-negative"]').innerText(), /cartoon, 3d render, watermark, blurry/)
  await page.locator('[data-testid="node-image-reverse"] .ntitle').click()
  await page.click('[data-testid="reverse-full"] summary')
  assert.match(await page.locator('[data-testid="reverse-full"]').innerText(), /English: A white lighthouse/)
  await page.screenshot({ path: OUT + '/rc6-reverse-skill.png' })
  console.log('3 run: Chinese prompt to 提示词, negatives to 负面词; the generator got "prompt + Avoid: negatives"; the full answer is in the inspector')

  // 4. switching to English sends the English prompt next time
  await page.click('[data-testid="inspector"] [role="radio"]:has-text("English")')
  await page.locator('[data-testid="node-image-gen"] [data-testid="run-node"]').click()
  await confirmIfAsked()
  await page.waitForFunction(() => /^A white lighthouse/.test(document.querySelector('[data-testid="node-image-reverse"] [data-testid="out-text"]')?.textContent ?? ''), null, { timeout: 15000 })
  for (let i = 0; i < 50 && seen.images.length < 2; i++) await page.waitForTimeout(100)
  assert.equal(seen.images[1], 'A white lighthouse on the right at dawn, low angle, soft backlight.\n\nAvoid: cartoon, 3d render, watermark, blurry')
  console.log('4 输出语言 English: the English prompt goes downstream')

  // 5. the / palette offers installed reverse skills
  await page.locator('.react-flow__pane').click({ position: { x: 30, y: 600 } })
  await page.keyboard.press('/')
  await page.fill('[data-testid="palette-input"]', '照片反推')
  await page.click('[data-testid="palette-item-rs:photo-reverse"]')
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="reverse-skill-chip"]').length === 2)
  console.log('5 / → 照片反推 adds a reverse node that already uses the skill')

  console.log('console/page errors:', errors.length ? errors : 'none')
  assert.equal(errors.length, 0)
  await browser.close()
  mock.close()
  void project
  console.log('E2E OK')
})().catch((e) => { console.error(e); process.exit(1) })
