import { readFileSync } from 'node:fs'
import type { ProjectGraph } from '@hzc/core'
import { MIME_EXT, type AssetStore } from './assets'
import type { Store } from './db'
import { readZip, type ZipInput } from './zip'

/**
 * Portable project bundle (.hzc): a ZIP holding `project.json` (graph, results with their cache
 * keys, asset list) and `assets/<id>.<ext>` for every file the graph or its results reference.
 * Asset ids are kept on import, so cached results stay valid when a project returns to the machine
 * it came from, and media shows up anywhere else.
 */

export const BUNDLE_FORMAT = 'haizhu-project'
export class BundleError extends Error {}

const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

export function isGraph(g: unknown): g is ProjectGraph {
  return typeof g === 'object' && g !== null && (g as ProjectGraph).version === 1 && Array.isArray((g as ProjectGraph).nodes) && Array.isArray((g as ProjectGraph).edges)
}

interface BundleAsset { id: string; mime: string; name: string; size: number; sha256: string; path: string }
interface BundleOutput { nodeId: string; cacheKey: string; outputs: unknown; finishedAt: string }
interface Manifest {
  format: typeof BUNDLE_FORMAT
  version: 1
  app: string
  name: string
  exportedAt: string
  graph: ProjectGraph
  outputs: BundleOutput[]
  assets: BundleAsset[]
}

export function planBundle(store: Store, assets: AssetStore, projectId: string, appVersion: string) {
  const p = store.getProject(projectId)
  if (!p) return undefined
  const nodeIds = new Set(p.graph.nodes.map((n) => n.id))
  const outputs = store.listNodeOutputsForBundle(projectId).filter((o) => nodeIds.has(o.nodeId))
  const ids = new Set(JSON.stringify([p.graph, outputs.map((o) => o.outputs)]).match(UUID_G) ?? [])
  const files = [...ids].map((id) => assets.get(id)).filter((a): a is NonNullable<typeof a> => !!a)
  const manifest: Manifest = {
    format: BUNDLE_FORMAT, version: 1, app: appVersion, name: p.name, exportedAt: new Date().toISOString(),
    graph: p.graph, outputs,
    assets: files.map((a) => ({ id: a.id, mime: a.mime, name: a.name, size: a.size, sha256: a.sha256, path: `assets/${a.id}.${MIME_EXT[a.mime]}` })),
  }
  return {
    name: p.name,
    size: files.reduce((s, a) => s + a.size, 0),
    assetCount: files.length,
    *entries(): Generator<ZipInput> {
      yield { name: 'project.json', data: Buffer.from(JSON.stringify(manifest, null, 1)) }
      for (let i = 0; i < files.length; i++) yield { name: manifest.assets[i]!.path, data: () => readFileSync(files[i]!.file) }
    },
  }
}

/** Creates a new project from a bundle. Unsupported or missing files are counted, not fatal. */
export function importBundle(store: Store, assets: AssetStore, buf: Buffer) {
  // our bundles store files uncompressed; a crafted zip must not expand far beyond its own size
  const maxTotal = Math.min(4 * 1024 ** 3, buf.length * 2 + 256 * 1024 * 1024)
  const files = new Map(readZip(buf, { maxEntries: 20_000, maxTotal }).map((e) => [e.name, e.data]))
  const raw = files.get('project.json')
  if (!raw) throw new BundleError('不是 Haizhu 项目包（缺少 project.json）')
  let m: Partial<Manifest>
  try { m = JSON.parse(raw.toString('utf8')) as Partial<Manifest> } catch { throw new BundleError('项目包里的 project.json 已损坏') }
  if (m.format !== BUNDLE_FORMAT || m.version !== 1 || !isGraph(m.graph)) throw new BundleError('项目包格式不受支持（可能来自更新的版本）')

  const remap = new Map<string, string>()
  let imported = 0, missing = 0
  for (const a of Array.isArray(m.assets) ? m.assets : []) {
    const data = typeof a?.path === 'string' ? files.get(a.path) : undefined
    if (!data || typeof a.id !== 'string' || typeof a.mime !== 'string') { missing++; continue }
    try {
      const id = assets.adopt(a.id, data, a.mime, typeof a.name === 'string' ? a.name : 'asset')
      if (id !== a.id) remap.set(a.id, id)
      imported++
    } catch { missing++ }
  }
  const fix = <T>(v: T): T => (remap.size ? JSON.parse(JSON.stringify(v).replace(UUID_G, (id) => remap.get(id) ?? id)) as T : v)

  const graph = fix(m.graph)
  const name = `${String(m.name || '导入的画布').slice(0, 100)}（导入）`
  const project = store.createProject(name, graph)
  const nodeIds = new Set(graph.nodes.map((n) => n.id))
  let results = 0
  for (const o of Array.isArray(m.outputs) ? m.outputs : []) {
    if (typeof o?.nodeId !== 'string' || !nodeIds.has(o.nodeId) || typeof o.cacheKey !== 'string' || typeof o.outputs !== 'object' || o.outputs === null) continue
    store.setNodeOutput(project.id, o.nodeId, o.cacheKey, fix(o.outputs))
    results++
  }
  return { project, assets: imported, missing, results }
}
