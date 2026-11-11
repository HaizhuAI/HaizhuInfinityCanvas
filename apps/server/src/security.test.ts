import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { buildApp } from './app'
import { AssetStore } from './assets'
import { Store } from './db'
import { Engine } from './engine'
import { downloadToAsset } from './generation'
import { addressBlocked, checkUrl, endpointIsPrivate, guardedGet, NetGuardError } from './netguard'
import { retryDelay, retryError, retryStatus } from './retry'
import { SecretBox } from './secrets'
import { FailureThrottle, hostnameOf } from './security'
import { SkillStore } from './skills'
import { ProviderError } from './providers'

const BUILTIN = fileURLToPath(new URL('../skills', import.meta.url))
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

let dir: string, store: Store, assets: AssetStore
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hzc-sec-'))
  store = new Store(':memory:', new SecretBox(join(dir, 'master.key')))
  assets = new AssetStore(dir, store)
})
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })

async function app(opts: { accessToken?: string; allowedHosts?: string[]; web?: boolean } = {}) {
  let webDir: string | undefined
  if (opts.web) {
    webDir = join(dir, 'web')
    mkdirSync(webDir, { recursive: true })
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><div id="root"></div>')
  }
  return buildApp({ store, assets, engine: new Engine(store, assets), skills: new SkillStore(BUILTIN, dir), webDir, ...opts })
}

