import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Boxes, Clapperboard, GitCompareArrows, Infinity as InfinityIcon, KeyRound, Layers, Play, ScanSearch, Sparkles, Zap } from 'lucide-react'
import './landing.css'

/**
 * The public front page (/welcome): what the canvas is, shown with real screenshots of it.
 * Layout ideas (hero with one action, chip row, screenshot bento, numbered steps, closing band) are
 * common landing-page patterns; all wording, drawing and code here is this project's own.
 */
const CHIPS = ['文生图 → 图生视频', '导演分镜', '参考图反推', '多模型对比', '配音与字幕', '导出成片']
const SHOTS: { id: string; label: string; img: string; alt: string }[] = [
  { id: 'pipeline', label: '节点流程', img: 'pipeline', alt: '一条从创意到视频的节点流程' },
  { id: 'storyboard', label: '分镜成片', img: 'storyboard', alt: '导演分镜展开成每个镜头的画面、视频与配音' },
  { id: 'compare', label: '模型对比', img: 'compare', alt: '三个模型的结果并排比较' },
  { id: 'assistant', label: '画布助手', img: 'assistant', alt: '助手根据一句话给出节点方案' },
]
const FEATURES: { Icon: typeof Zap; title: string; text: string; img?: string; wide?: boolean }[] = [
  { Icon: Layers, title: '模型即节点', text: '把你自己的文本、视觉、图片、视频、语音模型接进来，拖到画布上连线。端口有类型，接不上的线拉不出来。', img: 'pipeline', wide: true },
  { Icon: Zap, title: '同时生成', text: '互不依赖的镜头一起跑，不用一个个等。', img: 'parallel' },
  { Icon: GitCompareArrows, title: '多模型对比', text: '同一段提示词交给几个模型，并排看，留下最好的。', img: 'compare' },
  { Icon: Clapperboard, title: '导演 Skill', text: '一句创意拆成分镜，一键展开成画面、视频、配音和成片。', img: 'storyboard', wide: true },
  { Icon: ScanSearch, title: '提示词反推', text: '参考图、参考视频反推成可复用的提示词与负面词。', img: 'reverse' },
  { Icon: Sparkles, title: '画布助手', text: '说出想做的，方案先给你看，确认后才加到画布。', img: 'assistant' },
]
const STEPS = [
  ['接入模型', '填一次接口地址和 Key，测试连接后它就是画布上的一个节点。Key 加密保存在你的服务器上。'],
  ['搭一条流程', '从模板开始，或让助手按一句话搭好；每次生成都保留版本，随时切回。'],
  ['运行与交付', '运行前先看预估费用；完成后导出成片、字幕和可在剪辑软件里继续精修的工程。'],
]

export function Landing({ onEnter }: { onEnter: () => void }) {
  const [tab, setTab] = useState(SHOTS[0]!.id)
  const root = useRef<HTMLDivElement>(null)
  // reveal sections as they scroll into view (skipped when the OS asks for reduced motion)
  useEffect(() => {
    const els = root.current?.querySelectorAll('.reveal') ?? []
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { threshold: 0.12 })
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])
  const shot = SHOTS.find((s) => s.id === tab)!
  return (
    <div className="lp" ref={root} data-testid="landing">
      <header className="lp-nav">
        <a className="lp-brand" href="/welcome"><span className="logo" aria-hidden="true"><InfinityIcon /></span>Haizhu <span>Infinity Canvas</span></a>
        <nav aria-label="页面导航"><a href="#features">功能</a><a href="#how">怎么用</a><a href="#deploy">部署</a></nav>
        <button className="lp-btn primary sm" onClick={onEnter} data-testid="landing-enter-nav">进入画布<ArrowRight /></button>
      </header>

      <section className="lp-hero">
        <div className="lp-glow" aria-hidden="true" />
        <span className="lp-eyebrow"><Sparkles aria-hidden="true" />面向图片与视频创作者的无限画布</span>
        <h1>把你的模型<br />连成一支<em>创作团队</em></h1>
        <p className="lp-sub">文本、视觉、图片、视频、语音模型都是画布上的节点。连线、运行，从一句创意走到成片——模型和 Key 都是你自己的。</p>
        <div className="lp-cta">
          <button className="lp-btn primary" onClick={onEnter} data-testid="landing-enter"><Play />开始创作</button>
          <a className="lp-btn ghost" href="#features">看看能做什么</a>
        </div>
        <ul className="lp-chips" aria-label="常见用法">{CHIPS.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="lp-stage reveal">
          <div className="lp-tabs" role="tablist" aria-label="界面预览">
            {SHOTS.map((s) => <button key={s.id} role="tab" aria-selected={tab === s.id} className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>{s.label}</button>)}
          </div>
          <div className="lp-frame"><img key={shot.img} src={`/landing/${shot.img}.webp`} alt={shot.alt} width={1600} height={1000} /></div>
        </div>
      </section>

      <section className="lp-sec" id="features">
        <div className="lp-head reveal"><span className="lp-kicker">功能</span><h2>一块画布，完成整条创作链路</h2></div>
        <div className="lp-bento">
          {FEATURES.map((f) => (
            <article key={f.title} className={`lp-card reveal${f.wide ? ' wide' : ''}`}>
              <div className="lp-card-txt"><span className="lp-ico" aria-hidden="true"><f.Icon /></span><h3>{f.title}</h3><p>{f.text}</p></div>
              {f.img && <div className="lp-card-img"><img src={`/landing/${f.img}.webp`} alt="" loading="lazy" decoding="async" width={1600} height={1000} /></div>}
            </article>
          ))}
        </div>
      </section>

      <section className="lp-sec" id="how">
        <div className="lp-head reveal"><span className="lp-kicker">怎么用</span><h2>三步，从空画布到成片</h2></div>
        <ol className="lp-steps">
          {STEPS.map(([t, d], i) => <li key={t} className="reveal"><span className="no">{String(i + 1).padStart(2, '0')}</span><h3>{t}</h3><p>{d}</p></li>)}
        </ol>
      </section>

      <section className="lp-sec" id="deploy">
        <div className="lp-head reveal"><span className="lp-kicker">部署</span><h2>你的数据，留在你的机器上</h2></div>
        <div className="lp-trio">
          <article className="reveal"><span className="lp-ico" aria-hidden="true"><KeyRound /></span><h3>自带模型与 Key</h3><p>直接调用你选的服务商，费用按你和服务商的价格结算。Key 加密保存，不会出现在浏览器里。</p></article>
          <article className="reveal"><span className="lp-ico" aria-hidden="true"><Boxes /></span><h3>三种运行方式</h3><p>Windows 与 Linux 桌面版，或用 Docker 部署成网站，在浏览器里使用。</p></article>
          <article className="reveal"><span className="lp-ico" aria-hidden="true"><Layers /></span><h3>项目可带走</h3><p>一个文件带走画布、素材和全部生成结果，换电脑也不用重新生成。</p></article>
        </div>
      </section>

      <section className="lp-band reveal">
        <h2>现在就搭第一条流程</h2>
        <p>空画布上有四个常用模板，接入一个模型就能运行。</p>
        <button className="lp-btn primary" onClick={onEnter}><Play />进入画布</button>
      </section>

      <footer className="lp-foot"><span>Haizhu Infinity Canvas（海柱无限画布）</span><span>界面截图来自真实运行，图片为演示用示意图</span></footer>
    </div>
  )
}
