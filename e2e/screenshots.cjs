// Screenshots of the main screens for review, taken from a real run of the app against demo
// providers (no real model is called; pictures come from e2e/demo-art.cjs, clips are made from them
// with FFmpeg). Also a smoke test of every major screen: it fails on any console / page error.
//   HZC_URL=http://127.0.0.1:8788 HZC_SHOTS_OUT=./screenshots node e2e/screenshots.cjs
//   (server on a FRESH data dir; needs ffmpeg on PATH)
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const art = require('./demo-art.cjs')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_SHOTS_OUT || path.join(process.env.HZC_E2E_OUT || process.cwd(), 'screenshots')
const SCALE = Number(process.env.HZC_SHOTS_SCALE || 2)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hzc-shots-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/** a minimal zip (stored entries) */
function zip(files) {
  const locals = [], central = []
  let off = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), n = Buffer.from(name), crc = zlib.crc32(data) >>> 0
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42)
    locals.push(lh, n, data); central.push(ch, n)
    off += 30 + n.length + data.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}
// a demo reverse skill (written for this script) so the Skill screens have something to show
const DEMO_SKILL = zip({
  'ref-reverse/SKILL.md': '---\nname: ref-reverse-demo\ndescription: 演示用的参考图反推 Skill：按构图、光线、色彩和材质分析参考图，输出中英文正向提示词与负面词。\n---\n\n# 参考图反推（演示）\n\n先读 [framework](references/framework.md)，再按 [negatives](references/negatives.md) 写负面词。\n',
  'ref-reverse/references/framework.md': '# 分析框架\n\n构图、镜头、光线、色彩、材质、空间层次。',
  'ref-reverse/references/negatives.md': '# 负面词\n\n按媒介排除容易混淆的风格与常见缺陷。',
  'ref-reverse/LICENSE': 'MIT License\n\nCopyright (c) Haizhu Infinity Canvas demo\n',
  'ref-reverse/agents/openai.yaml': 'interface:\n  display_name: "参考图反推（演示）"\n',
})

