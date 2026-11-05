import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { ProjectGraph } from '@hzc/core'
import { useStore, type CanvasNodeData } from './store'

export type AddPayload = { type: string; profileId?: string }

const W = 300, H = 240, GAP = 24

/**
 * Adds a node near a flow-space point (or the centre of the visible canvas), choosing the nearest
 * free slot inside the view so nothing is dropped on top of an existing node.
 */
export function useAddNode() {
  const { screenToFlowPosition, getNodes, fitView } = useReactFlow()
  const addNode = useStore((s) => s.addNode)
  const loadTemplate = useStore((s) => s.loadTemplate)

  const freeSpot = useCallback((target?: { x: number; y: number }) => {
    const el = document.querySelector('.canvas')?.getBoundingClientRect()
    if (!el) return target ?? { x: 0, y: 0 }
    const center = target ?? screenToFlowPosition({ x: el.left + el.width / 2 - W / 2, y: el.top + el.height / 2 - H / 2 })
    const tl = screenToFlowPosition({ x: el.left, y: el.top })
    const br = screenToFlowPosition({ x: el.right, y: el.bottom })
    const boxes = getNodes().map((n) => ({ x: n.position.x, y: n.position.y, w: n.measured?.width ?? W, h: n.measured?.height ?? H }))
    const free = (x: number, y: number) => !boxes.some((b) => x < b.x + b.w + GAP && x + W + GAP > b.x && y < b.y + b.h + GAP && y + H + GAP > b.y)
    if (free(center.x, center.y)) return center
    const slots: { x: number; y: number; d: number }[] = []
    for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) {
      const x = center.x + i * (W / 2 + GAP), y = center.y + j * (H / 2 + GAP)
      if (x >= tl.x && y >= tl.y && x + W <= br.x && y + H <= br.y) slots.push({ x, y, d: Math.hypot(i * 1.2, j) })
    }
    slots.sort((a, b) => a.d - b.d)
    let p = slots.find((c) => free(c.x, c.y)) ?? { ...center }
    for (let k = 0; k < 40 && !free(p.x, p.y); k++) p = { x: p.x + 48, y: p.y + 36 }
    return p
  }, [screenToFlowPosition, getNodes])

  const addAt = useCallback((p: AddPayload, target?: { x: number; y: number }, data?: Partial<CanvasNodeData>) =>
    addNode(p.type, freeSpot(target), p.profileId, data), [addNode, freeSpot])

  const addTemplate = useCallback((g: ProjectGraph) => {
    loadTemplate(g)
    // let React Flow measure the new nodes before fitting
    requestAnimationFrame(() => requestAnimationFrame(() => void fitView({ maxZoom: 1, padding: 0.25, duration: 400 })))
  }, [loadTemplate, fitView])

  return { addAt, addTemplate }
}
