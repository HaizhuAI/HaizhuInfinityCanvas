import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { AccountStore, checkPassword, hashPassword, normalizeEmail, verifyPassword } from './accounts'
import { Workspaces } from './workspaces'
import { SecretBox } from './secrets'
import { runAdmin } from './admin'

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 7)])
const ORIGIN = 'http://localhost'

describe('passwords and emails', () => {
  it('hashes with a salt and verifies only the right password', async () => {
    const a = await hashPassword('correct horse battery')
    const b = await hashPassword('correct horse battery')
    expect(a).not.toBe(b)
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true)
    expect(await verifyPassword('correct horse battery', a)).toBe(true)
    expect(await verifyPassword('correct horse batterz', a)).toBe(false)
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
  it('normalizes emails and refuses weak passwords', () => {
    expect(normalizeEmail('  Ann@Example.COM ')).toBe('ann@example.com')
    for (const bad of ['', 'ann', 'ann@', '@example.com', 'a b@example.com', 'ann@exa_mple.com', 42]) expect(() => normalizeEmail(bad)).toThrow()
    for (const bad of ['short', '12345678', 'aaaaaaaaaa', 'password1', 'ann@example.com']) expect(() => checkPassword(bad, 'ann@example.com')).toThrow()
    expect(checkPassword('teal-lantern-42', 'ann@example.com')).toBe('teal-lantern-42')
  })
})

describe('accounts mode', () => {
  let dir: string
  let app: FastifyInstance
  let accounts: AccountStore
  let workspaces: Workspaces

  const start = async (o: { signup?: boolean; quotaBytes?: number; trustProxy?: boolean } = {}) => {
    accounts = new AccountStore(join(dir, 'accounts.sqlite'))
    workspaces = new Workspaces(dir, { secrets: new SecretBox(join(dir, 'master.key')), quotaBytes: o.quotaBytes })
    app = await buildApp({ accounts: { accounts, workspaces, signup: o.signup ?? true }, trustProxy: o.trustProxy })
  }
  beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'hzc-acct-')); await start() })
  afterEach(async () => { await app.close(); workspaces.closeAll(); accounts.close(); rmSync(dir, { recursive: true, force: true }) })

  const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie'] ?? '').split(';')[0]!
  const signup = async (email: string, password = 'teal-lantern-42') => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { origin: ORIGIN }, payload: { email, password } })
    expect(res.statusCode, res.body).toBe(201)
    return cookieOf(res)
  }
  const as = (cookie: string) => ({
    get: (url: string) => app.inject({ url, headers: { cookie } }),
    send: (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
      app.inject({ method, url, headers: { cookie, origin: ORIGIN, ...headers }, payload: payload as never }),
  })

  it('requires sign-in for the API, but not for health and the sign-in routes', async () => {
    expect((await app.inject({ url: '/api/projects' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/api/projects' })).json()).toMatchObject({ login: true })
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/auth/config' })).json()).toMatchObject({ accounts: true, signup: true })
    expect((await app.inject({ url: '/api/auth/me' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/api/projects', headers: { cookie: 'hzc_session=forged' } })).statusCode).toBe(401)
  })

  it('signs up with a safe session cookie and keeps each workspace private', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { origin: ORIGIN }, payload: { email: 'Ann@Example.com', password: 'teal-lantern-42' } })
    expect(res.statusCode).toBe(201)
    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toMatch(/^hzc_session=[\w-]{40,};/)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    const ann = as(cookieOf(res))
    expect((await ann.get('/api/auth/me')).json()).toMatchObject({ email: 'ann@example.com' })

    // Ann's work
    const project = (await ann.send('POST', '/api/projects', { name: 'Ann 的画布' })).json()
    const asset = (await app.inject({ method: 'POST', url: '/api/assets', headers: { cookie: cookieOf(res), origin: ORIGIN, 'content-type': 'image/png' }, payload: png })).json()
    const profile = (await ann.send('POST', '/api/profiles', { name: 'Ann 的模型', kind: 'llm', adapter: 'openai-compat', endpoint: 'https://api.example.com/v1', model: 'm', apiKey: 'sk-ann' })).json()
    await ann.send('POST', '/api/prompts', { text: 'Ann 的提示词' })

    // Bob sees none of it and can touch none of it
    const bob = as(await signup('bob@example.com'))
    expect((await bob.get('/api/projects')).json().map((p: { name: string }) => p.name)).not.toContain('Ann 的画布')
    expect((await bob.get(`/api/projects/${project.id}`)).statusCode).toBe(404)
    expect((await bob.send('PUT', `/api/projects/${project.id}`, { name: 'hacked' })).statusCode).toBe(404)
    expect((await bob.send('DELETE', `/api/projects/${project.id}`)).statusCode).toBe(404)
    expect((await bob.send('POST', `/api/projects/${project.id}/run`, {})).statusCode).toBe(404)
    expect((await bob.get(`/api/projects/${project.id}/bundle`)).statusCode).toBe(404)
    expect((await bob.get(`/api/projects/${project.id}/outputs`)).statusCode).toBe(404)
    expect((await bob.get(`/api/assets/${asset.id}`)).statusCode).toBe(404)
    expect((await bob.send('DELETE', `/api/assets/${asset.id}`)).statusCode).toBe(404)
    expect((await bob.get('/api/assets')).json()).toEqual([])
    expect((await bob.get('/api/profiles')).json()).toEqual([])
    expect((await bob.send('PUT', `/api/profiles/${profile.id}`, { name: 'x', kind: 'llm', adapter: 'openai-compat', endpoint: 'https://x', model: 'm' })).statusCode).toBe(404)
    expect((await bob.send('POST', '/api/profiles/test', { adapter: 'openai-compat', endpoint: 'https://x', profileId: profile.id })).json().status).toBe('error')
    expect((await bob.get('/api/prompts')).json().some((p: { text: string }) => p.text === 'Ann 的提示词')).toBe(false)

    // Ann still has everything; her files live in her own folder
    expect((await ann.get(`/api/projects/${project.id}`)).statusCode).toBe(200)
    expect((await ann.get(`/api/assets/${asset.id}`)).statusCode).toBe(200)
    const annUser = accounts.findByEmail('ann@example.com')!
    expect(existsSync(join(dir, 'users', annUser.id, 'hzc.sqlite'))).toBe(true)
  })

  it('a run id from another account is useless', async () => {
    const ann = as(await signup('ann@example.com'))
    const p = (await ann.send('POST', '/api/projects', { name: 'p', graph: { version: 1, nodes: [{ id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'hi' } }], edges: [] } })).json()
    expect(p.id).toBeTruthy()
    const started = await ann.send('POST', `/api/projects/${p.id}/run`, {})
    expect(started.statusCode).toBe(202)
    const { runId } = started.json()
    expect(runId).toBeTruthy()
    const bob = as(await signup('bob@example.com'))
    expect((await bob.send('POST', `/api/runs/${runId}/cancel`)).statusCode).toBe(404)
    const events = await bob.get(`/api/runs/${runId}/events`)
    expect(events.body).toContain('"status":"error"')
  })

  it('signs in and out; wrong passwords look the same and are throttled', async () => {
    await signup('ann@example.com')
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'ann@example.com', password: 'nope-nope-nope' } })
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'who@example.com', password: 'nope-nope-nope' } })
    expect(wrong.statusCode).toBe(401)
    expect(unknown.json()).toEqual(wrong.json())
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'ANN@example.com', password: 'teal-lantern-42' } })
    expect(ok.statusCode).toBe(200)
    const s = as(cookieOf(ok))
    expect((await s.get('/api/projects')).statusCode).toBe(200)
    const out = await s.send('POST', '/api/auth/logout')
    expect(out.statusCode).toBe(204)
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0')
    expect((await s.get('/api/projects')).statusCode).toBe(401)
    for (let i = 0; i < 10; i++) await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'ann@example.com', password: `wrong-${i}-xxxx` } })
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'ann@example.com', password: 'teal-lantern-42' } })
    expect(locked.statusCode).toBe(429)
  })

  it('refuses duplicate, weak and cross-site sign-ups, and closed sign-up', async () => {
    await signup('ann@example.com')
    const dup = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { origin: ORIGIN }, payload: { email: 'ANN@example.com', password: 'another-pass-9' } })
    expect(dup.statusCode).toBe(409)
    const weak = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { origin: ORIGIN }, payload: { email: 'c@example.com', password: '12345678' } })
    expect(weak.statusCode).toBe(400)
    const evil = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { origin: 'https://evil.example' }, payload: { email: 'd@example.com', password: 'teal-lantern-42' } })
    expect(evil.statusCode).toBe(403)
    const evilLogin = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: 'https://evil.example' }, payload: { email: 'ann@example.com', password: 'teal-lantern-42' } })
    expect(evilLogin.statusCode).toBe(403)
    await app.close(); workspaces.closeAll(); accounts.close()
    await start({ signup: false })
    const closed = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { origin: ORIGIN }, payload: { email: 'e@example.com', password: 'teal-lantern-42' } })
    expect(closed.statusCode).toBe(403)
    expect((await app.inject({ url: '/api/auth/config' })).json().signup).toBe(false)
  })

  it('limits sign-ups per address', async () => {
    for (let i = 0; i < 5; i++) await signup(`u${i}@example.com`)
    const sixth = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { origin: ORIGIN }, payload: { email: 'u6@example.com', password: 'teal-lantern-42' } })
    expect(sixth.statusCode).toBe(429)
  })

  it('limits sign-up attempts per address (no bulk checking which emails are registered)', async () => {
    await signup('ann@example.com')
    let last = 0
    for (let i = 0; i < 30; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { origin: ORIGIN }, payload: { email: 'ann@example.com', password: 'teal-lantern-42' } })).statusCode
    expect(last).toBe(429)
  })

  it('over HTTPS only the __Host- session cookie is accepted', async () => {
    await app.close(); workspaces.closeAll(); accounts.close()
    await start({ trustProxy: true })
    const https = { host: 'localhost', 'x-forwarded-proto': 'https' }
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { ...https, origin: 'https://localhost' }, payload: { email: 'ann@example.com', password: 'teal-lantern-42' } })
    const token = String(res.headers['set-cookie']).split(';')[0]!.split('=')[1]!
    expect((await app.inject({ url: '/api/projects', headers: { ...https, cookie: `__Host-hzc_session=${token}` } })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/projects', headers: { ...https, cookie: `hzc_session=${token}` } })).statusCode).toBe(401)
  })

  it('changing the password signs out other sessions; deleting the account removes its workspace', async () => {
    const first = await signup('ann@example.com')
    const second = cookieOf(await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: 'ann@example.com', password: 'teal-lantern-42' } }))
    const a = as(first)
    expect((await a.send('POST', '/api/auth/password', { current: 'wrong-wrong-1', next: 'new-lantern-77' })).statusCode).toBe(400)
    expect((await a.send('POST', '/api/auth/password', { current: 'teal-lantern-42', next: 'new-lantern-77' })).statusCode).toBe(204)
    expect((await a.get('/api/projects')).statusCode).toBe(200)
    expect((await as(second).get('/api/projects')).statusCode).toBe(401)
    const id = accounts.findByEmail('ann@example.com')!.id
    expect(existsSync(join(dir, 'users', id))).toBe(true)
    expect((await a.send('POST', '/api/auth/delete-account', { password: 'teal-lantern-42' })).statusCode).toBe(400)
    expect((await a.send('POST', '/api/auth/delete-account', { password: 'new-lantern-77' })).statusCode).toBe(204)
    expect(existsSync(join(dir, 'users', id))).toBe(false)
    expect(accounts.findByEmail('ann@example.com')).toBeUndefined()
    expect((await a.get('/api/projects')).statusCode).toBe(401)
  })

  it('enforces the storage quota and frees space when a file is deleted', async () => {
    await app.close(); workspaces.closeAll(); accounts.close()
    await start({ quotaBytes: 150 })
    const cookie = await signup('ann@example.com')
    const up = (bytes: Buffer) => app.inject({ method: 'POST', url: '/api/assets', headers: { cookie, origin: ORIGIN, 'content-type': 'image/png' }, payload: bytes })
    const first = await up(png)
    expect(first.statusCode).toBe(201)
    const second = await up(Buffer.concat([png, Buffer.alloc(10, 1)]))
    expect(second.statusCode).toBe(413)
    expect(second.json().error).toContain('存储空间已满')
    expect((await as(cookie).get('/api/system')).json().storage).toMatchObject({ used: png.length, quota: 150 })
    expect((await as(cookie).send('DELETE', `/api/assets/${first.json().id}`)).statusCode).toBe(204)
    expect((await up(Buffer.concat([png, Buffer.alloc(10, 1)]))).statusCode).toBe(201)
  })

  it('uses a __Host- Secure cookie over HTTPS and hides server details', async () => {
    await app.close(); workspaces.closeAll(); accounts.close()
    await start({ trustProxy: true })
    const res = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { host: 'localhost', origin: 'https://localhost', 'x-forwarded-proto': 'https' }, payload: { email: 'ann@example.com', password: 'teal-lantern-42' } })
    expect(res.statusCode).toBe(201)
    const c = String(res.headers['set-cookie'])
    expect(c).toMatch(/^__Host-hzc_session=/)
    expect(c).toContain('Secure')
    const sys = (await app.inject({ url: '/api/system', headers: { host: 'localhost', cookie: c.split(';')[0]!.replace(/^__Host-hzc_session=/, '__Host-hzc_session='), 'x-forwarded-proto': 'https' } })).json()
    expect(sys.accounts).toBe(true)
    expect(sys.node).toBeUndefined()
    expect(sys.platform).toBeUndefined()
  })
})

