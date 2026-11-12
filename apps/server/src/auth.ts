import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { AccountError, PASSWORD_MIN, RESET_MINUTES, SESSION_DAYS, checkPassword, isSignupMode, normalizeEmail, type AccountStore, type SignupMode } from './accounts'
import { resetMail, type Mailer } from './mail'
import { installAdminRoutes } from './adminRoutes'
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
  /** who may sign up (HZC_SIGNUP: open | invite | closed); an admin can change it at runtime. true/false = open/closed */
  signup: boolean | SignupMode
  /** sends password-reset links (HZC_SMTP_URL); without it, an admin resets passwords */
  mailer?: Mailer
  /** the site's address for links in mail (HZC_PUBLIC_URL); else the request's own allowlisted host */
  publicUrl?: string
  /** HZC_ADMIN_EMAILS: these accounts become admins when they sign up */
  adminEmails?: string[]
  /** storage per account when the admin hasn't set one, in MB (for the admin console) */
  defaultQuotaMb?: number
  /** true: cookies only over HTTPS; 'auto' (default): Secure when the request came over HTTPS */
  secureCookies?: boolean | 'auto'
}

const PUBLIC = new Set(['/api/health', '/api/auth/config', '/api/auth/signup', '/api/auth/login', '/api/auth/logout', '/api/auth/forgot', '/api/auth/reset'])
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
  // reset mails: 5 requests per address and 3 mails per account an hour (no mail bombing)
  const forgotByAddress = new FailureThrottle(5, 60 * 60_000)
  const forgotByEmail = new FailureThrottle(3, 60 * 60_000)
  const fallbackMode: SignupMode = cfg.signup === true ? 'open' : cfg.signup === false ? 'closed' : cfg.signup
  const signupMode = (): SignupMode => { const v = accounts.getSetting('signup'); return isSignupMode(v) ? v : fallbackMode }
  const adminEmails = new Set((cfg.adminEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))

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

  const me = (req: FastifyRequest) => ({ email: req.user!.email, createdAt: req.user!.createdAt, isAdmin: req.user!.isAdmin })

  app.get('/api/auth/config', async () => {
    const mode = signupMode()
    return { accounts: true, signup: mode !== 'closed', signupMode: mode, passwordReset: !!cfg.mailer, passwordMin: PASSWORD_MIN }
  })

  app.get('/api/auth/me', async (req) => me(req))

  app.post<{ Body: { email?: unknown; password?: unknown; invite?: unknown } }>('/api/auth/signup', async (req, reply) => {
    const mode = signupMode()
    if (mode === 'closed') return reply.code(403).send({ error: '暂不开放注册，请联系管理员开通账号' })
    const wait = Math.max(signups.lockedFor(req.ip), signupTries.lockedFor(req.ip))
    if (wait) return locked(reply, wait, '注册太频繁')
    signupTries.fail(req.ip)
    const invite = typeof req.body?.invite === 'string' ? req.body.invite.trim() : ''
    if (mode === 'invite' && !accounts.inviteUsable(invite)) return reply.code(403).send({ error: invite ? '邀请链接无效、已过期或已用完' : '现在只接受邀请注册，请使用管理员发给你的邀请链接' })
    try {
      let user = await accounts.createUser(req.body?.email, req.body?.password)
      // the invite is used up only by an account that was really created (a race loses the account, not the place)
      if (mode === 'invite' && !accounts.consumeInvite(invite)) {
        accounts.deleteUser(user.id)
        return reply.code(403).send({ error: '邀请链接刚刚用完或已失效' })
      }
      if (adminEmails.has(user.email)) { accounts.setAdmin(user.id, true); user = accounts.getUser(user.id)! }
      signups.fail(req.ip) // counts sign-ups, not failures
      setSession(req, reply, accounts.createSession(user.id, String(req.headers['user-agent'] ?? '')))
      return reply.code(201).send({ email: user.email, createdAt: user.createdAt, isAdmin: user.isAdmin })
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
    return { email: user.email, createdAt: user.createdAt, isAdmin: user.isAdmin }
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

  // ---- forgot password: a one-use link by mail. The answer never says whether the email has an account.
  app.post<{ Body: { email?: unknown } }>('/api/auth/forgot', async (req, reply) => {
    if (!cfg.mailer) return reply.code(501).send({ error: '这个网站没有配置邮件服务，请联系管理员重置密码' })
    const wait = forgotByAddress.lockedFor(req.ip)
    if (wait) return locked(reply, wait, '请求太频繁')
    forgotByAddress.fail(req.ip)
    let email: string
    try { email = normalizeEmail(req.body?.email) } catch (e) { return reply.code(400).send({ error: (e as Error).message }) }
    const user = accounts.findByEmail(email)
    if (user && !user.disabled && !forgotByEmail.lockedFor(email)) {
      forgotByEmail.fail(email)
      const base = (cfg.publicUrl ?? `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '')
      const link = `${base}/reset?token=${accounts.createResetToken(user.id)}`
      const m = resetMail(link, RESET_MINUTES)
      // sent in the background: the answer takes the same time whether or not the account exists
      void cfg.mailer.send(user.email, m.subject, m.text).catch((e) => console.error('[hzc] reset mail failed:', (e as Error).message))
    }
    return reply.code(202).send({ ok: true })
  })

  app.post<{ Body: { token?: unknown; password?: unknown } }>('/api/auth/reset', async (req, reply) => {
    const wait = byAddress.lockedFor(req.ip)
    if (wait) return locked(reply, wait, '尝试次数过多')
    const user = accounts.resetTokenUser(req.body?.token)
    if (!user) { byAddress.fail(req.ip); return reply.code(400).send({ error: '重置链接无效或已过期，请重新申请' }) }
    try { checkPassword(req.body?.password, user.email) } catch (e) { return reply.code(400).send({ error: (e as Error).message }) }
    if (!accounts.consumeResetToken(req.body!.token as string)) return reply.code(400).send({ error: '重置链接无效或已过期，请重新申请' })
    await accounts.setPassword(user.id, req.body?.password) // ends every session
    setSession(req, reply, accounts.createSession(user.id, String(req.headers['user-agent'] ?? '')))
    return { email: user.email, createdAt: user.createdAt, isAdmin: user.isAdmin }
  })

  installAdminRoutes(app, { accounts, workspaces, signupMode, setSignupMode: (m) => accounts.setSetting('signup', m), defaultQuotaMb: cfg.defaultQuotaMb, publicUrl: cfg.publicUrl })

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
