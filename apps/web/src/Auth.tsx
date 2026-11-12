import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, MailCheck, ShieldCheck } from 'lucide-react'
import { Mark } from './icons'
import { auth, type AuthConfig } from './api'
import './landing.css'
import './auth.css'

/** only paths on this site (never "//other.site" or a full URL): no open redirect after sign-in */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw
}

export type AuthMode = 'login' | 'signup' | 'forgot' | 'reset'
const TITLES: Record<AuthMode, string> = { login: '登录到你的画布', signup: '注册一个账号', forgot: '重置密码', reset: '设置新密码' }
const TAB_TITLES: Record<AuthMode, string> = { login: '登录', signup: '注册', forgot: '忘记密码', reset: '设置新密码' }

/** /login, /signup (?invite=), /forgot and /reset?token= for multi-user deployments */
export function Auth({ mode: initial }: { mode: AuthMode }) {
  const [mode, setMode] = useState(initial)
  const [cfg, setCfg] = useState<AuthConfig | null | 'off'>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mailed, setMailed] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const pwRef = useRef<HTMLInputElement>(null)
  const params = new URLSearchParams(location.search)
  const next = safeNext(params.get('next'))
  const expired = params.has('next')
  const invite = params.get('invite') ?? ''
  const token = params.get('token') ?? ''

  useEffect(() => {
    // already signed in: straight on (except when following a reset link)
    if (initial !== 'reset') void auth.me().then(() => location.replace(next)).catch(() => undefined)
    void auth.config().then(setCfg).catch(() => setCfg('off'))
  }, [next, initial])
  useEffect(() => {
    document.title = `${TAB_TITLES[mode]} · Haizhu Infinity Canvas`
    if (mode === 'reset') pwRef.current?.focus(); else emailRef.current?.focus()
  }, [mode])

  const switchTo = (m: AuthMode) => {
    setMode(m)
    setError('')
    setMailed(false)
    const keep = new URLSearchParams(location.search)
    keep.delete('token')
    const q = keep.toString()
    history.replaceState(null, '', `/${m}${q ? `?${q}` : ''}`)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await auth.login(email, password)
      else if (mode === 'signup') await auth.signup(email, password, invite || undefined)
      else if (mode === 'reset') await auth.reset(token, password)
      else { await auth.forgot(email); setMailed(true); setBusy(false); return }
      location.replace(mode === 'reset' ? '/' : next)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const c = cfg && cfg !== 'off' ? cfg : undefined
  const signupMode = c?.signupMode ?? (c && !c.signup ? 'closed' : 'open')
  const signupBlocked = mode === 'signup' && !!c && (signupMode === 'closed' || (signupMode === 'invite' && !invite))
  const min = c?.passwordMin ?? 8
  const needsPassword = mode !== 'forgot'
  const needsEmail = mode !== 'reset'
  const sub: Record<AuthMode, string> = {
    login: expired ? '登录已过期，请重新登录，回到刚才的画布。' : '登录后继续你的画布。',
    signup: invite ? '你收到了一份邀请。每个账号一个独立空间：画布、模型档案和文件只有你能看到。' : '每个账号一个独立空间：画布、模型档案和文件只有你能看到。',
    forgot: '填写注册用的邮箱，我们会发一个重置链接，30 分钟内有效。',
    reset: '设置新密码后，所有设备上的登录都会退出，用新密码重新登录。',
  }
  return (
    <div className="lp auth" data-testid="auth">
      <main className="auth-card">
        <a className="lp-brand" href="/welcome"><Mark size={22} />Haizhu <span>Infinity Canvas</span></a>
        {cfg === 'off' ? (
          <>
            <h1>这个部署没有开启账号</h1>
            <p className="auth-sub">它是单人使用的版本，直接进入画布即可。</p>
            <a className="lp-btn primary wide" href="/">打开画布<ArrowRight className="lp-arrow" /></a>
          </>
        ) : (
          <>
            <h1>{TITLES[mode]}</h1>
            <p className="auth-sub">{sub[mode]}</p>
            {signupBlocked ? (
              <div className="auth-note" role="status" data-testid="signup-blocked">
                {signupMode === 'invite' ? '现在只接受邀请注册，请使用管理员发给你的邀请链接。' : '暂不开放注册，请联系管理员开通账号。'}
              </div>
            ) : mode === 'forgot' && c && !c.passwordReset ? (
              <div className="auth-note" role="status">这个网站没有配置邮件服务，请联系管理员重置密码。</div>
            ) : mode === 'reset' && !token ? (
              <div className="auth-note" role="status">链接不完整，请从邮件里重新打开，或重新申请。</div>
            ) : mailed ? (
              <div className="auth-note ok" role="status" data-testid="auth-mailed"><MailCheck aria-hidden="true" />如果这个邮箱注册过，重置链接已经发出，请查收（也看看垃圾邮件）。</div>
            ) : (
              <form onSubmit={(e) => void submit(e)} noValidate>
                {needsEmail && (
                  <label className="auth-field">
                    <span>邮箱</span>
                    <input ref={emailRef} type="email" name="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="auth-email" />
                  </label>
                )}
                {needsPassword && (
                  <label className="auth-field">
                    <span>{mode === 'reset' ? '新密码' : '密码'}{mode !== 'login' && <small>至少 {min} 位，别用生日或 12345678</small>}</span>
                    <span className="auth-pw">
                      <input ref={pwRef} type={show ? 'text' : 'password'} name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? undefined : min} maxLength={200}
                        value={password} onChange={(e) => setPassword(e.target.value)} data-testid="auth-password" />
                      <button type="button" className="auth-eye" onClick={() => setShow(!show)} aria-label={show ? '隐藏密码' : '显示密码'} aria-pressed={show}>{show ? <EyeOff /> : <Eye />}</button>
                    </span>
                  </label>
                )}
                {error && <div className="auth-error" role="alert" data-testid="auth-error">{error}</div>}
                <button className="lp-btn primary wide" type="submit" disabled={busy || (needsEmail && !email) || (needsPassword && !password)} data-testid="auth-submit">
                  {busy && <LoaderCircle className="spin" aria-hidden="true" />}
                  {{ login: '登录', signup: '注册并打开画布', forgot: '发送重置链接', reset: '保存新密码并登录' }[mode]}
                  {!busy && mode === 'login' && <LockKeyhole className="lp-arrow" aria-hidden="true" />}
                </button>
              </form>
            )}
            <p className="auth-switch">
              {mode === 'login'
                ? <>还没有账号？<button type="button" onClick={() => switchTo('signup')} data-testid="auth-to-signup">免费注册</button></>
                : mode === 'signup'
                  ? <>已经有账号？<button type="button" onClick={() => switchTo('login')} data-testid="auth-to-login">直接登录</button></>
                  : <>想起来了？<button type="button" onClick={() => switchTo('login')} data-testid="auth-to-login">返回登录</button></>}
            </p>
            {mode === 'login' && (c?.passwordReset
              ? <p className="auth-hint"><button type="button" className="auth-link" onClick={() => switchTo('forgot')} data-testid="auth-to-forgot">忘记密码？</button></p>
              : <p className="auth-hint">忘记密码？请联系这个网站的管理员重置。</p>)}
          </>
        )}
        <p className="auth-trust"><ShieldCheck aria-hidden="true" />模型和 API Key 都是你自己的，Key 加密保存，只用于替你调用模型。</p>
      </main>
    </div>
  )
}
