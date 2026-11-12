import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { isSignupMode, oneTimePassword, type AccountStore, type SignupMode } from './accounts'
import type { Workspaces } from './workspaces'

/**
 * The admin console's API (/api/admin/*), for accounts marked admin (HZC_ADMIN_EMAILS or the
 * `admin promote` command). Every route checks the signed-in user is an admin on every request, and
 * no admin can lock themselves out (disable, demote or delete their own account).
 */
export interface AdminConfig {
  accounts: AccountStore
  workspaces: Workspaces
  signupMode: () => SignupMode
  setSignupMode: (m: SignupMode) => void
  defaultQuotaMb?: number
  publicUrl?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const INVITE_ID = /^[0-9a-f]{64}$/

export function installAdminRoutes(app: FastifyInstance, cfg: AdminConfig) {
  const { accounts, workspaces } = cfg
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user?.isAdmin) return reply.code(403).send({ error: '只有管理员可以使用' })
  }
  /** the account a route acts on; refuses the admin's own account where that would lock them out */
  const target = (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, notSelf?: string) => {
    const id = req.params.id
    const u = UUID.test(id) ? accounts.getUser(id) : undefined
    if (!u) { void reply.code(404).send({ error: '没有这个账号' }); return undefined }
    if (notSelf && u.id === req.user!.id) { void reply.code(400).send({ error: notSelf }); return undefined }
    return u
  }

  app.register(async (admin) => {
    admin.addHook('preHandler', guard)

    admin.get('/api/admin/overview', async () => ({
      ...accounts.overview(),
      signupMode: cfg.signupMode(),
      defaultQuotaMb: cfg.defaultQuotaMb,
      openWorkspaces: workspaces.openCount,
    }))

    admin.get<{ Querystring: { q?: string; offset?: string; limit?: string } }>('/api/admin/users', async (req) => {
      const r = accounts.listUsersWithUsage(String(req.query.q ?? '').slice(0, 100), Number(req.query.limit) || 100, Number(req.query.offset) || 0)
      return { ...r, users: r.users.map((u) => ({ ...u, quotaMb: u.quotaMb ?? null, effectiveQuotaMb: u.quotaMb ?? cfg.defaultQuotaMb ?? null })) }
    })

    admin.post<{ Params: { id: string }; Body: { disabled?: unknown } }>('/api/admin/users/:id/disable', async (req, reply) => {
      const u = target(req, reply, '不能停用自己的账号')
      if (!u) return
      accounts.setDisabled(u.id, req.body?.disabled !== false) // disabling also signs them out everywhere
      return { ok: true }
    })

    admin.post<{ Params: { id: string }; Body: { admin?: unknown } }>('/api/admin/users/:id/admin', async (req, reply) => {
      const make = req.body?.admin === true
      const u = target(req, reply, make ? undefined : '不能取消自己的管理员身份')
      if (!u) return
      accounts.setAdmin(u.id, make)
      return { ok: true }
    })

    /** a one-time password shown to the admin once; the user is signed out everywhere */
    admin.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-password', async (req, reply) => {
      const u = target(req, reply, '修改自己的密码请到「设置 → 账号」')
      if (!u) return
      const password = oneTimePassword()
      await accounts.setPassword(u.id, password)
      return { password }
    })

    admin.put<{ Params: { id: string }; Body: { mb?: unknown } }>('/api/admin/users/:id/quota', async (req, reply) => {
      const u = target(req, reply)
      if (!u) return
      const mb = req.body?.mb
      if (mb !== null && (typeof mb !== 'number' || !Number.isInteger(mb) || mb < 1 || mb > 10_000_000)) return reply.code(400).send({ error: '存储上限请填 1 以上的整数（MB），或留空使用默认值' })
      accounts.setQuota(u.id, mb === null ? undefined : mb)
      return { ok: true }
    })

    admin.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
      const u = target(req, reply, '不能在这里删除自己的账号（请到「设置 → 账号」）')
      if (!u) return
      workspaces.remove(u.id)
      accounts.deleteUser(u.id)
      return reply.code(204).send()
    })

    // ---- invites
    admin.get('/api/admin/invites', async () => accounts.listInvites())
    admin.post<{ Body: { maxUses?: unknown; days?: unknown; note?: unknown } }>('/api/admin/invites', async (req, reply) => {
      const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
      const { code, invite } = accounts.createInvite({ maxUses: n(req.body?.maxUses, 1), days: n(req.body?.days, 7), note: typeof req.body?.note === 'string' ? req.body.note : undefined, createdBy: req.user!.id })
      const base = (cfg.publicUrl ?? `${req.protocol}://${req.headers.host}`).replace(/\/+$/, '')
      return reply.code(201).send({ invite, code, link: `${base}/signup?invite=${code}` })
    })
    admin.delete<{ Params: { id: string } }>('/api/admin/invites/:id', async (req, reply) =>
      INVITE_ID.test(req.params.id) && accounts.revokeInvite(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: '没有这个邀请' }))

    // ---- site settings
    admin.put<{ Body: { signupMode?: unknown } }>('/api/admin/settings', async (req, reply) => {
      if (!isSignupMode(req.body?.signupMode)) return reply.code(400).send({ error: '注册方式只能是 open、invite 或 closed' })
      cfg.setSignupMode(req.body.signupMode)
      return { signupMode: cfg.signupMode() }
    })
  })
}
