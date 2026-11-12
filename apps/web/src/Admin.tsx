import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, Ellipsis, Link2, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { Mark } from './icons'
import { admin, auth, type AdminInvite, type AdminOverview, type AdminUser, type Me, type SignupMode } from './api'
import './admin.css'

/**
 * /admin: the operator's console for a multi-user deployment — who has an account and how much they
 * use, who may sign up (open / invite only / closed), invite links, and per-account actions. Only
 * admins get data (every /api/admin call is checked on the server); others see a refusal.
 */
const bytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${Math.ceil(n / 1024)} KB`)
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '—')
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '从未')
const MODES: [SignupMode, string, string][] = [
  ['open', '开放注册', '任何人都可以在 /signup 注册。'],
  ['invite', '仅邀请', '只有拿到邀请链接的人才能注册。'],
  ['closed', '关闭', '不能注册；账号由管理员用命令开通。'],
]

type Dialog =
  | { kind: 'password'; email: string; password: string }
  | { kind: 'quota'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | null

export function Admin() {
  const [me, setMe] = useState<Me | null | 'none'>(null)
  const [ov, setOv] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<{ users: AdminUser[]; total: number } | null>(null)
  const [invites, setInvites] = useState<AdminInvite[]>([])
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [made, setMade] = useState<{ link: string; copied: boolean } | null>(null)
  const [inv, setInv] = useState({ maxUses: 1, days: 7, note: '' })

  useEffect(() => {
    document.title = '管理后台 · Haizhu Infinity Canvas'
    void auth.me().then(setMe).catch(() => { location.replace('/login?next=%2Fadmin') })
  }, [])

  const say = (ok: boolean, text: string) => { setNote({ ok, text }); setTimeout(() => setNote((n) => (n?.text === text ? null : n)), 4000) }
  const load = useCallback(async () => {
    try {
      const [o, u, i] = await Promise.all([admin.overview(), admin.users(q), admin.invites()])
      setOv(o); setUsers(u); setInvites(i)
    } catch (e) { say(false, (e as Error).message) }
  }, [q])
  useEffect(() => { if (me && me !== 'none' && me.isAdmin) void load() }, [me, load])

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMenu(null)
    try { await fn(); say(true, ok); await load() } catch (e) { say(false, (e as Error).message) }
  }

  if (me === null) return <div className="adm" data-testid="admin"><div className="adm-wrap adm-empty">读取中…</div></div>
  if (me === 'none' || !me.isAdmin) {
    return (
      <div className="adm" data-testid="admin">
        <div className="adm-wrap adm-empty">
          <h1>只有管理员可以打开这里</h1>
          <p className="muted">管理员由部署者设置（HZC_ADMIN_EMAILS，或服务器上的 <code>admin promote 邮箱</code> 命令）。</p>
          <a className="btn" href="/"><ArrowLeft />返回画布</a>
        </div>
      </div>
    )
  }

  return (
    <div className="adm" data-testid="admin" onClick={() => setMenu(null)}>
      <header className="adm-bar">
        <div className="adm-wrap adm-bar-row">
          <a className="adm-brand" href="/"><Mark size={20} />Haizhu <span>管理后台</span></a>
          <span className="adm-me"><ShieldCheck aria-hidden="true" />{me.email}</span>
          <a className="btn sm" href="/"><ArrowLeft />返回画布</a>
        </div>
      </header>

      <main className="adm-wrap">
        {note && <div className={`adm-note ${note.ok ? 'ok' : 'bad'}`} role="status" data-testid="admin-note">{note.ok ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}{note.text}</div>}

        <section className="adm-sec">
          <div className="adm-head"><h2>概览</h2><button className="btn sm ghost" onClick={() => void load()}><RefreshCw />刷新</button></div>
          {ov && (
            <dl className="adm-figures" data-testid="admin-overview">
              <div><dt>账号</dt><dd>{ov.users}</dd></div>
              <div><dt>近 7 天活跃</dt><dd>{ov.active7d}</dd></div>
              <div><dt>近 7 天新注册</dt><dd>{ov.signups7d}</dd></div>
              <div><dt>已用存储</dt><dd>{bytes(ov.bytes)}</dd></div>
              <div><dt>累计运行</dt><dd>{ov.runs}</dd></div>
            </dl>
          )}
          {ov && <p className="adm-meta">管理员 {ov.admins} 个 · 已停用 {ov.disabled} 个 · 每个账号默认存储 {ov.defaultQuotaMb ? `${ov.defaultQuotaMb} MB` : '不限'} · 当前打开的空间 {ov.openWorkspaces} 个</p>}
        </section>

        <section className="adm-sec">
          <div className="adm-head"><h2>注册方式</h2></div>
          <div className="seg2 adm-seg" role="radiogroup" aria-label="注册方式">
            {MODES.map(([m, label]) => (
              <button key={m} role="radio" aria-checked={ov?.signupMode === m} className={ov?.signupMode === m ? 'on' : ''} data-testid={`signup-${m}`}
                onClick={() => void act(() => admin.setSignupMode(m), `注册方式已改为「${label}」`)}>{label}</button>
            ))}
          </div>
          <p className="adm-meta">{MODES.find(([m]) => m === ov?.signupMode)?.[2]}</p>
        </section>

        <section className="adm-sec">
          <div className="adm-head"><h2>邀请链接</h2></div>
          <form className="adm-invite" onSubmit={(e) => { e.preventDefault(); void (async () => {
            try { const r = await admin.createInvite({ maxUses: inv.maxUses, days: inv.days, note: inv.note.trim() || undefined }); setMade({ link: r.link, copied: false }); setInv({ ...inv, note: '' }); await load() } catch (err) { say(false, (err as Error).message) }
          })() }}>
            <label className="field"><span>可用次数</span><input type="number" min={1} max={1000} value={inv.maxUses} onChange={(e) => setInv({ ...inv, maxUses: Number(e.target.value) || 1 })} /></label>
            <label className="field"><span>有效天数</span><input type="number" min={1} max={365} value={inv.days} onChange={(e) => setInv({ ...inv, days: Number(e.target.value) || 7 })} /></label>
            <label className="field grow"><span>备注（只有管理员看得到）</span><input maxLength={120} value={inv.note} onChange={(e) => setInv({ ...inv, note: e.target.value })} placeholder="例如：设计组 / 客户 A" /></label>
            <button className="btn primary" type="submit" data-testid="invite-create"><Link2 />生成邀请链接</button>
          </form>
          {made && (
            <div className="adm-made" data-testid="invite-made">
              <code>{made.link}</code>
              <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(made.link).then(() => setMade({ ...made, copied: true })).catch(() => undefined) }}>{made.copied ? <Check /> : <Copy />}{made.copied ? '已复制' : '复制'}</button>
              <span className="adm-meta">链接只显示这一次，复制后发给对方。</span>
            </div>
          )}
          {invites.length > 0 && (
            <table className="adm-table" data-testid="invite-list">
              <thead><tr><th>链接</th><th>备注</th><th>已用</th><th>到期</th><th>状态</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.label}…</td>
                    <td>{i.note ?? <span className="muted">—</span>}</td>
                    <td className="mono">{i.uses} / {i.maxUses}</td>
                    <td>{day(i.expiresAt)}</td>
                    <td><span className={`adm-state ${i.active ? 'on' : 'off'}`}>{i.revoked ? '已撤销' : i.active ? '可用' : i.uses >= i.maxUses ? '已用完' : '已过期'}</span></td>
                    <td className="act">{i.active && <button className="btn xs" onClick={() => void act(() => admin.revokeInvite(i.id), '邀请已撤销')}>撤销</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="adm-sec">
          <div className="adm-head">
            <h2>账号{users ? <span className="muted"> · {users.total}</span> : null}</h2>
            <label className="adm-search"><Search aria-hidden="true" /><input placeholder="按邮箱查找" value={q} onChange={(e) => setQ(e.target.value)} aria-label="按邮箱查找账号" data-testid="admin-search" /></label>
          </div>
          {users && (
            <table className="adm-table" data-testid="admin-users">
              <thead><tr><th>邮箱</th><th>状态</th><th>存储</th><th>运行</th><th>最近登录</th><th>注册</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {users.users.map((u) => {
                  const self = me.email === u.email
                  const limit = u.effectiveQuotaMb ? u.effectiveQuotaMb * 1024 * 1024 : 0
                  return (
                    <tr key={u.id} data-testid="admin-user-row" data-email={u.email}>
                      <td>{u.email}{u.isAdmin && <span className="tag">管理员</span>}{self && <span className="muted">（你）</span>}</td>
                      <td><span className={`adm-state ${u.disabled ? 'off' : 'on'}`}>{u.disabled ? '已停用' : '正常'}</span></td>
                      <td className="mono">
                        {bytes(u.usage.bytes)}{limit ? ` / ${bytes(limit)}` : ''}
                        {limit > 0 && <span className="adm-bar-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, (u.usage.bytes / limit) * 100)}%` }} /></span>}
                      </td>
                      <td className="mono">{u.usage.runs}</td>
                      <td>{when(u.lastLogin)}</td>
                      <td>{day(u.createdAt)}</td>
                      <td className="act">
                        <span className="adm-menu-wrap" onClick={(e) => e.stopPropagation()}>
                          <button className="btn xs icon ghost" aria-label={`${u.email} 的操作`} aria-haspopup="menu" aria-expanded={menu === u.id} onClick={() => setMenu(menu === u.id ? null : u.id)} data-testid="admin-user-menu"><Ellipsis /></button>
                          {menu === u.id && (
                            <span className="menu adm-menu" role="menu">
                              {!self && <button role="menuitem" className="menu-item" onClick={() => void act(() => admin.setDisabled(u.id, !u.disabled), u.disabled ? `已恢复 ${u.email}` : `已停用 ${u.email}，所有设备已退出登录`)} data-testid="admin-toggle-disabled">{u.disabled ? '恢复账号' : '停用账号'}</button>}
                              {!self && <button role="menuitem" className="menu-item" onClick={() => { setMenu(null); void admin.resetPassword(u.id).then((r) => setDialog({ kind: 'password', email: u.email, password: r.password })).catch((e) => say(false, (e as Error).message)) }} data-testid="admin-reset">重置密码…</button>}
                              <button role="menuitem" className="menu-item" onClick={() => { setMenu(null); setDialog({ kind: 'quota', user: u }) }} data-testid="admin-quota">存储上限…</button>
                              {!(self && u.isAdmin) && <button role="menuitem" className="menu-item" onClick={() => void act(() => admin.setAdmin(u.id, !u.isAdmin), u.isAdmin ? `${u.email} 不再是管理员` : `${u.email} 现在是管理员`)}>{u.isAdmin ? '取消管理员' : '设为管理员'}</button>}
                              {!self && <><div className="menu-sep" /><button role="menuitem" className="menu-item danger" onClick={() => { setMenu(null); setDialog({ kind: 'delete', user: u }) }} data-testid="admin-delete">删除账号…</button></>}
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {dialog && <AdminDialog dialog={dialog} onClose={() => setDialog(null)} onDone={(text) => { setDialog(null); say(true, text); void load() }} onError={(text) => say(false, text)} />}
    </div>
  )
}

