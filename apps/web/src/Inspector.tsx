import { useReactFlow } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import { Download, GitCompareArrows, Info, LayoutGrid, MousePointerClick, PanelRightClose, Play, RefreshCw, Subtitles, TriangleExclamationPoint } from 'lucide-react'
import {
  ASPECT_RATIOS, NODE_TYPE_MAP, REVERSE_LANGS, REVERSE_STYLES, REVERSE_STYLE_LABEL, VARIATION_COUNTS, VIDEO_DURATIONS, type PortValue,
} from '@hzc/core'
import { assetUrl } from './api'
import { ErrorBox, FileCard, RUNNABLE, StatusPill, Values } from './CanvasNode'
import { VersionStrip } from './Versions'
import { CATEGORY_COLOR, KIND_LABEL, NODE_ICON } from './icons'
import { useStore, type CanvasNode } from './store'
import { VOICE_HINT } from './presets'
import { PromptOptimizer } from './PromptOptimizer'

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5]
/** node types that have a parameters section */
const HAS_PARAMS = new Set(['image-gen', 'video-gen', 'tts', 'director', 'image-reverse', 'video-reverse', 'export', 'vlm', 'llm'])
const EXPORT_SIZES: [string, string][] = [['', '跟随第一个片段'], ['1920x1080', '1080p 横屏 16:9'], ['1080x1920', '1080p 竖屏 9:16'], ['1080x1080', '1080 方形 1:1'], ['1280x720', '720p 横屏']]

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg2" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => <button key={String(v)} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  )
}

function JsonField({ id, value }: { id: string; value: unknown }) {
  const setNodeParam = useStore((s) => s.setNodeParam)
  const text = typeof value === 'string' ? value : value ? JSON.stringify(value) : ''
  let ok = true
  if (text.trim()) { try { const v = JSON.parse(text); ok = typeof v === 'object' && v !== null && !Array.isArray(v) } catch { ok = false } }
  return (
    <label className="field"><span>高级参数（JSON，按模型文档填写）</span>
      <textarea className="mono" spellCheck={false} placeholder={'{"seed": 42}'} value={text} onChange={(e) => setNodeParam(id, 'extra', e.target.value)} aria-invalid={!ok} />
      {!ok && <span className="warn"><TriangleExclamationPoint aria-hidden="true" />不是合法的 JSON 对象</span>}
    </label>
  )
}

/** Per-node-type parameters. Everything that is not the creative content itself lives here. */
/**
 * Where a generation node's prompt lives: its own text, or a connected text node (edited there);
 * a prompt that comes from another node's output (e.g. a text model) can't be rewritten here.
 */
function GenPrompt({ node, kind }: { node: CanvasNode; kind: 'image' | 'video' }) {
  const setNodeData = useStore((s) => s.setNodeData)
  const src = useStore(useShallow((s) => {
    const e = s.edges.find((x) => x.target === node.id && x.targetHandle === 'prompt')
    const n = e ? s.nodes.find((x) => x.id === e.source) : undefined
    return { id: n?.id, type: n?.type, text: n?.data.text ?? '', label: n?.data.label ?? '' }
  }))
  // the first frame (or the reference images) a vision model can look at while rewriting
  const imageIds = useStore(useShallow((s) => s.edges
    .filter((x) => x.target === node.id && (x.targetHandle === 'first' || x.targetHandle === 'ref'))
    .flatMap((x) => {
      const n = s.nodes.find((y) => y.id === x.source)
      const out = n?.type === 'image' ? n.data.assetId : s.runStates[x.source]?.outputs?.out?.find((v) => v.type === 'image')
      const id = typeof out === 'string' ? out : out && 'assetId' in out ? out.assetId : undefined
      return id ? [id] : []
    })))
  const fromImage = useStore((s) => s.edges.some((x) => x.target === node.id && x.targetHandle === 'first'))
  const viaText = src.id && src.type === 'text'
  const blocked = src.id && !viaText ? `提示词来自上游「${src.label || '节点'}」的输出，请在那里修改` : undefined
  const prompt = viaText ? src.text : src.id ? '' : node.data.text ?? ''
  return (
    <div className="field">
      <span>提示词{viaText ? <small>来自「{src.label || '文本'}」</small> : null}</span>
      <PromptOptimizer kind={kind} targetProfileId={node.data.profileId} prompt={prompt} fromImage={kind === 'video' && fromImage} imageIds={imageIds}
        disabledReason={blocked} onApply={(t) => setNodeData(viaText ? src.id! : node.id, { text: t })} />
    </div>
  )
}

