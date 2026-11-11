import { lookup, type LookupAddress } from 'node:dns'
import { lookup as lookupAsync } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'

/**
 * Outbound request guard (SSRF). The server fetches URLs it did not choose: results a provider points
 * to, redirects, and endpoints typed into model profiles. Without a check, a hostile or compromised
 * provider could make it read cloud metadata (credentials) or services on the internal network.
 *
 * - Always refused: "this network", link-local (cloud metadata lives at 169.254.169.254), multicast,
 *   reserved, and known metadata addresses — no model or result is ever there.
 * - Private networks (loopback, 10/8, 172.16/12, 192.168/16, CGNAT, IPv6 ULA): allowed, because local
 *   models (Ollama, a LAN server) are a normal setup — unless HZC_BLOCK_PRIVATE_NETWORK=1, which a
 *   public or multi-user deployment should set. Results are only fetched from a private address when
 *   the model itself is on one.
 * Downloads check the address the connection actually uses (no DNS rebinding gap) and every redirect.
 */
export class NetGuardError extends Error {}

const ALWAYS = new BlockList()
for (const [net, bits] of [['0.0.0.0', 8], ['169.254.0.0', 16], ['192.0.0.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) ALWAYS.addSubnet(net, bits, 'ipv4')
ALWAYS.addAddress('100.100.100.200', 'ipv4') // Alibaba Cloud metadata
ALWAYS.addAddress('::', 'ipv6')
ALWAYS.addSubnet('fe80::', 10, 'ipv6')
ALWAYS.addSubnet('ff00::', 8, 'ipv6')
ALWAYS.addAddress('fd00:ec2::254', 'ipv6') // AWS metadata over IPv6

const PRIVATE = new BlockList()
for (const [net, bits] of [['127.0.0.0', 8], ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['198.18.0.0', 15]] as const) PRIVATE.addSubnet(net, bits, 'ipv4')
PRIVATE.addAddress('::1', 'ipv6')
PRIVATE.addSubnet('fc00::', 7, 'ipv6')

export const privateNetworkBlocked = () => process.env.HZC_BLOCK_PRIVATE_NETWORK === '1'

/** why this address may not be contacted, or undefined when it may */
export function addressBlocked(address: string, allowPrivate: boolean): string | undefined {
  let ip = address.replace(/^\[|\]$/g, '').toLowerCase()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip) // IPv4 written as IPv6
  if (mapped) ip = mapped[1]!
  const family = isIP(ip) === 6 ? 'ipv6' : 'ipv4'
  if (!isIP(ip)) return '不是有效的地址'
  if (ALWAYS.check(ip, family)) return '链路本地、元数据或保留地址'
  if (!allowPrivate && PRIVATE.check(ip, family)) return '本机或内网地址'
  return undefined
}

/** every address a host name resolves to (an IP literal resolves to itself) */
async function resolveAll(host: string): Promise<string[]> {
  const h = host.replace(/^\[|\]$/g, '')
  if (isIP(h)) return [h]
  try { return (await lookupAsync(h, { all: true, verbatim: true })).map((a) => a.address) } catch { return [] } // let the request report it
}

/** Refuse a URL whose host is (or resolves to) a blocked address. */
export async function checkUrl(url: string, opts: { allowPrivate?: boolean } = {}): Promise<void> {
  let u: URL
  try { u = new URL(url) } catch { throw new NetGuardError('地址无效') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new NetGuardError('只允许 http / https 地址')
  const allowPrivate = opts.allowPrivate ?? !privateNetworkBlocked()
  for (const a of await resolveAll(u.hostname)) {
    const why = addressBlocked(a, allowPrivate)
    if (why) throw new NetGuardError(`不允许访问 ${u.hostname}（${why}）`)
  }
}

/** Whether a model endpoint is on this computer or the local network (its results may be too). */
export async function endpointIsPrivate(endpoint: string | undefined): Promise<boolean> {
  if (!endpoint) return false
  let host: string
  try { host = new URL(endpoint).hostname } catch { return false }
  if (host === 'localhost') return true
  const addrs = await resolveAll(host)
  // every address is private (refused when private networks are off, fine when they are on)
  return addrs.length > 0 && addrs.every((a) => addressBlocked(a, false) !== undefined && addressBlocked(a, true) === undefined)
}

export interface Downloaded { status: number; headers: Record<string, string>; body: Buffer; url: string }

/**
 * GET a URL with the guard applied to every connection and redirect (up to 5).
 * Refuses bodies over `maxBytes`. Never sends cookies or credentials.
 */
export function guardedGet(url: string, opts: { signal: AbortSignal; maxBytes: number; allowPrivate: boolean; timeoutMs?: number }): Promise<Downloaded> {
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 10 * 60_000)])
  // checks the address each connection really uses, so a name can't resolve differently later
  const guardedLookup = (hostname: string, options: object, cb: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
    lookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs: LookupAddress[]) => {
      if (err) return cb(err, '')
      for (const a of addrs) {
        const why = addressBlocked(a.address, opts.allowPrivate)
        if (why) return cb(new NetGuardError(`不允许访问 ${hostname}（${why}）`), '')
      }
      if ((options as { all?: boolean }).all) return cb(null, addrs)
      return cb(null, addrs[0]!.address, addrs[0]!.family)
    })
  }
  const once = (target: string): Promise<Downloaded & { location?: string }> => new Promise((resolve, reject) => {
    let u: URL
    try { u = new URL(target) } catch { return reject(new NetGuardError('地址无效')) }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new NetGuardError('只允许 http / https 地址'))
    const literal = u.hostname.replace(/^\[|\]$/g, '')
    if (isIP(literal)) { const why = addressBlocked(literal, opts.allowPrivate); if (why) return reject(new NetGuardError(`不允许访问 ${u.hostname}（${why}）`)) }
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.get(u, { lookup: guardedLookup as never, signal, headers: { 'user-agent': 'HaizhuInfinityCanvas', accept: '*/*' } }, (res) => {
      const status = res.statusCode ?? 0
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v
      if (status >= 300 && status < 400 && headers.location) { res.resume(); return resolve({ status, headers, body: Buffer.alloc(0), url: target, location: new URL(headers.location, target).toString() }) }
      const declared = Number(headers['content-length'] ?? 0)
      if (declared > opts.maxBytes) { res.destroy(); return reject(new NetGuardError('文件超过大小上限')) }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > opts.maxBytes) { res.destroy(); reject(new NetGuardError('文件超过大小上限')); return }
        chunks.push(c)
      })
      res.on('end', () => resolve({ status, headers, body: Buffer.concat(chunks), url: target }))
      res.on('error', reject)
    })
    req.on('error', reject)
  })
  return (async () => {
    let target = url
    for (let hop = 0; hop <= 5; hop++) {
      const r = await once(target)
      if (!r.location) return r
      target = r.location
    }
    throw new NetGuardError('跳转次数过多')
  })()
}