function AdminDialog({ dialog, onClose, onDone, onError }: { dialog: NonNullable<Dialog>; onClose: () => void; onDone: (text: string) => void; onError: (text: string) => void }) {
  const [quota, setQuota] = useState(dialog.kind === 'quota' && dialog.user.quotaMb ? String(dialog.user.quotaMb) : '')
  const [typed, setTyped] = useState('')
  const [copied, setCopied] = useState(false)
  const first = useRef<HTMLInputElement | HTMLButtonElement>(null)
  useEffect(() => { first.current?.focus() }, [])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal confirm" role="dialog" aria-label="账号操作" data-testid="admin-dialog">
        <div className="modal-head"><h2>{dialog.kind === 'password' ? '新的临时密码' : dialog.kind === 'quota' ? '存储上限' : '删除账号'}</h2><button className="btn icon ghost" onClick={onClose} aria-label="关闭"><X /></button></div>
        <div className="pane">
          {dialog.kind === 'password' && (
            <>
              <p className="muted">{dialog.email} 的密码已重置，所有设备已退出登录。把下面的临时密码告诉对方，并请对方登录后在「设置 → 账号」里修改。它只显示这一次。</p>
              <div className="adm-made"><code data-testid="admin-temp-password">{dialog.password}</code>
                <button ref={first as React.RefObject<HTMLButtonElement>} className="btn sm" onClick={() => { void navigator.clipboard?.writeText(dialog.password).then(() => setCopied(true)).catch(() => undefined) }}>{copied ? <Check /> : <Copy />}{copied ? '已复制' : '复制'}</button></div>
            </>
          )}
          {dialog.kind === 'quota' && (
            <label className="field"><span>{dialog.user.email} 最多可以存放的素材与生成结果（MB）。留空使用默认值。</span>
              <input ref={first as React.RefObject<HTMLInputElement>} type="number" min={1} value={quota} onChange={(e) => setQuota(e.target.value)} placeholder="默认" data-testid="admin-quota-input" /></label>
          )}
          {dialog.kind === 'delete' && (
            <>
              <p className="muted">会永久删除 {dialog.user.email} 的账号和全部画布、模型档案（含 API Key）、素材、生成记录与备份，无法恢复。</p>
              <label className="field"><span>输入对方的邮箱以确认</span><input ref={first as React.RefObject<HTMLInputElement>} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="admin-delete-confirm" /></label>
            </>
          )}
        </div>
        <div className="foot">
          {dialog.kind === 'password' && <button className="btn primary" onClick={onClose}>完成</button>}
          {dialog.kind === 'quota' && (
            <>
              <button className="btn" onClick={onClose}>取消</button>
              <button className="btn primary" data-testid="admin-quota-save" onClick={() => {
                const mb = quota.trim() === '' ? null : Number(quota)
                void admin.setQuota(dialog.user.id, mb).then(() => onDone(mb === null ? '已改回默认存储上限' : `存储上限已设为 ${mb} MB`)).catch((e) => onError((e as Error).message))
              }}>保存</button>
            </>
          )}
          {dialog.kind === 'delete' && (
            <>
              <button className="btn" onClick={onClose}>取消</button>
              <button className="btn danger" disabled={typed.trim().toLowerCase() !== dialog.user.email} data-testid="admin-delete-go"
                onClick={() => { void admin.remove(dialog.user.id).then(() => onDone(`已删除 ${dialog.user.email}`)).catch((e) => onError((e as Error).message)) }}>永久删除</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