function Params({ node }: { node: CanvasNode }) {
  const setNodeParam = useStore((s) => s.setNodeParam)
  const skills = useStore((s) => s.skills)
  const adapter = useStore((s) => s.profiles.find((x) => x.id === node.data.profileId)?.adapter)
  const voiceHint = (adapter && VOICE_HINT[adapter]) || '如 alloy'
  const p = node.data.params ?? {}
  const set = (k: string, v: unknown) => setNodeParam(node.id, k, v)
  const aspectSelect = (testid?: string, none = '模型默认') => (
    <label className="field"><span>画面比例</span>
      <select value={String(p.aspect_ratio ?? '')} onChange={(e) => set('aspect_ratio', e.target.value || undefined)} data-testid={testid}>
        <option value="">{none}</option>
        {ASPECT_RATIOS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    </label>
  )

  const countSelect = (
    <label className="field" title="同时生成几个，结果里点「选用」留下一个"><span>数量</span>
      <select value={String(p.count ?? 1)} onChange={(e) => set('count', Number(e.target.value) > 1 ? Number(e.target.value) : undefined)} data-testid="gen-count">
        {VARIATION_COUNTS.map((n) => <option key={n} value={n}>{n} 个</option>)}
      </select>
    </label>
  )

  switch (node.type) {
    case 'image-gen':
      return <><div className="grid2">{aspectSelect('gen-aspect')}{countSelect}</div><GenPrompt node={node} kind="image" /><JsonField id={node.id} value={p.extra} /></>
    case 'video-gen':
      return (
        <>
          <div className="grid2">
            {aspectSelect('gen-aspect')}
            <label className="field"><span>时长</span>
              <select value={String(p.duration ?? '')} onChange={(e) => set('duration', e.target.value ? Number(e.target.value) : undefined)}>
                <option value="">模型默认</option>
                {VIDEO_DURATIONS.map((d) => <option key={d} value={d}>{d} 秒</option>)}
              </select>
            </label>
            {countSelect}
          </div>
          <GenPrompt node={node} kind="video" />
          <JsonField id={node.id} value={p.extra} />
        </>
      )
    case 'tts':
      return (
        <div className="grid2">
          <label className="field"><span>音色</span><input value={String(p.voice ?? '')} placeholder={voiceHint} onChange={(e) => set('voice', e.target.value || undefined)} data-testid="tts-voice" /></label>
          <label className="field"><span>语速</span>
            <select value={String(p.speed ?? '')} onChange={(e) => set('speed', e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">默认</option>{SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </label>
        </div>
      )
    case 'director': {
      const directors = skills.filter((s) => s.kind === 'director')
      const others = skills.filter((s) => s.kind !== 'director' && s.kind !== 'image-reverse')
      return (
        <>
          <label className="field"><span>导演 Skill</span>
            <select value={String(p.skill ?? 'director-short-film')} onChange={(e) => set('skill', e.target.value)} data-testid="director-skill">
              {directors.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}
              {others.length > 0 && <optgroup label="其他 Skill">{others.map((s) => <option key={s.name} value={s.name}>{s.label}</option>)}</optgroup>}
              {skills.length === 0 && <option value="director-short-film">短片导演</option>}
            </select>
          </label>
          <div className="grid2">
            <label className="field"><span>镜头数</span>
              <select value={String(p.shots ?? 6)} onChange={(e) => set('shots', Number(e.target.value))} data-testid="director-shots">
                {[3, 4, 5, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n} 个</option>)}
              </select>
            </label>
            {aspectSelect(undefined, '不指定')}
          </div>
          <label className="field"><span>视觉风格</span><input value={String(p.style ?? '')} placeholder="如：胶片电影感、王家卫色调" onChange={(e) => set('style', e.target.value || undefined)} /></label>
          <div className="field"><span>提示词语言</span><Seg label="提示词语言" value={String(p.lang ?? 'zh')} options={[['zh', '中文'], ['en', 'English']]} onChange={(v) => set('lang', v)} /></div>
        </>
      )
    }
    case 'image-reverse': {
      // how to reverse: a built-in template, or an imported reverse skill (e.g. image-prompt-reverse)
      const reverseSkills = skills.filter((s) => s.kind === 'image-reverse')
      const skillName = typeof p.skill === 'string' && p.skill ? p.skill : undefined
      const skill = skillName ? skills.find((s) => s.name === skillName) : undefined
      return (
        <>
          <label className="field"><span>反推方式</span>
            <select value={skillName ? `skill:${skillName}` : String(p.style ?? 'general')} data-testid="reverse-style"
              onChange={(e) => { const v = e.target.value; if (v.startsWith('skill:')) set('skill', v.slice(6)); else { set('skill', undefined); set('style', v) } }}>
              <optgroup label="内置模板">{REVERSE_STYLES.map((s) => <option key={s} value={s}>{REVERSE_STYLE_LABEL[s]}</option>)}</optgroup>
              {reverseSkills.length > 0 && <optgroup label="已导入的反推 Skill">{reverseSkills.map((s) => <option key={s.name} value={`skill:${s.name}`}>{s.label}</option>)}</optgroup>}
              {skillName && !skill && <option value={`skill:${skillName}`}>{skillName}（已删除）</option>}
            </select>
          </label>
          {skill && (
            <div className="skill-info" data-testid="reverse-skill-info">
              <div className="ds">{skill.description}</div>
              <div className="meta">
                {skill.references.length > 0 && <span>含 {skill.references.length} 份参考文件</span>}
                {skill.license && <span className="tag" title="这个 Skill 由你从作者处导入到本机使用，遵循它自己的许可证">{skill.license}</span>}
                {skill.sourceUrl && <a href={skill.sourceUrl} target="_blank" rel="noreferrer">来源</a>}
              </div>
            </div>
          )}
          {skillName && !skill && <div className="warn"><TriangleExclamationPoint aria-hidden="true" />找不到这个 Skill，它可能已被删除：请重新选择反推方式</div>}
          <div className="field"><span>{skillName ? '传给下游的正向提示词' : '输出语言'}</span><Seg label="输出语言" value={String(p.lang ?? 'zh')} options={REVERSE_LANGS.map((l) => [l, l === 'zh' ? '中文' : 'English'])} onChange={(v) => set('lang', v)} /></div>
          {skillName
            ? <div className="hint"><Info aria-hidden="true" />负面词从「负面词」端口输出，可连到图片 / 视频生成节点；完整回答在下方结果里。</div>
            : <label className="field"><span>自定义指令（留空用内置模板）</span><textarea value={String(p.instruction ?? '')} onChange={(e) => set('instruction', e.target.value)} /></label>}
          <button className="link" style={{ alignSelf: 'flex-start', textAlign: 'left' }} onClick={() => useStore.getState().openSettings({ tab: 'skills' })} data-testid="reverse-import-skill">导入反推 Skill…（例如 GitHub 上的 image-prompt-reverse）</button>
        </>
      )
    }
    case 'video-reverse':
      return (
        <>
          <div className="grid2">
            <label className="field"><span>最多镜头</span>
              <select value={String(p.maxShots ?? 8)} onChange={(e) => set('maxShots', Number(e.target.value))} data-testid="vr-max">
                {[4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n} 个</option>)}
              </select>
            </label>
            <label className="field"><span>切镜灵敏度</span>
              <select value={String(p.threshold ?? 0.3)} onChange={(e) => set('threshold', Number(e.target.value))}>
                <option value={0.2}>高（更多镜头）</option><option value={0.3}>标准</option><option value={0.45}>低（更少镜头）</option>
              </select>
            </label>
          </div>
          <div className="field"><span>提示词语言</span><Seg label="提示词语言" value={String(p.lang ?? 'zh')} options={[['zh', '中文'], ['en', 'English']]} onChange={(v) => set('lang', v)} /></div>
        </>
      )
    case 'export':
      return (
        <>
          <label className="field"><span>输出尺寸</span>
            <select value={String(p.size ?? '')} onChange={(e) => set('size', e.target.value || undefined)} data-testid="export-size">
              {EXPORT_SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <div className="field"><span>帧率</span><Seg label="帧率" value={Number(p.fps ?? 30)} options={[[24, '24'], [25, '25'], [30, '30'], [60, '60']]} onChange={(v) => set('fps', v)} /></div>
          <div className="field"><span>原视频声音</span><Seg label="原视频声音" value={String(p.keepAudio ?? 'mix')} options={[['mix', '与配音混合'], ['drop', '去掉']]} onChange={(v) => set('keepAudio', v)} /></div>
          <label className="switch">
            <input type="checkbox" checked={p.editProject === true} onChange={(e) => set('editProject', e.target.checked || undefined)} data-testid="export-edit-project" />
            <span className="track"><span className="knob" /></span>
            <span>同时生成剪辑工程</span>
          </label>
          <div className="hint">用开源剪辑软件 Shotcut 打开，在时间线上精修：片段、配音位置与成片一致，附字幕 SRT。会额外占用一份片段大小的空间。</div>
        </>
      )
    case 'vlm':
      return <label className="field"><span>指令（留空用默认描述指令）</span><textarea value={String(p.instruction ?? '')} onChange={(e) => set('instruction', e.target.value)} /></label>
    case 'llm':
      return <label className="field"><span>系统提示（可选）</span><textarea value={String(p.system ?? '')} placeholder="例如：你是一位擅长短视频的电影编剧…" onChange={(e) => set('system', e.target.value)} /></label>
    default:
      return null
  }
}

function Downloads({ vals, name }: { vals: PortValue[]; name: string }) {
  const media = vals.filter((v): v is Extract<PortValue, { type: 'image' | 'video' | 'audio' }> => v.type === 'image' || v.type === 'video' || v.type === 'audio')
  if (!media.length) return null
  return (
    <div className="insp-actions">
      {media.map((m, i) => (
        <a key={m.assetId + i} className="btn sm" href={assetUrl(m.assetId)} download={`${name}${media.length > 1 ? `-${i + 1}` : ''}.${m.mime.split('/')[1]?.replace('mpeg', 'mp3') ?? 'bin'}`} data-testid="download-output"><Download />下载{media.length > 1 ? ` ${i + 1}` : ''}</a>
      ))}
    </div>
  )
}

function downloadText(text: string, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString() : '—')

export function Inspector({ onClose }: { onClose: () => void }) {
  // shallow-compared id list: a fresh array per read would loop forever under zustand v5
  const selectedIds = useStore(useShallow((s) => s.nodes.filter((n) => n.selected).map((n) => n.id)))
  const node = useStore((s) => (selectedIds.length === 1 ? s.nodes.find((n) => n.id === selectedIds[0]) : undefined))
  const selected = selectedIds
  const runState = useStore((s) => (node ? s.runStates[node.id] : undefined))
  const running = useStore((s) => s.runId !== null)
  const runNodes = useStore((s) => s.runNodes)
  const setNodeData = useStore((s) => s.setNodeData)
  const expandStoryboard = useStore((s) => s.expandStoryboard)
  const profiles = useStore((s) => s.profiles)
  const nodeCount = useStore((s) => s.nodes.length)
  const { fitView } = useReactFlow()

  if (!node) {
    return (
      <aside className="inspector" aria-label="属性面板">
        <div className="insp-head"><div className="ttl"><strong>属性</strong></div><button className="btn ghost sm icon" onClick={onClose} aria-label="收起属性面板"><PanelRightClose /></button></div>
        <div className="insp-empty">
          <div>
            <MousePointerClick aria-hidden="true" />
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{selected.length > 1 ? `已选中 ${selected.length} 个节点` : '选择一个节点'}</div>
            <div>{selected.length > 1 ? '一次只能编辑一个节点的属性。' : `点选画布上的节点，在这里调整模型、参数并查看结果。画布上共有 ${nodeCount} 个节点。`}</div>
            <div className="hint" style={{ justifyContent: 'center', marginTop: 14 }}><kbd>/</kbd> 快速添加 · <kbd>Delete</kbd> 删除</div>
          </div>
        </div>
      </aside>
    )
  }

  const def = NODE_TYPE_MAP[node.type ?? '']!
  const Icon = NODE_ICON[def.type]!
  const status = runState?.status ?? 'idle'
  const shown = def.category === 'input' ? undefined : node.type === 'preview' ? runState?.outputs?.in : runState?.outputs?.out
  const profile = node.data.profileId ? profiles.find((p) => p.id === node.data.profileId) : undefined
  const hasStoryboard = (node.type === 'director' || node.type === 'video-reverse') && !!shown?.some((v) => v.type === 'storyboard')
  // the Export node also delivers subtitles and (optionally) an editor project
  const srt = node.type === 'export' ? runState?.outputs?.srt?.find((v) => v.type === 'text') : undefined
  const pkg = node.type === 'export' ? runState?.outputs?.project?.find((v) => v.type === 'file') : undefined
  const baseName = node.data.label ?? def.label

  return (
    <aside className="inspector" aria-label="属性面板" data-testid="inspector">
      <div className="insp-head">
        <span className="chip-ico" style={{ '--c': CATEGORY_COLOR[def.category] } as React.CSSProperties} aria-hidden="true"><Icon /></span>
        <div className="ttl">
          <input value={node.data.label ?? def.label} onChange={(e) => setNodeData(node.id, { label: e.target.value })} aria-label="节点名称" />
          <div className="kind">{def.label} · {def.description}</div>
        </div>
        <button className="btn ghost sm icon" onClick={onClose} aria-label="收起属性面板"><PanelRightClose /></button>
      </div>
      <div className="insp-body">
        {def.modelKind && (
          <section className="insp-sec">
            <h3>模型</h3>
            <label className="field"><span>{KIND_LABEL[def.modelKind]}档案</span>
              <select value={node.data.profileId ?? ''} aria-label="属性面板模型档案" onChange={(e) => {
                const p = profiles.find((x) => x.id === e.target.value)
                setNodeData(node.id, { profileId: e.target.value || undefined, label: node.data.label === def.label || profiles.some((q) => q.name === node.data.label) ? p?.name ?? def.label : node.data.label })
              }}>
                <option value="">未选择</option>
                {profiles.filter((p) => p.kind === def.modelKind).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}
              </select>
            </label>
            {profile && <dl className="meta-list"><dt>适配器</dt><dd>{profile.adapter}</dd><dt>模型</dt><dd>{profile.model}</dd>{profile.cost && <><dt>单价</dt><dd>{profile.cost.amount} {profile.cost.currency}/次</dd></>}</dl>}
            <button className="btn sm" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => useStore.getState().openCompareSetup(node.id)} data-testid="insp-compare"><GitCompareArrows />{node.data.compare ? '再加一个模型对比…' : '多模型对比…'}</button>
          </section>
        )}

        {HAS_PARAMS.has(def.type) && (
          <section className="insp-sec"><h3>参数</h3><Params node={node} /></section>
        )}

        {RUNNABLE.has(def.type) && (
          <section className="insp-sec">
            <h3>运行</h3>
            <div className="insp-actions">
              <button className="btn primary sm" disabled={running} onClick={() => void runNodes([node.id])} data-testid="insp-run"><Play />运行</button>
              {(status === 'done' || status === 'cached') && node.type !== 'preview' && (
                <button className="btn sm" disabled={running} onClick={() => void runNodes([node.id], true)} title="忽略缓存，重新调用模型"><RefreshCw />重新生成</button>
              )}
            </div>
            {hasStoryboard && (
              <button className="btn sm block" disabled={running} onClick={() => {
                const ids = expandStoryboard(node.id)
                if (ids.length) requestAnimationFrame(() => requestAnimationFrame(() => void fitView({ nodes: [{ id: node.id }, ...ids.map((x) => ({ id: x }))], padding: 0.15, maxZoom: 1, duration: 450 })))
              }}><LayoutGrid />展开到画布</button>
            )}
            {status !== 'idle' && (
              <dl className="meta-list">
                <dt>状态</dt><dd><StatusPill status={status} error={runState?.error} /></dd>
                {runState?.startedAt && <><dt>开始</dt><dd>{fmtTime(runState.startedAt)}</dd></>}
                {runState?.finishedAt && <><dt>完成</dt><dd>{fmtTime(runState.finishedAt)}</dd></>}
              </dl>
            )}
            {runState?.progress && status === 'running' && <div className="progress">{runState.progress}</div>}
            {runState?.error && <ErrorBox nodeId={node.id} error={runState.error} kind={def.modelKind} />}
          </section>
        )}

        {!RUNNABLE.has(def.type) && runState?.error && (
          <section className="insp-sec"><h3>上次运行</h3><ErrorBox nodeId={node.id} error={runState.error} kind={def.modelKind} /></section>
        )}

        {shown && shown.length > 0 && (
          <section className="insp-sec">
            <h3>结果</h3>
            <Values vals={shown} />
            <Downloads vals={shown} name={baseName} />
            {node.type === 'image-reverse' && !!runState?.outputs?.negative?.length && (
              <><h3 style={{ marginTop: 12 }}>负面词</h3><Values vals={runState.outputs.negative} /></>
            )}
            {node.type === 'image-reverse' && (() => {
              // the whole answer (e.g. both languages) when only part of it went to the prompt port
              const full = runState?.outputs?.full?.find((v) => v.type === 'text')
              const out = shown.find((v) => v.type === 'text')
              return full && out && full.text.trim() !== out.text.trim()
                ? <details className="full-answer" data-testid="reverse-full"><summary>完整回答（含另一种语言和负面词）</summary><Values vals={[full]} /></details>
                : null
            })()}
            <VersionStrip nodeId={node.id} />
          </section>
        )}

        {(srt || pkg) && (
          <section className="insp-sec">
            <h3>交付文件</h3>
            {pkg?.type === 'file' && <FileCard v={pkg} hint="剪辑工程 · 用 Shotcut 打开 project.mlt" />}
            {srt?.type === 'text' && (
              <div className="insp-actions"><button className="btn sm" onClick={() => downloadText(srt.text, `${baseName}.srt`)} data-testid="download-srt"><Subtitles />下载字幕 SRT</button></div>
            )}
          </section>
        )}

        {def.category === 'input' && node.data.assetId && node.data.mime && (
          <section className="insp-sec">
            <h3>素材</h3>
            <dl className="meta-list"><dt>文件</dt><dd>{node.data.label}</dd><dt>类型</dt><dd>{node.data.mime}</dd></dl>
            <Downloads vals={[{ type: node.type as 'image', assetId: node.data.assetId, mime: node.data.mime }]} name={node.data.label ?? def.label} />
          </section>
        )}
      </div>
    </aside>
  )
}