describe('admin commands', () => {
  it('creates, resets, disables and deletes accounts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hzc-admin-'))
    try {
      const lines: string[] = []
      const out = (s: string) => lines.push(s)
      const secrets = () => new SecretBox(join(dir, 'master.key'))
      expect(await runAdmin(['create-user', 'ann@example.com'], dir, secrets, out)).toBe(0)
      const pw = /临时密码：(\S+)/.exec(lines.join('\n'))![1]!
      let accounts = new AccountStore(join(dir, 'accounts.sqlite'))
      expect(await accounts.authenticate('ann@example.com', pw)).toBeTruthy()
      accounts.close()
      expect(await runAdmin(['create-user', 'ann@example.com'], dir, secrets, out)).toBe(1)
      lines.length = 0
      expect(await runAdmin(['reset-password', 'ann@example.com'], dir, secrets, out)).toBe(0)
      const pw2 = /临时密码：(\S+)/.exec(lines.join('\n'))![1]!
      expect(await runAdmin(['disable', 'ann@example.com'], dir, secrets, out)).toBe(0)
      accounts = new AccountStore(join(dir, 'accounts.sqlite'))
      expect(await accounts.authenticate('ann@example.com', pw2)).toBeUndefined()
      const id = accounts.findByEmail('ann@example.com')!.id
      accounts.close()
      expect(await runAdmin(['enable', 'ann@example.com'], dir, secrets, out)).toBe(0)
      const ws = new Workspaces(dir, { secrets: secrets() })
      ws.get(id).store.createProject('x')
      ws.closeAll()
      expect(existsSync(join(dir, 'users', id))).toBe(true)
      expect(await runAdmin(['delete-user', 'ann@example.com'], dir, secrets, out)).toBe(0)
      expect(existsSync(join(dir, 'users', id))).toBe(false)
      lines.length = 0
      expect(await runAdmin(['users'], dir, secrets, out)).toBe(0)
      expect(lines.at(-1)).toBe('共 0 个账号')
      expect(await runAdmin(['nonsense'], dir, secrets, out)).toBe(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
