import { memo, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { BookmarkPlus, Play, Ungroup } from 'lucide-react'
import { groupMembers } from '@hzc/core'
import { RUNNABLE } from './CanvasNode'
import { frameSize, useStore, type CanvasNode } from './store'

/**
 * A group frame (rc.17): a named rectangle behind its nodes. Drag it by the title bar (the nodes inside
 * move with it), resize it from its edges, run everything in it, keep it as a template, or remove the
 * frame (the nodes stay). Clicks on its body go through to the canvas.
 */
export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const setNodeData = useStore((s) => s.setNodeData)
  // the members as a stable string: moving other nodes doesn't re-render the frame unless membership changes
  const members = useStore((s) => {
    const f = s.nodes.find((n) => n.id === id)
    return f ? groupMembers({ position: f.position, size: frameSize(f) }, s.nodes).map((n) => n.id).join(',') : ''
  })
  const busy = useStore((s) => s.runId !== null)
  const [editing, setEditing] = useState(false)
  const ids = members ? members.split(',') : []
  const runnable = useStore((s) => ids.filter((m) => RUNNABLE.has(s.nodes.find((n) => n.id === m)?.type ?? '')).length)

  return (
    <div className={`grp${selected ? ' on' : ''}`} data-testid="group">
      <NodeResizer isVisible={selected} minWidth={240} minHeight={140} lineClassName="grp-line" handleClassName="grp-handle"
        onResizeEnd={(_e, p) => setNodeData(id, { size: { w: Math.round(p.width), h: Math.round(p.height) } })} />
      <div className="grp-head" onDoubleClick={() => setEditing(true)}>
        {editing
          ? <input className="nodrag" autoFocus defaultValue={data.label ?? ''} maxLength={40} aria-label="分组名称" data-testid="group-name"
              onBlur={(e) => { setNodeData(id, { label: e.target.value.trim() || '分组' }); setEditing(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }} />
          : <span className="grp-name" title="双击改名">{data.label ?? '分组'}</span>}
        <span className="grp-count">{ids.length} 个节点</span>
        <span className="grp-spacer" />
        <button type="button" className="btn xs ghost nodrag" disabled={busy || !runnable} title="运行组内的节点（以及它们需要的上游）"
          onClick={() => void useStore.getState().runNodes(ids.filter((m) => RUNNABLE.has(useStore.getState().nodes.find((n) => n.id === m)?.type ?? '')))} data-testid="group-run"><Play />运行</button>
        <button type="button" className="btn xs ghost nodrag" disabled={!ids.length} title="存为「我的模板」，以后从 / 面板插入"
          onClick={() => { const t = useStore.getState().saveGroupTemplate(id); useStore.getState().showToast(t ? `已存为模板「${t.name}」：按 / 搜索即可插入` : '保存模板失败（浏览器存储已满？）') }} data-testid="group-save"><BookmarkPlus />存为模板</button>
        <button type="button" className="btn xs icon ghost nodrag" title="解散分组（节点保留）" aria-label="解散分组"
          onClick={() => useStore.getState().ungroup([id])} data-testid="group-ungroup"><Ungroup /></button>
      </div>
    </div>
  )
})
