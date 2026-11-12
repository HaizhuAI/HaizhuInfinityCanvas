import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { auth, type AuthConfig } from './api'
import { Mark } from './icons'
import './landing.css'

/**
 * The public front page (/welcome). Built to Taste Skill's rules for a software page: the hero alone on
 * the first screen with the product's own UI beside the heading, one section per screen, one button
 * pair, an opaque header, plain copy (the heading names what it is and for whom, one hard fact up
 * front), real screenshots of the app, hover and press feedback, the hero entering once on load.
 * No eyebrows, gradient text, glows, chip rows or numbered steps.
 */
const VIEWS: { id: string; label: string; img: string; alt: string }[] = [
  { id: 'pipeline', label: '节点流程', img: 'pipeline', alt: '画布上的一条流程：参考图反推、出图、生成视频和配音' },
  { id: 'storyboard', label: '分镜成片', img: 'storyboard', alt: '导演分镜展开后的镜头画面、视频、配音与合成的成片' },
  { id: 'compare', label: '模型对比', img: 'compare', alt: '同一段提示词交给三个模型生成，结果并排比较' },
  { id: 'assistant', label: '画布助手', img: 'assistant', alt: '画布助手按一句话给出节点方案，确认后加到画布' },
]
const FEATURES: { title: string; text: string; img: string; wide?: boolean }[] = [
  { title: '模型是画布上的节点', text: '文本、视觉、图片、视频、语音模型各占一个节点，按端口类型连线；接不上的线拉不出来。每次生成都保留版本，可以随时切回。', img: 'pipeline', wide: true },
  { title: '互不依赖的节点同时运行', text: '分镜里的各个镜头、对比里的各个模型一起生成；运行前先列出会调用哪些模型和预估费用。', img: 'parallel' },
  { title: '多个模型并排比较', text: '同一段提示词交给二到四个模型，结果、用时和单价并排显示，选中的结果接管下游连线。', img: 'compare' },
  { title: '导演分镜一键展开', text: '一句创意交给导演 Skill 拆成分镜，再展开成每个镜头的画面、视频、配音，最后合成成片和字幕。', img: 'storyboard', wide: true },
  { title: '参考图反推提示词', text: '图片或视频反推成可复用的提示词，正向提示词和负面词分别接到生成节点。', img: 'reverse' },
  { title: '画布助手', text: '用一句话描述要做的东西，助手给出节点方案，你确认后才加到画布。', img: 'assistant' },
]
const RUN_WAYS: [string, string][] = [
  ['Windows 与 Linux 桌面版', '安装后打开即用。项目、素材和生成结果都在本机，API Key 交给系统钥匙串加密保存。'],
  ['网页版，一个人或一个小团队', 'Docker 部署到自己的服务器，用访问令牌进入；数据库每 6 小时自动备份，损坏时自动从备份恢复。'],
  ['多人网站', '开启账号模式后访客注册登录，每个账号一个独立的数据库和文件夹，彼此看不到对方的画布和 Key。'],
]

/** what the visitor can do: open the canvas (one-person install, or signed in), or sign up / sign in */
type Visitor = { kind: 'open' } | { kind: 'guest'; signup: boolean }

