import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGENT_SKILL, AGENT_SKILL_TOOLS } from './agentSkill'
import { MCP_TOOL_NAMES } from './mcp'
import { parseSkill } from './skills'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { SecretBox } from './secrets'
import { SkillStore } from './skills'

/* rc.20: the SKILL.md an agent installs next to the MCP connection */

describe('the agent skill', () => {
  it('is a valid skill that names only tools the server has, and nearly all of them', () => {
    const s = parseSkill(AGENT_SKILL, 'user')
    expect(s).toMatchObject({ name: 'haizhu-canvas' })
    for (const t of AGENT_SKILL_TOOLS) {
      expect(MCP_TOOL_NAMES).toContain(t)
      expect(AGENT_SKILL).toContain(`\`${t}`)
    }
    // a new tool should be taught too (cancel_run is self-explanatory)
    expect(MCP_TOOL_NAMES.filter((t) => !AGENT_SKILL_TOOLS.includes(t))).toEqual(['cancel_run'])
    expect(AGENT_SKILL).toContain('confirm_cost')
  })

  it('is served as markdown, as a download when asked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hzc-skill-'))
    const store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
    const assets = new AssetStore(dir, store)
    const skills = new SkillStore(join(dir, 'none'), dir)
    const app = await buildApp({ store, assets, engine: new Engine(store, assets, { skills }), skills })
    try {
      const r = await app.inject({ method: 'GET', url: '/api/agent/skill?download=1' })
      expect(r.statusCode).toBe(200)
      expect(r.headers['content-type']).toMatch(/text\/markdown/)
      expect(r.headers['content-disposition']).toContain('SKILL.md')
      expect(r.body).toBe(AGENT_SKILL)
    } finally { await app.close(); store.close(); rmSync(dir, { recursive: true, force: true }) }
  })
})
