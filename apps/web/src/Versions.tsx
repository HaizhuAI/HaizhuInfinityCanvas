import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Clapperboard, FileArchive, Music } from 'lucide-react'
import type { NodeOutputs, NodeVersion } from '@hzc/core'
import { assetUrl } from './api'
import { useStore } from './store'

/**
 * Result versions: every generation of a node is kept (the server keeps the newest 30). The node
 * shows "‹ 2 / 5 ›" to flip through them; the Inspector shows them all. Switching makes that
 * generation the node's current result — what downstream nodes receive on their next run.
 */
const same = (a?: NodeOutputs, b?: NodeOutputs) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

/** versions oldest → newest, and the index of the one currently in use (-1 if unknown) */
function useVersions(nodeId: string) {
  const count = useStore((s) => s.runStates[nodeId]?.versions ?? 0)
  const outputs = useStore((s) => s.runStates[nodeId]?.outputs)
  const list = useStore((s) => s.versionLists[nodeId])
  const loadVersions = useStore((s) => s.loadVersions)
  useEffect(() => { if (count >= 2 && !list) void loadVersions(nodeId).catch(() => undefined) }, [count, list, nodeId, loadVersions])
  const asc = list ? [...list].reverse() : undefined
  const cur = asc ? asc.findIndex((v) => same(v.outputs, outputs)) : -1
  return { count, asc, cur }
}

export function VersionSwitch({ nodeId }: { nodeId: string }) {
  const { count, asc, cur } = useVersions(nodeId)
  const running = useStore((s) => s.runId !== null)
  const useVersion = useStore((s) => s.useVersion)
  if (count < 2) return null
  const go = (d: -1 | 1) => { const t = asc?.[cur + d]; if (t) void useVersion(nodeId, t.seq) }
  return (
    <div className="vswitch nodrag" role="group" aria-label="结果版本" data-testid="version-switch">
      <button onClick={() => go(-1)} disabled={running || !asc || cur <= 0} aria-label="上一版" title="上一版"><ChevronLeft /></button>
      <span data-testid="version-label">{cur >= 0 ? `${cur + 1} / ${count}` : `${count} 版`}</span>
      <button onClick={() => go(1)} disabled={running || !asc || cur < 0 || cur >= count - 1} aria-label="下一版" title="下一版"><ChevronRight /></button>
    </div>
  )
}

function Thumb({ v }: { v: NodeVersion }) {
  const all = Object.values(v.outputs).flat()
  const media = all.find((x) => x.type === 'image' || x.type === 'video' || x.type === 'audio' || x.type === 'file')
  if (media && 'assetId' in media) {
    if (media.type === 'image') return <img src={assetUrl(media.assetId)} alt="" loading="lazy" decoding="async" />
    if (media.type === 'video') return <video src={assetUrl(media.assetId)} preload="metadata" muted />
    return media.type === 'audio' ? <Music aria-hidden="true" /> : <FileArchive aria-hidden="true" />
  }
  const sb = all.find((x) => x.type === 'storyboard')
  if (sb && sb.type === 'storyboard') return <span className="vtext"><Clapperboard aria-hidden="true" />{sb.title ?? '分镜'} · {sb.shots.length} 镜</span>
  const t = all.find((x) => x.type === 'text')
  return <span className="vtext">{t && t.type === 'text' ? t.text.slice(0, 60) : '—'}</span>
}

export function VersionStrip({ nodeId }: { nodeId: string }) {
  const { count, asc, cur } = useVersions(nodeId)
  const running = useStore((s) => s.runId !== null)
  const useVersion = useStore((s) => s.useVersion)
  const showToast = useStore((s) => s.showToast)
  if (count < 2 || !asc) return null
  const newestFirst = asc.map((v, i) => ({ v, n: i + 1 })).reverse()
  return (
    <div className="vstrip" data-testid="version-strip">
      <div className="vstrip-head"><span>全部版本</span><span className="muted">{count} 版 · 点击切换，下游节点下次运行时使用它</span></div>
      <div className="vstrip-list">
        {newestFirst.map(({ v, n }) => {
          const on = n - 1 === cur
          return (
            <button key={v.seq} className={`vcell${on ? ' on' : ''}`} disabled={running || on} aria-pressed={on} data-testid="version-cell"
              title={`第 ${n} 版 · ${new Date(v.finishedAt).toLocaleString()}`}
              onClick={() => { void useVersion(nodeId, v.seq).then(() => showToast(`已切换到第 ${n} 版，下游节点下次运行时会使用它`)) }}>
              <span className="vthumb"><Thumb v={v} /></span>
              <span className="vno">{on ? '当前' : `第 ${n} 版`}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
