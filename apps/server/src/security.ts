import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * Request-level protection for every deployment:
 *
 * - Host check (DNS rebinding): a web page on another site can make the browser resolve its own name
 *   to 127.0.0.1 and talk to this server as if it were same-origin. Without an access token, only
 *   loopback names (and names the operator lists) are accepted, so such requests never reach the API.
 * - Origin check (cross-site requests): a POST/PUT/PATCH/DELETE coming from a page on another origin is
 *   refused. `text/plain` bodies (the one JSON-ish type a page can send without a CORS preflight) are
 *   not parsed at all.
 * - Access token (WebUI deployments): compared in constant time; addresses with repeated failures are
 *   locked out for a while.
 * - Response headers: CSP, no framing (clickjacking), no MIME sniffing, no referrer (asset URLs can
 *   carry the token), and stored files served sandboxed so even a disguised file can never run script.
 * - Errors: unexpected failures answer with a generic message; details go to the server log only.
 */
export interface SecurityOptions {
  /** HZC_TOKEN: required for every /api request except /api/health */
  accessToken?: string
  /** HZC_ALLOWED_HOSTS: host names this server may be reached by (e.g. a domain behind a reverse proxy) */
  allowedHosts?: string[]
  /** HZC_HSTS=1: send Strict-Transport-Security (only when served over HTTPS) */
  hsts?: boolean
  /** failed token attempts allowed per address within `windowMs` before it is locked out */
  maxFailures?: number
  windowMs?: number
}

const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]']

/** The canvas page: everything from this server; inline style attributes (React, motion) allowed. */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** Stored files: shown as media only. `sandbox` stops any script even if a file is opened directly. */
export const FILE_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"

/** host name (lowercase, no port) of a Host / :authority header */
export function hostnameOf(host: string | undefined): string | undefined {
  if (!host) return undefined
  const m = /^(\[[0-9a-f:.]+\]|[^:/\s]+)(?::\d{1,5})?$/i.exec(host.trim())
  return m?.[1]?.toLowerCase()
}

const sha = (s: string) => createHash('sha256').update(s).digest()

/** Locks an address out after too many failed token attempts (sliding window; bounded memory). */
export class FailureThrottle {
  private seen = new Map<string, { fails: number; first: number; until: number }>()
  constructor(private max = 10, private windowMs = 10 * 60_000, private cap = 10_000) {}
  /** seconds until the address may try again; 0 = not locked */
  lockedFor(addr: string, now = Date.now()): number {
    const e = this.seen.get(addr)
    return e && e.until > now ? Math.ceil((e.until - now) / 1000) : 0
  }
  fail(addr: string, now = Date.now()) {
    let e = this.seen.get(addr)
    if (!e || now - e.first > this.windowMs) e = { fails: 0, first: now, until: 0 }
    e.fails++
    if (e.fails >= this.max) e.until = now + this.windowMs
    this.seen.delete(addr)
    this.seen.set(addr, e)
    if (this.seen.size > this.cap) this.seen.delete(this.seen.keys().next().value!)
  }
  ok(addr: string) { this.seen.delete(addr) }
}

/** /api routes that need no token */
const PUBLIC_API = new Set(['/api/health'])
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/** routes that may take the token as ?t= (img / video / download links cannot send headers) */
const TOKEN_IN_QUERY = new Set(['/api/assets/:id', '/api/projects/:id/bundle'])

export function installSecurity(app: FastifyInstance, opts: SecurityOptions) {
  const extra = (opts.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean)
  const allowed = new Set([...LOOPBACK, ...extra])
  // With a token every request must prove itself, so any Host is fine unless the operator lists hosts.
  // Without one (loopback use) the Host check is what keeps other web sites out.
  const checkHost = !opts.accessToken || extra.length > 0
  const expected = opts.accessToken ? sha(opts.accessToken) : undefined
  const tokenOk = (v: unknown) => !!expected && typeof v === 'string' && v.length > 0 && v.length < 512 && timingSafeEqual(sha(v), expected)
  const throttle = new FailureThrottle(opts.maxFailures, opts.windowMs)

  // no parser for text/plain: a cross-site page could send it without a preflight
  app.removeContentTypeParser('text/plain')

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!
    const route = req.routeOptions?.url
    const isApi = (route ?? path).startsWith('/api/') || path.startsWith('/api/')

    if (checkHost) {
      const host = hostnameOf(req.headers.host)
      if (!host || !allowed.has(host)) return reply.code(421).send({ error: '不允许通过这个地址访问（如需用域名访问，请设置 HZC_ALLOWED_HOSTS）' })
    }

    if (isApi && UNSAFE.has(req.method)) {
      const origin = req.headers.origin
      if (origin !== undefined && !sameOrigin(origin, req.headers.host, allowed)) return reply.code(403).send({ error: '拒绝了来自其他网站的请求' })
      if (req.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: '拒绝了来自其他网站的请求' })
    }

    if (!expected || !isApi || (route && PUBLIC_API.has(route))) return
    const addr = req.ip
    const wait = throttle.lockedFor(addr)
    if (wait) return reply.code(429).header('retry-after', String(wait)).send({ error: `口令错误次数过多，请 ${Math.ceil(wait / 60)} 分钟后再试` })
    const given = req.headers['x-hzc-token'] ?? (req.method === 'GET' && route && TOKEN_IN_QUERY.has(route) ? (req.query as { t?: string })?.t : undefined)
    if (tokenOk(given)) { throttle.ok(addr); return }
    // a request without any token is a page that has not been given one yet, not a guess
    if (given !== undefined) throttle.fail(addr)
    return reply.code(401).send({ error: 'unauthorized' })
  })

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('x-frame-options', 'DENY')
    reply.header('cross-origin-opener-policy', 'same-origin')
    reply.header('cross-origin-resource-policy', 'same-origin')
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()')
    if (opts.hsts) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains')
    const type = String(reply.getHeader('content-type') ?? '')
    const path = req.url.split('?')[0]!
    if (path.startsWith('/api/assets/')) reply.header('content-security-policy', FILE_CSP)
    else if (type.startsWith('text/html')) reply.header('content-security-policy', APP_CSP)
    // API answers are per-user data: never kept by shared caches
    if (path.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store')
    return payload
  })

  app.setErrorHandler((err: Error & { statusCode?: number }, req: FastifyRequest, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500
    if (status >= 500) {
      console.error(`[hzc] ${req.method} ${req.url.split('?')[0]} failed:`, err)
      return reply.code(500).send({ error: '服务器内部错误，请稍后重试；详情见服务端日志' })
    }
    return reply.code(status).send({ error: err.message })
  })
}

/** the Origin header names this same server (same host and port), or an operator-listed host */
function sameOrigin(origin: string, host: string | undefined, allowed: Set<string>): boolean {
  let o: URL
  try { o = new URL(origin) } catch { return false } // includes "null" (sandboxed frames, file://)
  if (o.protocol !== 'http:' && o.protocol !== 'https:') return false
  if (host && o.host.toLowerCase() === host.trim().toLowerCase()) return true
  // a name the operator listed (reverse proxy on another port); never "any local port" — other local
  // apps (a dev server, a tool's web UI) must not be able to drive this one
  const h = o.hostname.toLowerCase()
  return !LOOPBACK.includes(h) && allowed.has(h)
}
