import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, LayoutGrid, Pencil, Plus, Search, Trash, X } from 'lucide-react'
import { api, assetUrl, bundleUrl, type ProjectSummary } from './api'
import { enterOverlay } from './motion'
import { useEscape } from './Overlays'
import { useStore } from './store'

/** "我的画布": every canvas as a card — open, rename, duplicate, export, delete. */
function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`
  return new Date(iso).toLocaleDateString()
}

function Card({ p, current, onOpen }: { p: ProjectSummary; current: boolean; onOpen: () => void }) {
  const { showToast, deleteProject, openProject } = useStore.getState()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(p.name)
  const [confirm, setConfirm] = useState(false)
  const refresh = async () => useStore.setState({ projects: await api.listProjects() })
  const rename = async () => {
    setRenaming(false)
    const n = name.trim()
    if (!n || n === p.name) { setName(p.name); return }
    await api.saveProject(p.id, { name: n })
    if (current) useStore.setState({ projectName: n })
    await refresh()
  }
  return (
    <div className={`pcard2${current ? ' current' : ''}`} data-testid="project-card">
      <button className="cover" onClick={onOpen} aria-label={`打开「${p.name}」`}>
        {p.cover ? (p.cover.mime.startsWith('video/') ? <video src={assetUrl(p.cover.assetId)} preload="metadata" muted /> : <img src={assetUrl(p.cover.assetId)} alt="" loading="lazy" />)
          : <LayoutGrid aria-hidden="true" />}
        {current && <span className="badge">当前</span>}
      </button>
      <div className="meta">
        {renaming
          ? <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') { e.stopPropagation(); setName(p.name); setRenaming(false) } }} aria-label="画布名称" data-testid="project-rename-input" />
          : <div className="nm" title={p.name}>{p.name}</div>}
        <div className="ds">{p.nodeCount ?? 0} 个节点 · {ago(p.updatedAt)}</div>
      </div>
      {confirm ? (
        <div className="actions danger">
          <span>删除后无法恢复</span>
          <button className="btn xs" onClick={() => setConfirm(false)}>取消</button>
          <button className="btn xs danger" onClick={() => void deleteProject(p.id).then(() => showToast(`已删除「${p.name}」`), (e: unknown) => { setConfirm(false); showToast(e instanceof Error ? e.message.replace(/^\d{3} /, '') : '删除失败', { tone: 'error' }) })} data-testid="project-delete-confirm">删除</button>
        </div>
      ) : (
        <div className="actions">
          <button className="btn xs ghost icon" onClick={() => setRenaming(true)} aria-label="重命名" title="重命名" data-testid="project-rename"><Pencil /></button>
          <button className="btn xs ghost icon" aria-label="创建副本" title="创建副本（含结果）" data-testid="project-duplicate"
            onClick={() => void api.duplicateProject(p.id).then(async (c) => { await refresh(); showToast(`已创建「${c.name}」`, { action: { label: '打开', run: () => { useStore.getState().setProjectsOpen(false); void openProject(c.id) } } }) })}><Copy /></button>
          <a className="btn xs ghost icon" href={bundleUrl(p.id)} download={`${p.name}.hzc`} aria-label="导出项目包" title="导出项目包（.hzc）"><Download /></a>
          <button className="btn xs ghost icon" onClick={() => setConfirm(true)} aria-label="删除" title="删除" data-testid="project-delete"><Trash /></button>
        </div>
      )}
    </div>
  )
}

export function Projects() {
  const open = useStore((s) => s.projectsOpen)
  const projects = useStore((s) => s.projects)
  const currentId = useStore((s) => s.projectId)
  const { setProjectsOpen, openProject, newProject, save } = useStore.getState()
  const [q, setQ] = useState('')
  const backRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => setProjectsOpen(false)
  useEscape(close, open)
  useEffect(() => {
    if (!open) return
    setQ('')
    enterOverlay(panelRef.current, backRef.current)
    // save first so the current canvas shows its latest name and node count
    void save().then(async () => useStore.setState({ projects: await api.listProjects() }))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => projects.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())), [projects, q])
  if (!open) return null
  return (
    <div className="modal-back" ref={backRef} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <div className="modal projects" ref={panelRef} role="dialog" aria-label="我的画布" data-testid="projects">
        <div className="modal-head">
          <h2>我的画布</h2>
          <label className="search"><Search aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索画布" aria-label="搜索画布" data-testid="projects-search" /></label>
          <button className="btn primary sm" onClick={() => { close(); void newProject() }} data-testid="projects-new"><Plus />新建画布</button>
          <button className="btn icon ghost" onClick={close} aria-label="关闭"><X /></button>
        </div>
        <div className="pgrid">
          {shown.map((p) => <Card key={p.id} p={p} current={p.id === currentId} onOpen={() => { close(); if (p.id !== currentId) void openProject(p.id) }} />)}
          {!shown.length && <div className="sb-empty">没有找到「{q}」</div>}
        </div>
      </div>
    </div>
  )
}