export function Landing({ onEnter }: { onEnter: () => void }) {
  const [view, setView] = useState(VIEWS[0]!.id)
  const [visitor, setVisitor] = useState<Visitor>({ kind: 'open' })
  const tabsRef = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null)

  // a multi-user deployment shows sign-up / sign-in to visitors who aren't signed in
  useEffect(() => {
    document.title = 'Haizhu Infinity Canvas：给图片和视频创作者的节点画布'
    void fetch('/api/health').then((r) => r.json() as Promise<{ accounts?: boolean }>).then(async (h) => {
      if (!h.accounts) return
      const signedIn = await auth.me().then(() => true, () => false)
      const cfg: AuthConfig | undefined = await auth.config().catch(() => undefined)
      if (!signedIn) setVisitor({ kind: 'guest', signup: cfg?.signup ?? true })
    }).catch(() => undefined)
  }, [])
  // the tab indicator slides to the chosen tab (transform only)
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLButtonElement>(`[data-view="${view}"]`)
    if (el) setInd({ x: el.offsetLeft, w: el.offsetWidth })
  }, [view])

  const guest = visitor.kind === 'guest'
  const primary = guest && visitor.signup
    ? { label: '免费注册', href: '/signup' }
    : guest ? { label: '登录', href: '/login' } : { label: '打开画布', href: '/' }
  const go = (e: React.MouseEvent, href: string) => { if (href === '/') { e.preventDefault(); onEnter() } }
  const current = VIEWS.find((v) => v.id === view)!

  return (
    <div className="lp" data-testid="landing">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-row">
          <a className="lp-brand" href="/welcome"><Mark size={22} />Haizhu <span>Infinity Canvas</span></a>
          <nav aria-label="页面导航">
            <a href="#workflow">流程</a><a href="#features">功能</a><a href="#run">部署</a>
          </nav>
          <span className="lp-nav-act">
            {guest && <a className="lp-word" href="/login" data-testid="landing-login">登录</a>}
            {guest && visitor.signup
              ? <a className="lp-btn primary sm" href="/signup" data-testid="landing-signup">免费注册</a>
              : !guest && <a className="lp-btn primary sm" href="/" onClick={(e) => go(e, '/')} data-testid="landing-enter-nav">打开画布</a>}
          </span>
        </div>
      </header>

      <main>
        <section className="lp-hero" data-enter>
          <div className="lp-wrap">
            <h1><span>给图片和视频创作者的</span><span>节点画布</span></h1>
            <div className="lp-hero-row">
              <div>
                <p className="lp-lead">把你自己的文本、视觉、图片、视频和语音模型放到同一块画布上连线运行，从一句文字做到带配音和字幕的成片。</p>
                <p className="lp-fact">接 OpenAI 兼容接口、Replicate、fal 和本机 Ollama；Windows、Linux 桌面版和网页版。</p>
              </div>
              <div className="lp-actions">
                <a className="lp-btn primary" href={primary.href} onClick={(e) => go(e, primary.href)} data-testid="landing-enter">{primary.label}<ArrowRight className="lp-arrow" aria-hidden="true" /></a>
                <a className="lp-btn secondary" href="#workflow">看一条完整流程</a>
              </div>
            </div>
            <figure className="lp-frame lp-hero-shot">
              <img src="/landing/pipeline.webp" alt="画布上的一条流程：参考图反推、出图、生成视频和配音" width={1600} height={1000} fetchPriority="high" />
            </figure>
          </div>
        </section>

        <section className="lp-sec" id="workflow">
          <div className="lp-wrap">
            <h2>一块画布上的整条流程。<span className="lp-muted">每一步都能换模型，每次生成都留版本。</span></h2>
            <div className="lp-tabs" role="tablist" aria-label="界面预览" ref={tabsRef}>
              {ind && <span className="lp-ind" aria-hidden="true" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} />}
              {VIEWS.map((v) => (
                <button key={v.id} role="tab" data-view={v.id} aria-selected={view === v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>{v.label}</button>
              ))}
            </div>
            <figure className="lp-frame lp-stage"><img key={current.img} src={`/landing/${current.img}.webp`} alt={current.alt} width={1600} height={1000} loading="lazy" /></figure>
          </div>
        </section>

        <section className="lp-sec lp-sec-2" id="features">
          <div className="lp-wrap">
            <h2>做图片和视频时用得上的部分</h2>
            <div className="lp-grid">
              {FEATURES.map((f) => (
                <article key={f.title} className={`lp-card${f.wide ? ' wide' : ''}`}>
                  <div className="lp-card-img"><img src={`/landing/${f.img}.webp`} alt="" loading="lazy" decoding="async" width={1600} height={1000} /></div>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-sec" id="run">
          <div className="lp-wrap lp-run">
            <h2>三种运行方式，模型和 Key 始终是你自己的</h2>
            <dl className="lp-rows">
              {RUN_WAYS.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}
            </dl>
            <p className="lp-note">调用直接发给你选的服务商，费用按你和服务商的价格结算。API Key 加密保存，只在服务器上使用，不会出现在浏览器里。</p>
          </div>
        </section>
      </main>

      <footer className="lp-close">
        <div className="lp-wrap">
          <p className="lp-close-type">接入一个模型，就能运行第一条流程。</p>
          <a className="lp-btn primary lg" href={primary.href} onClick={(e) => go(e, primary.href)}>{guest ? primary.label : '打开画布'}<ArrowRight className="lp-arrow" aria-hidden="true" /></a>
          <div className="lp-legal">
            <span className="lp-brand sm"><Mark size={18} />Haizhu Infinity Canvas</span>
            <span>© {new Date().getFullYear()} Haizhu</span>
            <span>界面截图来自真实运行，图片为演示用示意图</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
