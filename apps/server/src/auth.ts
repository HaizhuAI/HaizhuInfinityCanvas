import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { AccountError, PASSWORD_MIN, SESSION_DAYS, type AccountStore } from './accounts'
import { FailureThrottle } from './security'
import type { Workspaces } from './workspaces'

/**
 * Sign-in for multi-user deployments. Every /api request needs a signed-in user except the few below;
 * the hook attaches that user's workspace to the request, and routes only ever use that workspace.
 *
 * Cookie: HttpOnly (page scripts can't read it), SameSite=Lax (other sites' forms and fetches don't
 * carry it), Secure + the `__Host-` prefix over HTTPS (never sent over plain HTTP, can't be set by a
 * subdomain). Requests that change something must also pass the Origin check in security.ts, so a
 * cross-site page can neither use a session nor sign someone into a different account.
 */
export interface AuthConfig {
  accounts: AccountStore
  workspaces: Workspaces
  /** whether the sign-up page may create accounts (HZC_SIGNUP=closed: only the admin command can) */
  signup: boolean
  /** true: cookies only over HTTPS; 'auto' (default): Secure when the request came over HTTPS */
  secureCookies?: boolean | 'auto'
}

const PUBLIC = new Set(['/api/health', '/api/auth/config', '/api/auth/signup', '/api/auth/login', '/api/auth/logout'])
const SECURE_NAME = '__Host-hzc_session'
const PLAIN_NAME = 'hzc_session'

function cookies(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

export function installAuth(app: FastifyInstance, cfg: AuthConfig) {
  const { accounts, workspaces } = cfg
  // guessing passwords: per address, and per account across addresses (slower, so it can't lock people out easily)
  const byAddress = new FailureThrottle(10, 10 * 60_000)
  const byEmail = new FailureThrottle(30, 60 * 60_000)
  // creating accounts in bulk: 5 per address per hour; any sign-up attempt (which can tell whether an
  // email is registered) 30 per address per hour
  const signups = new FailureThrottle(5, 60 * 60_000)
  const signupTries = new FailureThrottle(30, 60 * 60_000)

  const secure = (req: FastifyRequest) => (cfg.secureCookies === true ? true : cfg.secureCookies === false ? false : req.protocol === 'https')
  // over HTTPS only the __Host- cookie counts: a plain-named cookie could have been planted by a sibling subdomain
  const sessionToken = (req: FastifyRequest) => { const c = cookies(req); return secure(req) ? c[SECURE_NAME] : (c[PLAIN_NAME] ?? c[SECURE_NAME]) }
  const setSession = (req: FastifyRequest, reply: FastifyReply, token: string) => {
    const s = secure(req)
    reply.header('set-cookie', `${s ? SECURE_NAME : PLAIN_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${s ? '; Secure' : ''}`)
  }
  const clearSession = (req: FastifyRequest, reply: FastifyReply) => {
    const s = secure(req)
    reply.header('set-cookie', `${s ? SECURE_NAME : PLAIN_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${s ? '; Secure' : ''}`)
  }
  const locked = (reply: FastifyReply, seconds: number, what: string) =>
    reply.code(429).header('retry-after', String(seconds)).send({ error: `${what}，请 ${Math.ceil(seconds / 60)} 分钟后再试` })

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!
    if (!path.startsWith('/api/')) return
    const user = accounts.sessionUser(sessionToken(req))
    if (user) {
      req.user = user
      req.workspace = workspaces.get(user.id)
      return
    }
    if (req.routeOptions?.url && PUBLIC.has(req.routeOptions.url)) return
    return reply.code(401).send({ error: '请先登录', login: true })
  })

  const me = (req: FastifyRequest) => ({ email: req.user!.email, createdAt: req.user!.createdAt })

  app.get('/api/auth/config', async () => ({ accounts: true, signup: cfg.signup, passwordMin: PASSWORD_MIN }))

  app.get('/api/auth/me', async (req) => me(req))

  app.post<{ Body: { email?: unknown; password?: unknown } }>('/api/auth/signup', async (req, reply) => {
    if (!cfg.signup) return reply.code(403).send({ error: '暂不开放注册，请联系管理员开通账号' })
    const wait = Math.max(signups.lockedFor(req.ip), signupTries.lockedFor(req.ip))
    if (wait) return locked(reply, wait, '注册太频繁')
    signupTries.fail(req.ip)
    try {
      const user = await accounts.createUser(req.body?.email, req.body?.password)
      signups.fail(req.ip) // counts sign-ups, not failures
      setSession(req, reply, accounts.createSession(user.id, String(req.headers['user-agent'] ?? '')))
      return reply.code(201).send({ email: user.email, createdAt: user.createdAt })
    } catch (e) {
      if (e instanceof AccountError) return reply.code(e.status).send({ error: e.message })
      throw e
    }
  })

  app.post<{ Body: { email?: unknown; password?: unknown } }>('/api/auth/login', async (req, reply) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : ''
    const wait = Math.max(byAddress.lockedFor(req.ip), email ? byEmail.lockedFor(email) : 0)
    if (wait) return locked(reply, wait, '登录失败次数过多')
    const user = await accounts.authenticate(req.body?.email, req.body?.password)
    if (!user) {
      byAddress.fail(req.ip)
      if (email) byEmail.fail(email)
      return reply.code(401).send({ error: '邮箱或密码不正确' })
    }
    byAddress.ok(req.ip)
    byEmail.ok(email)
    // a fresh session on every sign-in (a session id planted before sign-in is never upgraded)
    accounts.endSession(sessionToken(req))
    setSession(req, reply, accounts.createSession(user.id, String(req.headers['user-agent'] ?? '')))
    return { email: user.email, createdAt: user.createdAt }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    accounts.endSession(sessionToken(req))
    clearSession(req, reply)
    return reply.code(204).send()
  })

  app.post<{ Body: { current?: unknown; next?: unknown } }>('/api/auth/password', async (req, reply) => {
    const wait = byAddress.lockedFor(req.ip)
    if (wait) return locked(reply, wait, '密码错误次数过多')
    if (!(await accounts.checkCurrentPassword(req.user!.id, req.body?.current))) {
      byAddress.fail(req.ip)
      return reply.code(400).send({ error: '当前密码不正确' })
    }
    try {
      await accounts.setPassword(req.user!.id, req.body?.next, sessionToken(req))
      return reply.code(204).send()
    } catch (e) {
      if (e instanceof AccountError) return reply.code(e.status).send({ error: e.message })
      throw e
    }
  })

  /** sign out everywhere else (a lost laptop, a shared computer) */
  app.post('/api/auth/logout-others', async (req, reply) => {
    const token = sessionToken(req)
    accounts.endAllSessions(req.user!.id)
    if (token) setSession(req, reply, accounts.createSession(req.user!.id, String(req.headers['user-agent'] ?? '')))
    return reply.code(204).send()
  })

  /** delete the account and everything in its workspace; needs the password */
  app.post<{ Body: { password?: unknown } }>('/api/auth/delete-account', async (req, reply) => {
    const wait = byAddress.lockedFor(req.ip)
    if (wait) return locked(reply, wait, '密码错误次数过多')
    if (!(await accounts.checkCurrentPassword(req.user!.id, req.body?.password))) {
      byAddress.fail(req.ip)
      return reply.code(400).send({ error: '密码不正确' })
    }
    workspaces.remove(req.user!.id)
    accounts.deleteUser(req.user!.id)
    clearSession(req, reply)
    return reply.code(204).send()
  })
}
