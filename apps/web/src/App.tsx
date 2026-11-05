import { useCallback, useEffect, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { HzcNode } from './CanvasNode'
import { Sidebar, DND_MIME } from './Sidebar'
import { Settings } from './Settings'
import { useStore } from './store'

const nodeTypes = Object.fromEntries(
  ['text', 'image', 'video', 'audio', 'llm', 'vlm', 'image-gen', 'video-gen', 'tts', 'image-reverse', 'video-reverse', 'director', 'preview', 'export'].map((t) => [t, HzcNode]),
)

const SAVE_LABEL = { idle: '', dirty: '未保存…', saving: '保存中…', saved: '已保存', error: '保存失败' } as const

function Canvas() {
  const s = useStore()
  const { screenToFlowPosition } = useReactFlow()
  // The canvas is remounted per project (see CanvasForProject). Fit the view on open only if the
  // project already has nodes — otherwise React Flow would zoom onto the first node the user drops.
  const [fitOnOpen] = useState(() => useStore.getState().nodes.length > 0)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const raw = e.dataTransfer.getData(DND_MIME)
    if (!raw) return
    const { type, profileId } = JSON.parse(raw) as { type: string; profileId?: string }
    s.addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }), profileId)
  }, [s, screenToFlowPosition])

  return (
    <div className="canvas" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}>
      <ReactFlow
        nodes={s.nodes} edges={s.edges} nodeTypes={nodeTypes}
        onNodesChange={s.onNodesChange} onEdgesChange={s.onEdgesChange}
        onConnect={s.onConnect} isValidConnection={s.isValidConnection}
        fitView={fitOnOpen} fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        deleteKeyCode={['Backspace', 'Delete']} minZoom={0.1} maxZoom={2} colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      {s.nodes.length === 0 && <div className="canvas-empty">把左侧的模型图标或节点拖到这里开始创作</div>}
    </div>
  )
}

/** Fresh React Flow instance (and viewport) per opened project. */
function CanvasForProject() {
  const projectId = useStore((s) => s.projectId)
  return <ReactFlowProvider key={projectId ?? 'none'}><Canvas /></ReactFlowProvider>
}

export function App() {
  const s = useStore()

  useEffect(() => { void s.init().catch((e) => s.showToast(`连接服务失败：${(e as Error).message}`)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // debounced autosave
  useEffect(() => {
    if (s.saveState !== 'dirty') return
    const t = setTimeout(() => void s.save(), 800)
    return () => clearTimeout(t)
  }, [s.saveState, s.nodes, s.edges, s.projectName]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">海珠无限画布 <em>v1.0.0-beta.2</em></strong>
        <select value={s.projectId ?? ''} onChange={(e) => void s.openProject(e.target.value)} aria-label="切换画布">
          {s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="pname" value={s.projectName} onChange={(e) => s.renameProject(e.target.value)} aria-label="画布名称" />
        <button onClick={() => void s.newProject()}>＋ 新建画布</button>
        <span className={`save ${s.saveState}`} data-testid="save-state">{SAVE_LABEL[s.saveState]}</span>
        <span className="spacer" />
        {s.runId
          ? <button className="danger" onClick={() => void s.cancelRun()} data-testid="stop-run">■ 停止</button>
          : <button className="primary" onClick={() => void s.runNodes()} disabled={s.nodes.length === 0} data-testid="run-all">▶ 运行全部</button>}
        <button onClick={() => s.setSettingsOpen(true)} data-testid="open-settings">⚙ 设置</button>
      </header>
      <div className="main">
        <Sidebar />
        <CanvasForProject />
      </div>
      {s.settingsOpen && <Settings />}
      {s.toast && <div className="toast">{s.toast}</div>}
    </div>
  )
}

export default function Root() {
  return <App />
}
