import { CATEGORY_LABEL, NODE_TYPES, type NodeCategory } from '@hzc/core'
import { useStore } from './store'

export const DND_MIME = 'application/x-hzc-node'

function startDrag(e: React.DragEvent, payload: { type: string; profileId?: string }) {
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'move'
}

const KIND_ICON: Record<string, string> = { llm: '💬', vlm: '👁', image: '🖼', video: '🎬', tts: '🔊' }
const KIND_TO_NODE: Record<string, string> = { llm: 'llm', vlm: 'vlm', image: 'image-gen', video: 'video-gen', tts: 'tts' }

export function Sidebar() {
  const profiles = useStore((s) => s.profiles)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const cats: NodeCategory[] = ['input', 'model', 'tool', 'output']

  return (
    <aside className="sidebar">
      <section>
        <h3>我的模型智能体</h3>
        {profiles.length === 0 && (
          <div className="empty">还没有模型。<button className="link" onClick={() => setSettingsOpen(true)}>去添加模型档案</button></div>
        )}
        <div className="grid">
          {profiles.map((p) => (
            <div
              key={p.id} className="chip profile" draggable data-testid={`profile-${p.name}`}
              title={`${p.kind} · ${p.model}`}
              onDragStart={(e) => startDrag(e, { type: KIND_TO_NODE[p.kind] ?? 'llm', profileId: p.id })}
            >
              <span className="ico">{KIND_ICON[p.kind]}</span>
              <span className="nm">{p.name}</span>
            </div>
          ))}
        </div>
      </section>

      {cats.map((c) => (
        <section key={c}>
          <h3>{CATEGORY_LABEL[c]}</h3>
          <div className="grid">
            {NODE_TYPES.filter((n) => n.category === c).map((n) => (
              <div key={n.type} className="chip" draggable title={n.description} data-testid={`palette-${n.type}`}
                onDragStart={(e) => startDrag(e, { type: n.type })}>
                <span className="nm">{n.label}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </aside>
  )
}
