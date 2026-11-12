import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { AccountStore, type SignupMode } from './accounts'
import { Workspaces } from './workspaces'
import { SecretBox } from './secrets'
import { runAdmin } from './admin'
import type { Mailer } from './mail'

const ORIGIN = 'http://localhost'
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(200, 7)])

describe('admin console and site operations', () => {
  let dir: string
  let app: FastifyInstance
  let accounts: AccountStore
  let workspaces: Workspaces
  let sent: { to: string; subject: string; text: string }[]

  const start = async (o: { signup?: SignupMode; mailer?: boolean; defaultQuotaMb?: number } = {}) => {
    accounts = new AccountStore(join(dir, 'accounts.sqlite'))
    const defaultQuotaMb = o.defaultQuotaMb ?? 50
    workspaces = new Workspaces(dir, {
      secrets: new SecretBox(join(dir, 'master.key')),
      quotaBytes: (id) => (accounts.getUser(id)?.quotaMb ?? defaultQuotaMb) * 1024 * 1024,
      onStorage: (id, b) => accounts.recordStorage(id, b),
      onRun: (id) => accounts.recordRun(id),
    })
    const mailer: Mailer | undefined = o.mailer === false ? undefined : { async send(to, subject, text) { sent.push({ to, subject, text }) } }
    app = await buildApp({ accounts: { accounts, workspaces, signup: o.signup ?? 'open', mailer, adminEmails: ['boss@example.com'], defaultQuotaMb, publicUrl: 'https://canvas.example.com' } })
  }
  const stop = async () => { await app.close(); workspaces.closeAll(); accounts.close() }
  beforeEach(async () => { dir = mkdtempSync(join(tmpdir(), 'hzc-adm-')); sent = []; await start() })
  afterEach(async () => { await stop(); rmSync(dir, { recursive: true, force: true }) })

  const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers['set-cookie'] ?? '').split(';')[0]!
  const post = (url: string, payload?: unknown, cookie = '') => app.inject({ method: 'POST', url, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, payload: payload as never })
  const signup = async (email: string, extra: Record<string, unknown> = {}, password = 'teal-lantern-42') => {
    const res = await post('/api/auth/signup', { email, password, ...extra })
    return { res, cookie: cookieOf(res) }
  }
  const as = (cookie: string) => ({
    get: (url: string) => app.inject({ url, headers: { cookie } }),
    send: (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, headers: { cookie, origin: ORIGIN }, payload: payload as never }),
  })

  it('gives the console only to admins (HZC_ADMIN_EMAILS) and reports usage', async () => {
    const boss = as((await signup('boss@example.com')).cookie)
    const ann = as((await signup('ann@example.com')).cookie)
    expect((await boss.get('/api/auth/me')).json().isAdmin).toBe(true)
    expect((await ann.get('/api/auth/me')).json().isAdmin).toBe(false)
    for (const [m, u] of [['GET', '/api/admin/overview'], ['GET', '/api/admin/users'], ['GET', '/api/admin/invites'], ['POST', '/api/admin/invites'], ['PUT', '/api/admin/settings']] as const) {
      const r = m === 'GET' ? await ann.get(u) : await ann.send(m, u, {})
      expect(r.statusCode, `${m} ${u}`).toBe(403)
    }
    expect((await app.inject({ url: '/api/admin/overview' })).statusCode).toBe(401)
    // Ann works: a file and a run show up in the admin's figures
    await app.inject({ method: 'POST', url: '/api/assets', headers: { cookie: (await signupCookie('ann@example.com')), origin: ORIGIN, 'content-type': 'image/png' }, payload: png })
    const p = (await ann.send('POST', '/api/projects', { name: 'p', graph: { version: 1, nodes: [{ id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'hi' } }], edges: [] } })).json()
    expect(p.id, JSON.stringify(p)).toBeTruthy()
    const run = await ann.send('POST', `/api/projects/${p.id}/run`, {})
    expect(run.statusCode, run.body).toBe(202)
    const ov = (await boss.get('/api/admin/overview')).json()
    expect(ov).toMatchObject({ users: 2, admins: 1, signupMode: 'open', defaultQuotaMb: 50 })
    expect(ov.bytes).toBe(png.length)
    expect(ov.runs).toBe(1)
    const list = (await boss.get('/api/admin/users?q=ann')).json()
    expect(list.total).toBe(1)
    expect(list.users[0]).toMatchObject({ email: 'ann@example.com', usage: { bytes: png.length, runs: 1 }, effectiveQuotaMb: 50 })
  })
  // sign in again as an existing account (a second session)
  const signupCookie = async (email: string) => cookieOf(await post('/api/auth/login', { email, password: 'teal-lantern-42' }))

  it('runs the invite-only sign-up mode with links that are used up and can be revoked', async () => {
    const boss = as((await signup('boss@example.com')).cookie)
    expect((await boss.send('PUT', '/api/admin/settings', { signupMode: 'sometimes' })).statusCode).toBe(400)
    expect((await boss.send('PUT', '/api/admin/settings', { signupMode: 'invite' })).json().signupMode).toBe('invite')
    expect((await app.inject({ url: '/api/auth/config' })).json()).toMatchObject({ signupMode: 'invite', signup: true, passwordReset: true })
    expect((await signup('ann@example.com')).res.statusCode).toBe(403)
    expect((await signup('ann@example.com', { invite: 'made-up-code' })).res.json().error).toContain('无效')
    const made = (await boss.send('POST', '/api/admin/invites', { maxUses: 1, days: 3, note: '给 Ann' })).json()
    expect(made.link).toBe(`https://canvas.example.com/signup?invite=${made.code}`)
    expect(made.invite).toMatchObject({ maxUses: 1, uses: 0, active: true, note: '给 Ann', label: made.code.slice(0, 4) })
    // a failed sign-up (weak password) does not use the place up
    expect((await signup('ann@example.com', { invite: made.code }, '12345678')).res.statusCode).toBe(400)
    expect((await signup('ann@example.com', { invite: made.code })).res.statusCode).toBe(201)
    expect((await signup('bob@example.com', { invite: made.code })).res.statusCode).toBe(403)
    const two = (await boss.send('POST', '/api/admin/invites', { maxUses: 5 })).json()
    expect((await boss.send('DELETE', `/api/admin/invites/${two.invite.id}`)).statusCode).toBe(204)
    expect((await signup('bob@example.com', { invite: two.code })).res.statusCode).toBe(403)
    const invites = (await boss.get('/api/admin/invites')).json()
    expect(invites.map((i: { uses: number; active: boolean }) => [i.uses, i.active])).toEqual([[0, false], [1, false]])
    expect(JSON.stringify(invites)).not.toContain(made.code) // only a hash is kept
    await boss.send('PUT', '/api/admin/settings', { signupMode: 'closed' })
    expect((await signup('carol@example.com', { invite: made.code })).res.statusCode).toBe(403)
  })

  it("disables, resets, limits and deletes accounts, but never the admin's own", async () => {
    const bossCookie = (await signup('boss@example.com')).cookie
    const boss = as(bossCookie)
    const annCookie = (await signup('ann@example.com')).cookie
    const ann = as(annCookie)
    const bossId = accounts.findByEmail('boss@example.com')!.id
    const annId = accounts.findByEmail('ann@example.com')!.id
    expect((await boss.send('POST', `/api/admin/users/${bossId}/disable`, { disabled: true })).statusCode).toBe(400)
    expect((await boss.send('POST', `/api/admin/users/${bossId}/admin`, { admin: false })).statusCode).toBe(400)
    expect((await boss.send('DELETE', `/api/admin/users/${bossId}`)).statusCode).toBe(400)
    expect((await boss.send('POST', `/api/admin/users/not-a-uuid/disable`, {})).statusCode).toBe(404)

    expect((await boss.send('POST', `/api/admin/users/${annId}/disable`, { disabled: true })).statusCode).toBe(200)
    expect((await ann.get('/api/projects')).statusCode).toBe(401)
    expect((await post('/api/auth/login', { email: 'ann@example.com', password: 'teal-lantern-42' })).statusCode).toBe(401)
    await boss.send('POST', `/api/admin/users/${annId}/disable`, { disabled: false })
    const { password } = (await boss.send('POST', `/api/admin/users/${annId}/reset-password`)).json()
    expect(password).toMatch(/^[A-Za-z2-9]{18}$/)
    const again = await post('/api/auth/login', { email: 'ann@example.com', password })
    expect(again.statusCode).toBe(200)
    const ann2 = as(cookieOf(again))

    // storage limit for one account, applied at once
    expect((await boss.send('PUT', `/api/admin/users/${annId}/quota`, { mb: 0 })).statusCode).toBe(400)
    expect((await boss.send('PUT', `/api/admin/users/${annId}/quota`, { mb: 1 })).statusCode).toBe(200)
    const big = Buffer.concat([png, Buffer.alloc(1024 * 1024)])
    expect((await app.inject({ method: 'POST', url: '/api/assets', headers: { cookie: cookieOf(again), origin: ORIGIN, 'content-type': 'image/png' }, payload: big })).statusCode).toBe(413)
    await boss.send('PUT', `/api/admin/users/${annId}/quota`, { mb: null })
    expect((await app.inject({ method: 'POST', url: '/api/assets', headers: { cookie: cookieOf(again), origin: ORIGIN, 'content-type': 'image/png' }, payload: big })).statusCode).toBe(201)

    // another admin can be made, and then demoted
    await boss.send('POST', `/api/admin/users/${annId}/admin`, { admin: true })
    expect((await ann2.get('/api/admin/overview')).statusCode).toBe(200)
    await boss.send('POST', `/api/admin/users/${annId}/admin`, { admin: false })
    expect((await ann2.get('/api/admin/overview')).statusCode).toBe(403)

    expect(existsSync(join(dir, 'users', annId))).toBe(true)
    expect((await boss.send('DELETE', `/api/admin/users/${annId}`)).statusCode).toBe(204)
    expect(existsSync(join(dir, 'users', annId))).toBe(false)
    expect((await ann2.get('/api/projects')).statusCode).toBe(401)
  })

  it('resets a forgotten password by mail without revealing which emails have accounts', async () => {
    const first = (await signup('ann@example.com')).cookie
    const unknown = await post('/api/auth/forgot', { email: 'nobody@example.com' })
    const known = await post('/api/auth/forgot', { email: 'ANN@example.com' })
    expect(unknown.statusCode).toBe(202)
    expect(known.statusCode).toBe(202)
    expect(unknown.body).toBe(known.body)
    await new Promise((r) => setTimeout(r, 20))
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('ann@example.com')
    const token = /https:\/\/canvas\.example\.com\/reset\?token=([\w-]+)/.exec(sent[0]!.text)![1]!
    // a weak new password is refused and the link stays usable
    expect((await post('/api/auth/reset', { token, password: '12345678' })).statusCode).toBe(400)
    const ok = await post('/api/auth/reset', { token, password: 'new-lantern-77' })
    expect(ok.statusCode).toBe(200)
    expect(String(ok.headers['set-cookie'])).toContain('HttpOnly')
    expect((await as(first).get('/api/projects')).statusCode).toBe(401) // older sessions end
    expect((await as(cookieOf(ok)).get('/api/projects')).statusCode).toBe(200)
    expect((await post('/api/auth/reset', { token, password: 'other-lantern-88' })).statusCode).toBe(400) // used once
    expect((await post('/api/auth/login', { email: 'ann@example.com', password: 'new-lantern-77' })).statusCode).toBe(200)
    // at most 3 mails per account an hour
    for (let i = 0; i < 4; i++) await post('/api/auth/forgot', { email: 'ann@example.com' })
    await new Promise((r) => setTimeout(r, 20))
    expect(sent.length).toBeLessThanOrEqual(3 + 1)
  })

  it('says so when no mail service is configured', async () => {
    await stop()
    await start({ mailer: false })
    expect((await app.inject({ url: '/api/auth/config' })).json().passwordReset).toBe(false)
    expect((await post('/api/auth/forgot', { email: 'ann@example.com' })).statusCode).toBe(501)
  })
})

describe('admin command: promote / demote', () => {
  it('makes and unmakes admins', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hzc-adm-cli-'))
    try {
      const out: string[] = []
      const secrets = () => new SecretBox(join(dir, 'master.key'))
      await runAdmin(['create-user', 'ann@example.com'], dir, secrets, (s) => out.push(s))
      expect(await runAdmin(['promote', 'ann@example.com'], dir, secrets, (s) => out.push(s))).toBe(0)
      let a = new AccountStore(join(dir, 'accounts.sqlite'))
      expect(a.findByEmail('ann@example.com')!.isAdmin).toBe(true)
      a.close()
      expect(await runAdmin(['demote', 'ann@example.com'], dir, secrets, (s) => out.push(s))).toBe(0)
      a = new AccountStore(join(dir, 'accounts.sqlite'))
      expect(a.findByEmail('ann@example.com')!.isAdmin).toBe(false)
      a.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