describe('DNS rebinding and cross-site requests (no token: loopback use)', () => {
  it('only answers to loopback host names, or names the operator lists', async () => {
    const a = await app()
    for (const host of ['127.0.0.1:8787', 'localhost:8787', '[::1]:8787', 'localhost']) expect((await a.inject({ url: '/api/projects', headers: { host } })).statusCode, host).toBe(200)
    for (const host of ['evil.example', 'evil.example:8787', '127.0.0.1.evil.example', 'localhost.evil.example']) {
      const r = await a.inject({ url: '/api/projects', headers: { host } })
      expect(r.statusCode, host).toBe(421)
    }
    // the page itself too: a rebinding attack would otherwise load the app under its own name
    expect((await a.inject({ url: '/api/health', headers: { host: 'evil.example' } })).statusCode).toBe(421)
    await a.close()
    const b = await app({ allowedHosts: ['canvas.example.com'] })
    expect((await b.inject({ url: '/api/projects', headers: { host: 'canvas.example.com' } })).statusCode).toBe(200)
    expect((await b.inject({ url: '/api/projects', headers: { host: 'other.example.com' } })).statusCode).toBe(421)
    await b.close()
  })

  it('refuses state-changing requests from other web sites, and bodies a page could send without a preflight', async () => {
    const a = await app()
    const post = (headers: Record<string, string>, payload: unknown = { name: 'x' }) => a.inject({ method: 'POST', url: '/api/projects', headers: { host: '127.0.0.1:8787', ...headers }, payload: payload as object })
    expect((await post({ origin: 'http://127.0.0.1:8787' })).statusCode).toBe(201) // the app itself
    expect((await post({})).statusCode).toBe(201)                                  // non-browser clients
    for (const origin of ['https://evil.example', 'http://127.0.0.1:3000', 'http://localhost:8787', 'null']) {
      expect((await post({ origin })).statusCode, origin).toBe(403)
    }
    expect((await post({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403)
    // text/plain is a "simple" request (no CORS preflight): not parsed at all
    const plain = await a.inject({ method: 'POST', url: '/api/projects/x/run', headers: { host: '127.0.0.1:8787', 'content-type': 'text/plain' }, payload: '{}' })
    expect(plain.statusCode).toBe(415)
    // reading stays possible for the app's own <img> tags; other sites can't read responses (no CORS)
    const get = await a.inject({ url: '/api/projects', headers: { host: '127.0.0.1:8787', origin: 'https://evil.example' } })
    expect(get.headers['access-control-allow-origin']).toBeUndefined()
    await a.close()
  })
})

describe('access token (WebUI deployments)', () => {
  it('guards every API route by its route, accepts ?t= only on file links, and ignores URL tricks', async () => {
    const a = await app({ accessToken: 'secret-token-123', web: true })
    const H = { 'x-hzc-token': 'secret-token-123' }
    expect((await a.inject({ url: '/api/health' })).statusCode).toBe(200)
    expect((await a.inject({ url: '/api/projects' })).statusCode).toBe(401)
    expect((await a.inject({ url: '/api/projects', headers: H })).statusCode).toBe(200)
    expect((await a.inject({ url: '/api/projects?t=secret-token-123' })).statusCode).toBe(401)
    const { id } = assets.put(PNG, 'image/png')
    expect((await a.inject({ url: `/api/assets/${id}?t=secret-token-123` })).statusCode).toBe(200)
    expect((await a.inject({ url: `/api/assets/${id}?t=wrong` })).statusCode).toBe(401)
    for (const url of ['//api/projects', '/./api/projects', '/API/projects', '/api/health/../projects', '/%61pi/projects', '/api/projects/', '/api%2Fprojects']) {
      const r = await a.inject({ url })
      expect(r.body, url).not.toMatch(/"graph"|"nodeCount"|"updatedAt"/)
      // refused (401 / 403 / 404), or the app page itself — never API data
      if (r.statusCode < 300) expect(r.headers['content-type'], url).toMatch(/text\/html/)
      else expect(r.statusCode, url).toBeGreaterThanOrEqual(400)
    }
    await a.close()
  })

  it('locks an address out after repeated wrong tokens; the right token then still has to wait', async () => {
    const a = await app({ accessToken: 'secret-token-123' })
    for (let i = 0; i < 10; i++) expect((await a.inject({ url: '/api/projects', headers: { 'x-hzc-token': `guess-${i}` } })).statusCode).toBe(401)
    const locked = await a.inject({ url: '/api/projects', headers: { 'x-hzc-token': 'secret-token-123' } })
    expect(locked.statusCode).toBe(429)
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0)
    // requests without a token at all (a page that has none yet) never count as guesses
    const b = await app({ accessToken: 'secret-token-123' })
    for (let i = 0; i < 20; i++) await b.inject({ url: '/api/projects' })
    expect((await b.inject({ url: '/api/projects', headers: { 'x-hzc-token': 'secret-token-123' } })).statusCode).toBe(200)
    await a.close(); await b.close()

    const t = new FailureThrottle(3, 1000, 2)
    t.fail('a', 0); t.fail('a', 1); expect(t.lockedFor('a', 2)).toBe(0); t.fail('a', 2)
    expect(t.lockedFor('a', 3)).toBe(1)
    expect(t.lockedFor('a', 1003)).toBe(0)
    t.fail('b', 0); t.fail('c', 0) // bounded memory: the oldest entry goes
    expect(t.lockedFor('a', 3)).toBe(0)
  })
})

describe('response headers', () => {
  it('CSP, no framing, no sniffing, no referrer on the page; stored files sandboxed; API answers not cached', async () => {
    const a = await app({ web: true })
    const page = await a.inject({ url: '/', headers: { host: '127.0.0.1:8787' } })
    expect(page.headers['content-security-policy']).toMatch(/default-src 'self'.*script-src 'self'.*frame-ancestors 'none'/)
    expect(page.headers['content-security-policy']).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/)
    expect(page.headers['x-frame-options']).toBe('DENY')
    expect(page.headers['x-content-type-options']).toBe('nosniff')
    expect(page.headers['referrer-policy']).toBe('no-referrer')
    expect(page.headers['cross-origin-opener-policy']).toBe('same-origin')
    const { id } = assets.put(PNG, 'image/png')
    const file = await a.inject({ url: `/api/assets/${id}`, headers: { host: '127.0.0.1:8787' } })
    expect(file.headers['content-security-policy']).toMatch(/default-src 'none'.*sandbox/)
    expect(file.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect((await a.inject({ url: '/api/projects', headers: { host: '127.0.0.1:8787' } })).headers['cache-control']).toBe('no-store')
    await a.close()
  })

  it('unexpected failures answer with a generic message (details stay in the log); client errors keep theirs', async () => {
    const a = await app()
    a.get('/api/boom', async () => { throw new Error('ENOENT: /secret/path/hzc.sqlite') })
    const r = await a.inject({ url: '/api/boom', headers: { host: '127.0.0.1:8787' } })
    expect(r.statusCode).toBe(500)
    expect(r.body).not.toMatch(/secret|ENOENT/)
    const bad = await a.inject({ method: 'POST', url: '/api/projects', headers: { host: '127.0.0.1:8787', 'content-type': 'application/json' }, payload: '{not json' })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBeTruthy()
    await a.close()
  })

  it('a project bundle may not expand far beyond its own size (zip bomb)', async () => {
    const a = await app()
    // one entry that inflates 1 KB → 300 MB worth of zeros would be refused before inflating it
    const big = 300 * 1024 * 1024
    const data = deflateRawSync(Buffer.alloc(1024 * 1024)) // a real 1 MB stream, declared as 300 MB
    const name = Buffer.from('assets/x.png')
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(big, 22); lh.writeUInt16LE(name.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(big, 24); ch.writeUInt16LE(name.length, 28)
    const cd = Buffer.concat([ch, name])
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16)
    const zip = Buffer.concat([lh, name, data, cd, end])
    const r = await a.inject({ method: 'POST', url: '/api/projects/import', headers: { host: '127.0.0.1:8787', 'content-type': 'application/zip' }, payload: zip })
    expect(r.statusCode).toBe(400)
    await a.close()
  })
})

describe('outbound requests (SSRF)', () => {
  it('classifies addresses: metadata / link-local always refused, private only when allowed', () => {
    for (const ip of ['169.254.169.254', '::ffff:169.254.169.254', 'fe80::1', '0.0.0.0', '100.100.100.200', 'fd00:ec2::254', '224.0.0.1']) {
      expect(addressBlocked(ip, true), ip).toBeTruthy()
    }
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.10', '100.64.0.1', '::1', 'fd12::1', '::ffff:10.0.0.1']) {
      expect(addressBlocked(ip, true), ip).toBeUndefined()
      expect(addressBlocked(ip, false), ip).toBeTruthy()
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(addressBlocked(ip, false), ip).toBeUndefined()
  })

  it('checks URLs and model endpoints', async () => {
    await expect(checkUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(NetGuardError)
    await expect(checkUrl('file:///etc/passwd')).rejects.toThrow(/http/)
    await expect(checkUrl('http://127.0.0.1:11434/api/tags', { allowPrivate: false })).rejects.toThrow(/本机或内网/)
    await expect(checkUrl('http://127.0.0.1:11434/api/tags', { allowPrivate: true })).resolves.toBeUndefined()
    expect(await endpointIsPrivate('http://localhost:11434')).toBe(true)
    expect(await endpointIsPrivate('http://192.168.1.20:8000/v1')).toBe(true)
    expect(await endpointIsPrivate('https://8.8.8.8/v1')).toBe(false)
    expect(await endpointIsPrivate('')).toBe(false)
    expect(hostnameOf('[::1]:8787')).toBe('[::1]')
    expect(hostnameOf('Example.COM:443')).toBe('example.com')
    expect(hostnameOf('a b')).toBeUndefined()
  })

  describe('downloads of generated results', () => {
    let srv: FastifyInstance, base = ''
    let flaky = 0
    beforeAll(async () => {
      srv = Fastify()
      srv.get('/ok.png', async (_r, reply) => reply.header('content-type', 'image/png').send(PNG))
      srv.get('/to-metadata', async (_r, reply) => reply.redirect('http://169.254.169.254/latest/meta-data/'))
      srv.get('/hop', async (_r, reply) => reply.redirect('/ok.png'))
      srv.get('/flaky.png', async (_r, reply) => (flaky++ < 2 ? reply.code(503).send('busy') : reply.header('content-type', 'image/png').send(PNG)))
      srv.get('/big', async (_r, reply) => reply.header('content-type', 'image/png').send(Buffer.alloc(2048)))
      await srv.listen({ port: 0, host: '127.0.0.1' })
      base = `http://127.0.0.1:${(srv.server.address() as { port: number }).port}`
    })
    afterAll(async () => { await srv.close() })

    it('follow redirects only to allowed addresses, never to private ones for a public model, and retry blips', async () => {
      const signal = new AbortController().signal
      expect((await downloadToAsset(`${base}/hop`, assets, 'image', signal, { allowPrivate: true })).mime).toBe('image/png')
      await expect(downloadToAsset(`${base}/to-metadata`, assets, 'image', signal, { allowPrivate: true })).rejects.toThrow(/结果地址被拒绝.*元数据/)
      // a public model pointing at this computer / the LAN
      await expect(downloadToAsset(`${base}/ok.png`, assets, 'image', signal, { allowPrivate: false })).rejects.toThrow(ProviderError)
      await expect(downloadToAsset('http://169.254.169.254/x.png', assets, 'image', signal, { allowPrivate: true })).rejects.toThrow(/元数据/)
      // two 503s, then the file: a paid result is not lost to a blip
      flaky = 0
      expect((await downloadToAsset(`${base}/flaky.png`, assets, 'image', signal, { allowPrivate: true })).mime).toBe('image/png')
      expect(flaky).toBe(3)
      await expect(guardedGet(`${base}/big`, { signal, maxBytes: 1000, allowPrivate: true })).rejects.toThrow(/大小上限/)
    })
  })

  it('retry policy: paid requests only when surely not processed', () => {
    const net = (code: string) => Object.assign(new Error('fetch failed'), { cause: { code } })
    expect(retryError('paid', net('ECONNREFUSED'))).toBe(true)
    expect(retryError('paid', net('ECONNRESET'))).toBe(false)   // may have reached the provider
    expect(retryError('idempotent', net('ECONNRESET'))).toBe(true)
    expect(retryError('idempotent', Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(false)
    expect(retryError('none', net('ECONNREFUSED'))).toBe(false)
    expect(retryStatus('paid', 429)).toBe(true)
    expect(retryStatus('paid', 503)).toBe(true)
    expect(retryStatus('paid', 502)).toBe(false)
    expect(retryStatus('paid', 504)).toBe(false)
    expect(retryStatus('idempotent', 502)).toBe(true)
    expect(retryStatus('idempotent', 401)).toBe(false)
    expect(retryDelay(0, '2')).toBeGreaterThanOrEqual(50)    // test timing caps waits at 50 ms
  })
})
