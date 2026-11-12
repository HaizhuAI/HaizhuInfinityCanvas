import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Eye, EyeOff, Infinity as InfinityIcon, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react'
import { auth, type AuthConfig } from './api'
import './landing.css'
import './auth.css'

/** only paths on this site (never "//other.site" or a full URL): no open redirect after sign-in */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  return raw
}

/** /login and /signup for multi-user deployments */
export function Auth({ mode: initial }: { mode: 'login' | 'signup' }) {
  const [mode, setMode] = useState(initial)
  const [cfg, setCfg] = useState<AuthConfig | null | 'off'>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const emailRef = useRef<HTMLInputElement>(null)
  const params = new URLSearchParams(location.search)
  const next = safeNext(params.get('next'))
  const expired = params.has('next')

  useEffect(() => {
    // already signed in: straight on
    void auth.me().then(() => location.replace(next)).catch(() => undefined)
    void auth.config().then(setCfg).catch(() => setCfg('off'))
  }, [next])
  useEffect(() => { document.title = `${mode === 'login' ? '登录' : '注册'} · Haizhu Infinity Canvas`; emailRef.current?.focus() }, [mode])

  const switchTo = (m: 'login' | 'signup') => {
    setMode(m)
    setError('')
    history.replaceState(null, '', `/${m}${location.search}`)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') await auth.login(email, password)
      else await auth.signup(email, password)
      location.replace(next)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const signupClosed = cfg !== null && cfg !== 'off' && !cfg.signup
  const min = cfg && cfg !== 'off' ? cfg.passwordMin : 8
  return (
    <div className="lp auth" data-testid="auth">
      <div className="lp-glow" aria-hidden="true" />
      <main className="auth-card">
        <a className="lp-brand" href="/welcome"><span className="logo" aria-hidden="true"><InfinityIcon /></span>Haizhu <span>Infinity Canvas</span></a>
        {cfg === 'off' ? (
          <>
            <h1>这个部署没有开启账号</h1>
            <p className="auth-sub">它是单人使用的版本，直接进入画布即可。</p>
            <a className="lp-btn primary wide" href="/">进入画布<ArrowRight /></a>
          </>
        ) : (
          <>
            <h1>{mode === 'login' ? '欢迎回来' : '创建你的工作室'}</h1>
            <p className="auth-sub">
              {mode === 'login'
                ? (expired ? '登录已过期，请重新登录，回到刚才的画布。' : '登录后继续你的画布。')
                : '注册即得一个独立空间：画布、模型档案与文件只属于你。'}
            </p>
            {mode === 'signup' && signupClosed ? (
              <div className="auth-note" role="status">暂不开放注册，请联系管理员开通账号。</div>
            ) : (
              <form onSubmit={(e) => void submit(e)} noValidate>
                <label className="auth-field">
                  <span>邮箱</span>
                  <input ref={emailRef} type="email" name="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="auth-email" />
                </label>
                <label className="auth-field">
                  <span>密码{mode === 'signup' && <small>至少 {min} 位，别用生日或 12345678</small>}</span>
                  <span className="auth-pw">
                    <input type={show ? 'text' : 'password'} name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'signup' ? min : undefined} maxLength={200}
                      value={password} onChange={(e) => setPassword(e.target.value)} data-testid="auth-password" />
                    <button type="button" className="auth-eye" onClick={() => setShow(!show)} aria-label={show ? '隐藏密码' : '显示密码'} aria-pressed={show}>{show ? <EyeOff /> : <Eye />}</button>
                  </span>
                </label>
                {error && <div className="auth-error" role="alert" data-testid="auth-error">{error}</div>}
                <button className="lp-btn primary wide" type="submit" disabled={busy || !email || !password} data-testid="auth-submit">
                  {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : mode === 'login' ? <LockKeyhole aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                  {mode === 'login' ? '登录' : '注册并开始'}
                </button>
              </form>
            )}
            <p className="auth-switch">
              {mode === 'login'
                ? <>还没有账号？<button type="button" onClick={() => switchTo('signup')} data-testid="auth-to-signup">免费注册</button></>
                : <>已经有账号？<button type="button" onClick={() => switchTo('login')} data-testid="auth-to-login">直接登录</button></>}
            </p>
            {mode === 'login' && <p className="auth-hint">忘记密码？请联系这个网站的管理员重置。</p>}
          </>
        )}
        <p className="auth-trust"><ShieldCheck aria-hidden="true" />模型和 API Key 都是你自己的，Key 加密保存，只用于替你调用模型。</p>
      </main>
    </div>
  )
}
