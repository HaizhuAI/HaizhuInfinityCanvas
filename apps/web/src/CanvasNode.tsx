import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NODE_TYPE_MAP, type PortType } from '@hzc/core'
import { useStore, type CanvasNode } from './store'

export const PORT_COLOR: Record<PortType, string> = {
  text: '#60a5fa', image: '#f472b6', video: '#fb923c', audio: '#34d399', storyboard: '#c084fc', any: '#9ca3af',
}

export function HzcNode({ id, type, data, selected }: NodeProps<CanvasNode>) {
  const def = NODE_TYPE_MAP[type ?? '']
  const profiles = useStore((s) => s.profiles)
  const setNodeData = useStore((s) => s.setNodeData)
  if (!def) return <div className="node node-unknown">未知节点：{type}</div>
  const profile = data.profileId ? profiles.find((p) => p.id === data.profileId) : undefined
  const missingProfile = !!data.profileId && !profile

  return (
    <div className={`node cat-${def.category}${selected ? ' selected' : ''}`} data-testid={`node-${def.type}`}>
      <div className="node-head">
        <span className="node-title">{data.label ?? def.label}</span>
        <span className="node-type">{def.label}</span>
      </div>

      {def.modelKind && (
        <div className="node-body">
          <select
            className="nodrag"
            value={data.profileId ?? ''}
            onChange={(e) => {
              const p = profiles.find((x) => x.id === e.target.value)
              setNodeData(id, { profileId: e.target.value || undefined, label: p?.name ?? def.label })
            }}
          >
            <option value="">选择模型档案…</option>
            {profiles.filter((p) => p.kind === def.modelKind).map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {p.model}</option>
            ))}
          </select>
          {missingProfile && <div className="warn">绑定的模型档案已被删除</div>}
          {!profile && !missingProfile && <div className="hint">尚未绑定模型（在「设置 → 模型档案」添加）</div>}
        </div>
      )}

      {def.type === 'text' && (
        <div className="node-body">
          <textarea
            className="nodrag nowheel"
            placeholder="在这里写剧本、创意或提示词…"
            value={data.text ?? ''}
            onChange={(e) => setNodeData(id, { text: e.target.value })}
          />
        </div>
      )}

      <div className="ports">
        <div className="ports-col">
          {def.inputs.map((p) => (
            <div className="port in" key={p.id}>
              <Handle type="target" position={Position.Left} id={p.id} style={{ background: PORT_COLOR[p.type] }} />
              <span>{p.label}</span>
            </div>
          ))}
        </div>
        <div className="ports-col right">
          {def.outputs.map((p) => (
            <div className="port out" key={p.id}>
              <span>{p.label}</span>
              <Handle type="source" position={Position.Right} id={p.id} style={{ background: PORT_COLOR[p.type] }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
