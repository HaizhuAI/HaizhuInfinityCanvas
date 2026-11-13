import type { GraphEdge, GraphNode, ProjectGraph } from '@hzc/core'
import { uid } from './store'

/**
 * 我的模板: a group saved for reuse (rc.17) — its nodes, their settings and the wires between them,
 * without results. Kept in this browser; inserting one gives every node a new id.
 */
export interface MyTemplate { id: string; name: string; createdAt: string; flow: string[]; graph: ProjectGraph }

const KEY = 'hzc.myTemplates'
const MAX = 60

export function listMyTemplates(): MyTemplate[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as MyTemplate[]
    return Array.isArray(v) ? v.filter((t) => t && typeof t.id === 'string' && t.graph && Array.isArray(t.graph.nodes)) : []
  } catch { return [] }
}

function write(list: MyTemplate[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); return true } catch { return false }
}

/** save nodes + their inner wires; positions are kept relative to the top-left one */
export function saveMyTemplate(name: string, nodes: GraphNode[], edges: GraphEdge[]): MyTemplate | null {
  if (!nodes.length) return null
  const ids = new Set(nodes.map((n) => n.id))
  const x0 = Math.min(...nodes.map((n) => n.position.x)), y0 = Math.min(...nodes.map((n) => n.position.y))
  const graph: ProjectGraph = {
    version: 1,
    nodes: nodes.map((n) => {
      const { compare: _c, ...data } = n.data as GraphNode['data'] & { compare?: string }
      return { id: n.id, type: n.type, position: { x: n.position.x - x0, y: n.position.y - y0 }, data }
    }),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  }
  const t: MyTemplate = { id: `my_${uid()}`, name: name.trim().slice(0, 40) || '我的模板', createdAt: new Date().toISOString(), flow: nodes.filter((n) => n.type !== 'group').slice(0, 5).map((n) => n.type), graph }
  return write([t, ...listMyTemplates()]) ? t : null
}

export function deleteMyTemplate(id: string) { write(listMyTemplates().filter((t) => t.id !== id)) }

/** a copy with new ids, its top-left at `at` */
export function instantiate(g: ProjectGraph, at: { x: number; y: number }): ProjectGraph {
  const map = new Map(g.nodes.map((n) => [n.id, `${n.type === 'group' ? 'g' : 'n'}_${uid()}`]))
  return {
    version: 1,
    nodes: g.nodes.map((n) => ({ ...n, id: map.get(n.id)!, position: { x: n.position.x + at.x, y: n.position.y + at.y }, data: { ...n.data } })),
    edges: g.edges.filter((e) => map.has(e.source) && map.has(e.target)).map((e) => ({ ...e, id: `e_${uid()}`, source: map.get(e.source)!, target: map.get(e.target)! })),
  }
}

/** open a file picker for a shuohao-skills project (outline / cast / art / script / storyboard JSON) and import it */
export function pickDramaFiles(onFiles: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.multiple = true
  input.hidden = true
  input.dataset.testid = 'drama-files'
  // some browsers only open the picker for an input that is in the page
  document.body.appendChild(input)
  const done = () => { input.remove(); window.removeEventListener('focus', later) }
  const later = () => setTimeout(() => { if (!input.files?.length) done() }, 1000)
  input.onchange = () => { const files = Array.from(input.files ?? []); done(); if (files.length) onFiles(files) }
  input.oncancel = done
  window.addEventListener('focus', later)
  input.click()
}