const STORYBOARD = {
  title: '秋日限定 · 枫糖拿铁',
  shots: [
    { title: '街角的秋天', visual: '黄昏的街角咖啡店，暖黄灯光透出橱窗，枫叶飘落', camera: '远景，缓慢推近', dialogue: '秋天到了，街角的灯又亮了。', duration: 4, image_prompt: '街角咖啡店店面，黄昏，暖黄橱窗灯光，红色遮阳篷，枫叶飘落，电影感', video_prompt: '街角咖啡店，镜头缓慢推近店面，枫叶飘落' },
    { title: '一杯的温度', visual: '咖啡师把牛奶注入咖啡，拉花成形', camera: '俯拍特写', dialogue: '一杯枫糖拿铁，刚刚好的温度。', duration: 4, image_prompt: '俯拍咖啡拉花特写，木质桌面，奶缸注入牛奶，枫叶点缀', video_prompt: '拉花特写，牛奶缓缓注入，俯拍' },
    { title: '窗边的午后', visual: '窗边木桌上的咖啡杯，热气升起，一片枫叶', camera: '平视近景，浅景深', dialogue: '把秋天，喝进心里。', duration: 4, image_prompt: '窗边木桌上的白色咖啡杯，热气升起，旁边一片枫叶，背景暖色光斑，浅景深', video_prompt: '窗边咖啡杯，热气缓缓升起，轻微推近' },
    { title: '落版', visual: '枫叶环绕的咖啡杯，居中构图', camera: '俯拍居中', dialogue: '秋日限定，等你来。', duration: 3, image_prompt: '品牌落版画面，俯拍咖啡杯居中，枫叶环绕成圈，深棕背景', video_prompt: '落版画面，枫叶缓缓旋转' },
  ],
}
const PLAN = {
  reply: '先写一段画面描述，用它出一张海报；再把海报做成 5 秒的推镜头视频，并配一句旁白。确认后我把这 5 个节点加到画布上。',
  plan: {
    nodes: [
      { key: 'a', type: 'text', label: '海报画面', text: '窗边木桌上的白色咖啡杯，热气升起，旁边一片枫叶，背景暖色光斑，浅景深，秋季新品海报' },
      { key: 'b', type: 'image-gen', label: '秋季新品海报', params: { aspect_ratio: '16:9' } },
      { key: 'c', type: 'video-gen', label: '推镜头视频', text: '窗边咖啡杯，镜头缓慢推近，热气升起', params: { aspect_ratio: '16:9' } },
      { key: 'd', type: 'text', label: '旁白', text: '秋日限定，等你来。' },
      { key: 'e', type: 'tts', label: '旁白配音' },
    ],
    edges: [
      { from: 'a', fromPort: 'out', to: 'b', toPort: 'prompt' },
      { from: 'b', fromPort: 'out', to: 'c', toPort: 'first' },
      { from: 'd', fromPort: 'out', to: 'e', toPort: 'in' },
    ],
  },
}
const REVERSED = '### 1. 正向 Prompt\n\n中文：清晨的高山湖泊，三层远山在薄雾中由深到浅依次退远，低矮的太阳位于画面右上，柔和的逆光把雾气染成暖白色；前景是一排深色松树剪影，湖面平静，带有细长的水平反光。冷青色为主色，暖米色点缀，低饱和、空气透视明显，自然风光摄影，细腻颗粒。\n\nEnglish: A mountain lake at dawn, three ridgelines fading into mist, a low sun in the upper right with soft backlight warming the haze; dark pine silhouettes in the foreground, calm water with thin horizontal glints. Cool teal palette with warm cream accents, low saturation, strong aerial perspective, natural landscape photography, fine grain.\n\n### 2. Negative Prompt\n\ncartoon, 3d render, oversaturated, people, buildings, text, watermark, harsh shadows, lens flare, low detail'

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()

  // ---- pictures: SVG scenes rendered to PNG by the browser (one at a time), clips made from them
  const artPage = await browser.newPage({ viewport: { width: art.W, height: art.H } })
  const pngCache = new Map()
  let artQueue = Promise.resolve()
  const renderPng = (svg) => {
    if (!pngCache.has(svg)) pngCache.set(svg, (artQueue = artQueue.then(async () => { await artPage.setContent(`<body style="margin:0">${svg}</body>`); return artPage.screenshot({ clip: { x: 0, y: 0, width: art.W, height: art.H } }) })))
    return pngCache.get(svg)
  }
  let clipNo = 0
  const clipOf = (png) => {
    const src = path.join(TMP, `f${++clipNo}.png`), out = path.join(TMP, `c${clipNo}.webm`)
    fs.writeFileSync(src, png)
    ffmpeg(['-loop', '1', '-i', src, '-vf', "zoompan=z='min(zoom+0.0012,1.12)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=640x360:fps=24", '-t', '2.5', '-c:v', 'libvpx', '-b:v', '900k', '-an', out])
    return fs.readFileSync(out)
  }
  const voice = path.join(TMP, 'voice.mp3')
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=196:duration=2.4', '-af', 'volume=0.15,afade=t=in:d=0.2,afade=t=out:st=2:d=0.4', '-c:a', 'libmp3lame', '-b:a', '64k', voice])
  const VOICE = fs.readFileSync(voice)

  // ---- demo providers
  const delay = { image: 700, chat: 250 }
  const counts = new Map(), jobs = new Map()
  let M = ''
  const srv = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      try {
        const json = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') : {}
        if (req.url === '/v1/models') return json({ data: [{ id: 'demo-writer' }, { id: 'demo-vision' }] })
        if (req.url === '/v1/chat/completions') {
          await sleep(delay.chat)
          const system = String(body.messages.find((m) => m.role === 'system')?.content ?? '')
          const user = body.messages.at(-1).content
          let content
          if (/shots 恰好 (\d+) 个/.test(system)) content = JSON.stringify({ ...STORYBOARD, shots: STORYBOARD.shots.slice(0, Number(RegExp.$1)) })
          else if (/画布助手/.test(system)) content = JSON.stringify(PLAN)
          else if (Array.isArray(user)) content = REVERSED
          else content = '黄昏时分的海边灯塔，立在画面右侧的深色岬角上；天空由深紫过渡到暖橙，落日贴近海平线，一束灯光自塔顶向左扫过海面，水面带着细长的金色反光。宽画幅，电影感，柔和颗粒。'
          return json({ choices: [{ message: { content } }] })
        }
        if (req.url === '/v1/images/generations') {
          const key = `${body.model}|${body.prompt}`
          const v = counts.get(key) ?? 0
          counts.set(key, v + 1)
          const [png] = await Promise.all([renderPng(art.sceneFor(body.prompt, body.model, v)), sleep(delay.image)])
          return json({ data: [{ b64_json: png.toString('base64') }] })
        }
        if (req.url === '/v1/audio/speech') { await sleep(600); res.writeHead(200, { 'content-type': 'audio/mpeg' }); return res.end(VOICE) }
        // fal-style queue for the video model: the clip is made from the first frame it was given
        if (req.method === 'POST' && req.url === '/fal/demo/video') {
          const id = `r${jobs.size + 1}`
          const first = /^data:image\/\w+;base64,(.+)$/s.exec(String(body.image_url ?? ''))
          jobs.set(id, { polls: 0, png: first ? Buffer.from(first[1], 'base64') : await renderPng(art.sceneFor(body.prompt, '', 0)) })
          const u = `${M}/fal/demo/video/requests/${id}`
          return json({ request_id: id, status_url: `${u}/status`, response_url: u, cancel_url: `${u}/cancel` })
        }
        const q = /^\/fal\/demo\/video\/requests\/(r\d+)(\/status|\/cancel)?$/.exec(req.url)
        if (q && jobs.has(q[1])) {
          const job = jobs.get(q[1])
          if (q[2] === '/status') return json(++job.polls < 2 ? { status: 'IN_QUEUE', queue_position: 0 } : { status: 'COMPLETED' })
          if (q[2] === '/cancel') return json({ ok: true })
          return json({ video: { url: `${M}/files/${q[1]}.webm` } })
        }
        const f = /^\/files\/(r\d+)\.webm$/.exec(req.url)
        if (f && jobs.has(f[1])) { const job = jobs.get(f[1]); job.clip ??= clipOf(job.png); res.writeHead(200, { 'content-type': 'video/webm' }); return res.end(job.clip) }
        json({ error: 'not found' }, 404)
      } catch (e) { res.writeHead(500); res.end(String(e)) }
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  M = `http://127.0.0.1:${srv.address().port}`
  const api = async (m, u, b, headers = { 'content-type': 'application/json' }) => (await fetch(BASE + u, { method: m, headers, body: b && (Buffer.isBuffer(b) ? b : JSON.stringify(b)) })).json()

  // ---- the app
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SCALE, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  let n = 0
  const shot = async (name, note) => {
    await page.waitForTimeout(450) // let enter animations and toasts settle
    const file = `${String(++n).padStart(2, '0')}-${name}.png`
    await page.screenshot({ path: path.join(OUT, file) })
    console.log(`${file}  ${note}`)
  }
  const open = async () => { await page.goto(BASE + '/'); await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")') }
  const fit = async () => { await page.click('[data-testid="fit-view"]'); await page.waitForTimeout(450) }
  const confirmIfAsked = async () => { const b = page.locator('[data-testid="confirm-run"]'); await b.waitFor({ timeout: 4000 }).then(() => b.click()).catch(() => {}) }
  const runDone = () => page.waitForSelector('[data-testid="run-all"]', { timeout: 120000 })
  const node = (label) => page.locator('.react-flow__node', { has: page.locator(`.ntitle:text-is("${label}")`) })
  const closeToast = async () => { await page.waitForSelector('[data-testid="toast"]', { state: 'detached', timeout: 8000 }).catch(() => {}) }

  // 1. first run: nothing configured yet
  await open()
  await shot('first-run', '第一次打开：还没有接入模型')
  await page.click('[data-testid="empty-add-model"]')
  await page.waitForSelector('[role="dialog"][aria-label="设置"]')
  await shot('add-model', '接入第一个模型：按类型列出服务商，一点即填')
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')

  // the demo models (stand-ins for your own)
  const P = {}
  for (const [key, name, kind, adapter, model, cost] of [
    ['llm', '写作模型', 'llm', 'openai-compat', 'demo-writer'], ['vlm', '看图模型', 'vlm', 'openai-compat', 'demo-vision'],
    ['photo', '图片 · 写实', 'image', 'openai-compat', 'demo-photo', 0.2], ['illu', '图片 · 插画', 'image', 'openai-compat', 'demo-illustration', 0.12], ['clay', '图片 · 3D', 'image', 'openai-compat', 'demo-3d', 0.3],
    ['video', '视频模型', 'video', 'fal', 'demo/video', 2], ['tts', '配音模型', 'tts', 'openai-compat', 'demo-voice'],
  ]) P[key] = await api('POST', '/api/profiles', { name, kind, adapter, endpoint: adapter === 'fal' ? `${M}/fal` : `${M}/v1`, model, apiKey: 'demo-key', ...(cost ? { cost: { amount: cost, currency: 'CNY' } } : {}) })
  await api('POST', '/api/skills/import-zip', DEMO_SKILL, { 'content-type': 'application/zip' })
  for (const [title, text] of [['电影感逆光', '电影感，逆光，浅景深，柔和颗粒'], ['推镜头', '镜头缓慢推近主体，节奏舒缓']]) await api('POST', '/api/prompts', { title, text })
  await open()
  await shot('templates', '空画布：四个常用模板，或按 / 添加节点')

  // 2. a finished pipeline: idea → writer → picture → clip; reference → reverse (skill) → picture
  const ref = await api('POST', '/api/assets', await renderPng(art.mountains()), { 'content-type': 'image/png', 'x-file-name': 'reference.png' })
  const pipeline = {
    version: 1,
    nodes: [
      { id: 'idea', type: 'text', position: { x: 0, y: 60 }, data: { label: '创意', text: '黄昏的海边灯塔，暖色天空，灯光扫过海面' } },
      { id: 'writer', type: 'llm', position: { x: 380, y: 0 }, data: { label: '润色提示词', profileId: P.llm.id, params: { system: '把用户的创意改写成一段可直接用于文生图的画面描述。' } } },
      { id: 'gen', type: 'image-gen', position: { x: 780, y: 0 }, data: { label: '灯塔 · 画面', profileId: P.photo.id, params: { aspect_ratio: '16:9' } } },
      { id: 'clip', type: 'video-gen', position: { x: 1190, y: 0 }, data: { label: '灯塔 · 视频', profileId: P.video.id, text: '镜头缓慢推近灯塔，海面轻轻起伏', params: { aspect_ratio: '16:9' } } },
      { id: 'ref', type: 'image', position: { x: 0, y: -640 }, data: { label: '参考图', assetId: ref.id, mime: 'image/png' } },
      { id: 'rev', type: 'image-reverse', position: { x: 380, y: -640 }, data: { label: '反推参考图', profileId: P.vlm.id, params: { skill: 'ref-reverse-demo' } } },
      { id: 'gen2', type: 'image-gen', position: { x: 780, y: -640 }, data: { label: '同款 · 画面', profileId: P.photo.id, params: { aspect_ratio: '16:9' } } },
      { id: 'say', type: 'tts', position: { x: 1190, y: -640 }, data: { label: '旁白配音', profileId: P.tts.id, text: '远方的灯，是回家的方向。' } },
    ],
    edges: [
      { id: 'e1', source: 'idea', sourceHandle: 'out', target: 'writer', targetHandle: 'in' },
      { id: 'e2', source: 'writer', sourceHandle: 'out', target: 'gen', targetHandle: 'prompt' },
      { id: 'e3', source: 'gen', sourceHandle: 'out', target: 'clip', targetHandle: 'first' },
      { id: 'e4', source: 'ref', sourceHandle: 'out', target: 'rev', targetHandle: 'image' },
      { id: 'e5', source: 'rev', sourceHandle: 'out', target: 'gen2', targetHandle: 'prompt' },
      { id: 'e6', source: 'rev', sourceHandle: 'negative', target: 'gen2', targetHandle: 'negative' },
    ],
  }
  const projA = await api('POST', '/api/projects', { name: '海边灯塔 · 短片', graph: pipeline })
  await open()
  await page.waitForSelector('[data-testid="node-image-gen"]')
  await page.click('[data-testid="rail-library"]') // close the left panel: more room for the canvas
  await page.click('[data-testid="run-all"]')
  await page.waitForSelector('[data-testid="confirm-run"]')
  await shot('cost-confirm', '运行前：这次会调用哪些模型、预估多少钱')
  await page.click('[data-testid="confirm-run"]')
  await runDone()
  // two more takes of the picture, so there are versions to switch between
  await node('灯塔 · 画面').locator('.ntitle').click()
  for (let k = 2; k <= 3; k++) {
    await page.click('[data-testid="inspector"] button:has-text("重新生成")')
    await confirmIfAsked()
    await page.waitForFunction((want) => document.querySelector('.react-flow__node.selected [data-testid="version-label"]')?.textContent === `${want} / ${want}`, k, { timeout: 30000 })
    await runDone()
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node img.media')].every((i) => i.complete))
  await closeToast()
  await fit()
  await shot('pipeline', '一条完整流程：创意 → 润色 → 出图 → 视频；参考图 → 反推 → 同款；右侧是所选节点的属性与 3 个版本')
  await node('反推参考图').locator('.ntitle').click()
  await page.waitForSelector('[data-testid="reverse-skill-info"]')
  await shot('reverse-skill', '反推节点使用导入的 Skill：正向提示词与负面词分别输出')

  // 3. multi-model comparison on the picture
  await node('灯塔 · 画面').locator('.ntitle').click({ button: 'right' })
  await page.click('[data-testid="ctx-compare"]')
  await page.locator('[data-testid="compare-option"]', { hasText: '图片 · 插画' }).locator('input').check()
  await page.locator('[data-testid="compare-option"]', { hasText: '图片 · 3D' }).locator('input').check()
  await shot('compare-setup', '多模型对比：勾选要比较的模型')
  await page.click('[data-testid="compare-create-run"]')
  await confirmIfAsked()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="compare-bar"]').length === 3)
  await runDone()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="compare-bar"]')].every((b) => b.closest('.react-flow__node').querySelector('img.media')?.complete))
  await closeToast()
  await page.locator('[data-testid="compare-open"]').first().click()
  await page.waitForSelector('[data-testid="compare-view"]')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="compare-col"] img')].length === 3 && [...document.querySelectorAll('[data-testid="compare-col"] img')].every((i) => i.complete))
  await shot('compare-view', '并排查看：三个模型同一段提示词的结果、用时与单价')
  await page.keyboard.press('Escape')

  // 4. a storyboard running in parallel
  const story = {
    version: 1,
    nodes: [
      { id: 'brief', type: 'text', position: { x: 0, y: 0 }, data: { label: '需求', text: '给街角咖啡店的秋季新品「枫糖拿铁」做一条 15 秒的横版短片：温暖、有烟火气。' } },
      { id: 'dir', type: 'director', position: { x: 380, y: 0 }, data: { label: '产品广告导演', profileId: P.llm.id, params: { skill: 'director-product-ad', shots: 3, aspect_ratio: '16:9' } } },
    ],
    edges: [{ id: 'e1', source: 'brief', sourceHandle: 'out', target: 'dir', targetHandle: 'in' }],
  }
  await api('POST', '/api/projects', { name: '咖啡店秋季新品', graph: story })
  await open()
  await page.click('[data-testid="rail-library"]')
  await page.locator('[data-testid="node-director"] [data-testid="run-node"]').click()
  await page.waitForSelector('[data-testid="expand-storyboard"]', { timeout: 30000 })
  await runDone()
  await page.click('[data-testid="toggle-inspector"]') // canvas only
  await page.locator('[data-testid="node-director"] [data-testid="expand-storyboard"]').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node-video-gen"]').length === 3)
  await page.waitForTimeout(700)
  await fit()
  await closeToast()
  delay.image = 3200 // slow enough to see several nodes working at once
  await page.click('[data-testid="run-all"]')
  await page.waitForSelector('[data-testid="confirm-run"]')
  await page.click('[data-testid="confirm-run"]')
  await page.waitForSelector('[data-testid="run-parallel"]')
  await page.waitForFunction(() => document.querySelectorAll('.node.st-running').length >= 4, null, { timeout: 15000 })
  await shot('parallel-run', '分镜展开后一键运行：互不依赖的镜头同时生成（顶栏「同时 4 个」）')
  delay.image = 700
  await runDone()
  await page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node img.media')].every((i) => i.complete))
  await closeToast()
  await fit()
  await shot('storyboard-done', '全部完成：3 个镜头的画面、视频、配音，以及合成的成片')

  // zoomed far out, the canvas reads as a map
  await page.mouse.move(620, 450)
  for (let i = 0; i < 4; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, 240); await page.keyboard.up('Control'); await page.waitForTimeout(120) }
  await page.waitForSelector('.canvas.far')
  await shot('overview', '缩小到全图：节点按类别着色，像一张地图')
  await page.click('[data-testid="toggle-inspector"]')

  // 5. the assistant plans a new canvas
  await api('POST', '/api/projects', { name: '新品海报', graph: { version: 1, nodes: [], edges: [] } })
  await open()
  await page.click('[data-testid="open-assistant"]')
  await page.fill('[data-testid="asst-input"]', '做一张咖啡店秋季新品海报，再把它做成 5 秒的推镜头视频，配一句旁白')
  await page.click('[data-testid="asst-send"]')
  await page.waitForSelector('[data-testid="plan-card"]')
  await page.click('[data-testid="plan-apply-run"]')
  await confirmIfAsked()
  await page.waitForSelector('[data-testid="node-video-gen"] video', { timeout: 60000 })
  await runDone()
  await closeToast()
  await fit()
  await shot('assistant', '画布助手：一句话 → 方案卡片 → 确认后添加并运行')

  // 6. library screens
  await page.click('[data-testid="rail-prompts"]')
  await page.waitForSelector('[data-testid="prompt-item"]')
  await shot('prompt-library', '提示词库：内置风格词与收藏')
  await page.click('[data-testid="rail-projects"]')
  await page.waitForSelector('[data-testid="project-card"]')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="project-card"] img')].every((i) => i.complete))
  await shot('projects', '我的画布：封面、节点数、搜索、副本、导出、删除')
  await page.keyboard.press('Escape')
  await page.click('[data-testid="open-settings"]')
  await page.click('.tab:has-text("Skill")')
  await page.waitForSelector('[data-testid="skill-ref-reverse-demo"]')
  await shot('skills', '设置 → Skill：从 GitHub 或压缩包导入，显示用途、许可证、参考文件')
  await page.click('.tab:has-text("模型档案")')
  await page.locator('[data-testid="pcard-视频模型"] button[aria-label^="编辑"]').click()
  if (!(await page.locator('[data-testid="pf-concurrency"]').count())) await page.click('[data-testid="pf-advanced"]')
  await page.locator('[data-testid="pf-concurrency"]').scrollIntoViewIfNeeded()
  await shot('model-concurrency', '模型档案 → 高级设置：这个模型最多同时运行几个任务')
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await page.waitForSelector('[role="dialog"][aria-label="设置"]', { state: 'detached' })
  await page.keyboard.press('?')
  await page.waitForSelector('[data-testid="shortcuts"]')
  await shot('shortcuts', '快捷键面板')
  await page.keyboard.press('Escape')

  // 7. light theme, on the pipeline canvas
  await page.click('[data-testid="project-menu"]')
  await page.locator('.menu-item', { hasText: '海边灯塔 · 短片' }).click()
  await page.waitForSelector('[data-testid="compare-bar"]')
  await page.click('[data-testid="rail-prompts"]') // close the left panel
  await page.click('[data-testid="tab-inspector"]')
  await node('灯塔 · 画面').locator('.ntitle').click()
  await page.click('[data-testid="theme-toggle"]')
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node img.media')].every((i) => i.complete))
  await fit()
  await shot('light-theme', '浅色主题（同一个画布，含三个对比节点）')
  await page.click('[data-testid="theme-toggle"]')

  console.log('console/page errors:', errors.length ? errors : 'none')
  assert.equal(errors.length, 0)
  await browser.close()
  srv.close()
  fs.rmSync(TMP, { recursive: true, force: true })
  void projA
  console.log(`E2E OK — ${n} screenshots in ${OUT}`)
})().catch((e) => { console.error(e); process.exit(1) })
