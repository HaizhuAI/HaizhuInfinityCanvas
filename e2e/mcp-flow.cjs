// E2E for rc.16 「Agent 接入」: an MCP client (as Claude Code would) works on the canvas the page has open.
//  1. 设置 → Agent 接入: allow agents; the page shows the command to add the canvas to Claude Code
//  2. the agent adds nodes over MCP: they appear on the open page without a reload
//  3. both edit at once: the person types in one node, the agent changes another — both are kept
//  4. paid generation waits for confirm_cost; the agent's run shows its progress and result on the page
//   HZC_URL=http://127.0.0.1:8788 node e2e/mcp-flow.cjs      (server on a FRESH data dir)
const { chromium } = require('playwright')
const http = require('node:http')
const path = require('node:path')
const assert = require('node:assert/strict')

const BASE = process.env.HZC_URL || 'http://127.0.0.1:8788'
const OUT = process.env.HZC_E2E_OUT || process.cwd()
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const prompts = []
function startMock() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
        if (req.url === '/v1/images/generations') {
          prompts.push(JSON.parse(body).prompt)
          // slow enough to see the run going on the page
          return setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ b64_json: PNG }] })) }, 1500)
        }
        res.writeHead(404); res.end('{}')
      })
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}
const api = async (m, u, b) => (await fetch(BASE + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json()

let key = ''
let seq = 0
/** an MCP tool call the way Claude Code sends it (Streamable HTTP, JSON answer) */
async function tool(name, args = {}) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${key}`, 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } }),
  })
  assert.equal(res.status, 200, await res.clone().text())
  const r = (await res.json()).result
  assert.ok(!r.isError, r.content[0].text)
  return JSON.parse(r.content[0].text)
}

;(async () => {
  const mock = await startMock()
  const M = `http://127.0.0.1:${mock.address().port}/v1`
  await api('POST', '/api/profiles', { name: '海报图', kind: 'image', adapter: 'openai-compat', endpoint: M, model: 'img', cost: { amount: 0.2, currency: 'CNY' } })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' })
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(BASE + '/')
  await page.waitForSelector('[data-testid="save-state"]:has-text("已保存")')

  // 1. allow agents in the settings; the command for Claude Code is shown (key masked, copied in full)
  await page.click('[data-testid="open-settings"]')
  await page.click('[data-testid="settings-tab-agent"]')
  await page.waitForSelector('[data-testid="agent-pane"]')
  await page.locator('[data-testid="agent-switch"]').click({ force: true }) // controlled: turns on once the server agreed
  await page.waitForSelector('[data-testid="agent-cmd-http"]')
  const shown = await page.locator('[data-testid="agent-cmd-http"]').innerText()
  assert.match(shown, /^claude mcp add --transport http --scope user haizhu-canvas http:\/\/127\.0\.0\.1:\d+\/mcp --header "Authorization: Bearer hzc_/)
  assert.match(shown, /••••/)
  key = (await api('GET', '/api/agent-access')).token
  assert.ok(!shown.includes(key), 'the key is not on screen until revealed')
  await page.screenshot({ path: path.join(OUT, 'canvas-mcp-1-settings.png') })
  await page.keyboard.press('Escape')
  console.log('1 settings: agent access on, Claude Code command shown')

  // 2. the agent builds on the open canvas: the page shows it at once
  const { projects } = await tool('list_projects')
  const project_id = projects[0].id
  const added = await tool('add_nodes', {
    project_id,
    nodes: [{ key: 'idea', type: 'text', text: '海边灯塔，黄昏' }, { key: 'pic', type: 'image-gen', label: '灯塔海报', params: { aspect_ratio: '3:4' } }],
    edges: [{ from: 'idea', to: 'pic', to_port: 'prompt' }],
  })
  await page.waitForSelector('[data-testid="node-image-gen"]', { timeout: 10000 })
  await page.waitForSelector('[data-testid="toast"]:has-text("Agent 修改了画布")')
  assert.equal(await page.locator('.react-flow__edge').count(), 1)
  console.log('2 nodes added over MCP appear on the open page')

  // 3. editing at the same time: the person types (not saved yet), the agent changes the other node
  await page.locator('[data-testid="node-text"] textarea').fill('海边灯塔，黄昏，海鸥')
  await tool('update_node', { project_id, node_id: added.created.pic, params: { aspect_ratio: '16:9' } })
  await page.waitForFunction(() => document.querySelector('[data-testid="save-state"]')?.textContent?.includes('已保存'), null, { timeout: 15000 })
  await page.waitForTimeout(500)
  const g = (await api('GET', `/api/projects/${project_id}`)).graph
  assert.equal(g.nodes.find((n) => n.id === added.created.idea).data.text, '海边灯塔，黄昏，海鸥', 'the person’s typing was kept')
  assert.equal(g.nodes.find((n) => n.id === added.created.pic).data.params.aspect_ratio, '16:9', 'the agent’s change was kept')
  console.log('3 simultaneous edits merged: both kept')

  // 4. paid work waits for the go-ahead; the agent's run shows on the page
  const ask = await tool('run', { project_id })
  assert.equal(ask.needs_confirmation, true)
  assert.deepEqual(ask.totals, { CNY: 0.2 })
  assert.equal(prompts.length, 0)
  const run = await tool('run', { project_id, confirm_cost: true })
  await page.waitForSelector('[data-testid="toast"]:has-text("Agent 开始运行画布")')
  await page.waitForSelector('[data-testid="node-image-gen"].running, [data-testid="node-image-gen"] .status-running, [data-testid="run-progress"]', { timeout: 10000 }).catch(() => {})
  const done = await tool('wait_for_run', { run_id: run.run_id, timeout_seconds: 60 })
  assert.equal(done.status, 'done')
  assert.deepEqual(prompts, ['海边灯塔，黄昏，海鸥'])
  await page.waitForSelector('[data-testid="node-image-gen"] img.media', { timeout: 10000 })
  await page.screenshot({ path: path.join(OUT, 'canvas-mcp-2-run.png') })
  const results = await tool('get_results', { project_id, node_ids: [added.created.pic] })
  assert.equal(results.results[0].outputs.out[0].type, 'image')
  console.log('4 confirm_cost respected; the agent’s run and result show on the page')

  assert.deepEqual(errors, [])
  console.log('mcp-flow: all passed')
  await browser.close()
  mock.close()
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1) })
