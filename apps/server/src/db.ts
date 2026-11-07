import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ModelProfile, ModelProfileInput, ProjectGraph } from '@hzc/core'
import { EMPTY_GRAPH } from '@hzc/core'
import { SecretError, type SecretBox } from './secrets'

/** generations kept per node (result versions) */
export const MAX_VERSIONS = 30

// Loaded at runtime via require so bundlers (tsup/esbuild) cannot strip the `node:` prefix,
// which would turn the import into the non-existent "sqlite" package.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

export interface ProjectRow {
  id: string
  name: string
  graph: ProjectGraph
  createdAt: string
  updatedAt: string
}

export interface JobRow {
  id: string
  projectId: string
  nodeId: string
  cacheKey: string
  adapter: string
  remoteId: string
  pollUrl?: string
  resultUrl?: string
  cancelUrl?: string
  status: 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  error?: string
  createdAt: string
  updatedAt: string
}

function toJob(r: Record<string, unknown>): JobRow {
  return {
    id: r.id as string, projectId: r.project_id as string, nodeId: r.node_id as string, cacheKey: r.cache_key as string,
    adapter: r.adapter as string, remoteId: r.remote_id as string, pollUrl: (r.poll_url as string) ?? undefined,
    resultUrl: (r.result_url as string) ?? undefined, cancelUrl: (r.cancel_url as string) ?? undefined,
    status: r.status as JobRow['status'], error: (r.error as string) ?? undefined, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  }
}

export class Store {
  private db: DatabaseSyncType

  constructor(path: string, private secrets: SecretBox) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, adapter TEXT NOT NULL,
        endpoint TEXT NOT NULL, model TEXT NOT NULL, defaults TEXT NOT NULL,
        secret TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, graph TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
        name TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, node_id TEXT NOT NULL, cache_key TEXT NOT NULL,
        adapter TEXT NOT NULL, remote_id TEXT NOT NULL, poll_url TEXT, result_url TEXT, cancel_url TEXT,
        status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_lookup ON jobs (project_id, node_id, cache_key, status);
      CREATE TABLE IF NOT EXISTS node_outputs (
        project_id TEXT NOT NULL, node_id TEXT NOT NULL, cache_key TEXT NOT NULL,
        outputs TEXT NOT NULL, finished_at TEXT NOT NULL,
        PRIMARY KEY (project_id, node_id)
      );
      CREATE TABLE IF NOT EXISTS node_versions (
        project_id TEXT NOT NULL, node_id TEXT NOT NULL, seq INTEGER NOT NULL, cache_key TEXT NOT NULL,
        outputs TEXT NOT NULL, finished_at TEXT NOT NULL,
        PRIMARY KEY (project_id, node_id, seq)
      );
    `)
    // migrations for databases created by earlier betas
    const cols = (this.db.prepare('PRAGMA table_info(profiles)').all() as { name: string }[]).map((c) => c.name)
    if (!cols.includes('cost')) this.db.exec('ALTER TABLE profiles ADD COLUMN cost TEXT')
  }

  // ---------- provider jobs (long-running remote generations; survive restarts, never double-submitted)
  findActiveJob(projectId: string, nodeId: string, cacheKey: string): JobRow | undefined {
    const r = this.db.prepare(
      "SELECT * FROM jobs WHERE project_id = ? AND node_id = ? AND cache_key = ? AND status IN ('submitted','running') ORDER BY created_at DESC LIMIT 1",
    ).get(projectId, nodeId, cacheKey)
    return r ? toJob(r) : undefined
  }

  insertJob(j: Omit<JobRow, 'createdAt' | 'updatedAt' | 'error'>) {
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      j.id, j.projectId, j.nodeId, j.cacheKey, j.adapter, j.remoteId, j.pollUrl ?? null, j.resultUrl ?? null, j.cancelUrl ?? null, j.status, null, now, now,
    )
  }

  updateJob(id: string, patch: { status: JobRow['status']; error?: string }) {
    this.db.prepare('UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(patch.status, patch.error ?? null, new Date().toISOString(), id)
  }

  // ---------- assets (file bytes live on disk; see assets.ts)
  insertAsset(a: { id: string; sha256: string; mime: string; size: number; name: string }) {
    this.db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(a.id, a.sha256, a.mime, a.size, a.name, new Date().toISOString())
  }

  getAsset(id: string) {
    return this.db.prepare('SELECT id, sha256, mime, size, name FROM assets WHERE id = ?').get(id) as
      | { id: string; sha256: string; mime: string; size: number; name: string }
      | undefined
  }

  /** Gallery listing: one row per distinct file (newest upload wins), newest first. */
  listAssets(kind?: 'image' | 'video' | 'audio', limit = 200) {
    const rows = this.db.prepare(
      `SELECT id, mime, size, name, created_at FROM assets a
       WHERE (mime LIKE 'image/%' OR mime LIKE 'video/%' OR mime LIKE 'audio/%') AND (? IS NULL OR mime LIKE ?)
         AND created_at = (SELECT MAX(created_at) FROM assets b WHERE b.sha256 = a.sha256)
       GROUP BY sha256 ORDER BY created_at DESC LIMIT ?`,
    ).all(kind ?? null, kind ? `${kind}/%` : null, Math.min(Math.max(1, limit), 1000)) as Record<string, string | number>[]
    return rows.map((r) => ({ id: r.id as string, mime: r.mime as string, size: r.size as number, name: r.name as string, createdAt: r.created_at as string }))
  }

  // ---------- node output cache (latest successful result per node)
  getNodeOutput(projectId: string, nodeId: string) {
    const r = this.db.prepare('SELECT cache_key, outputs, finished_at FROM node_outputs WHERE project_id = ? AND node_id = ?').get(projectId, nodeId) as
      | { cache_key: string; outputs: string; finished_at: string }
      | undefined
    return r ? { cacheKey: r.cache_key, outputs: JSON.parse(r.outputs), finishedAt: r.finished_at } : undefined
  }

  setNodeOutput(projectId: string, nodeId: string, cacheKey: string, outputs: unknown) {
    this.db.prepare('INSERT OR REPLACE INTO node_outputs VALUES (?,?,?,?,?)').run(projectId, nodeId, cacheKey, JSON.stringify(outputs), new Date().toISOString())
  }

  // ---------- result versions: every generation of a node is kept (newest MAX_VERSIONS)
  /** Records a generation unless it equals the latest one; returns how many versions the node now has. */
  addNodeVersion(projectId: string, nodeId: string, cacheKey: string, outputs: unknown): number {
    const json = JSON.stringify(outputs)
    const last = this.db.prepare('SELECT seq, outputs FROM node_versions WHERE project_id = ? AND node_id = ? ORDER BY seq DESC LIMIT 1').get(projectId, nodeId) as { seq: number; outputs: string } | undefined
    if (last?.outputs !== json) {
      const seq = (last?.seq ?? 0) + 1
      this.db.prepare('INSERT INTO node_versions VALUES (?,?,?,?,?,?)').run(projectId, nodeId, seq, cacheKey, json, new Date().toISOString())
      this.db.prepare('DELETE FROM node_versions WHERE project_id = ? AND node_id = ? AND seq <= ?').run(projectId, nodeId, seq - MAX_VERSIONS)
    }
    return this.countNodeVersions(projectId, nodeId)
  }

  countNodeVersions(projectId: string, nodeId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM node_versions WHERE project_id = ? AND node_id = ?').get(projectId, nodeId) as { n: number }).n
  }

  /** newest first */
  listNodeVersions(projectId: string, nodeId: string) {
    return (this.db.prepare('SELECT seq, outputs, finished_at FROM node_versions WHERE project_id = ? AND node_id = ? ORDER BY seq DESC').all(projectId, nodeId) as Record<string, string | number>[])
      .map((r) => ({ seq: r.seq as number, outputs: JSON.parse(r.outputs as string) as unknown, finishedAt: r.finished_at as string }))
  }

  /** Make a kept version the node's current result (what downstream nodes receive). */
  useNodeVersion(projectId: string, nodeId: string, seq: number) {
    const v = this.db.prepare('SELECT cache_key, outputs FROM node_versions WHERE project_id = ? AND node_id = ? AND seq = ?').get(projectId, nodeId, seq) as { cache_key: string; outputs: string } | undefined
    if (!v) return undefined
    this.setNodeOutput(projectId, nodeId, v.cache_key, JSON.parse(v.outputs))
    return this.getNodeOutput(projectId, nodeId)!
  }

  /** Results with their cache keys, for project bundles. */
  listNodeOutputsForBundle(projectId: string) {
    return (this.db.prepare('SELECT node_id, cache_key, outputs, finished_at FROM node_outputs WHERE project_id = ?').all(projectId) as Record<string, string>[]).map((r) => ({
      nodeId: r.node_id!, cacheKey: r.cache_key!, outputs: JSON.parse(r.outputs!) as unknown, finishedAt: r.finished_at!,
    }))
  }

  listNodeOutputs(projectId: string) {
    const counts = new Map((this.db.prepare('SELECT node_id, COUNT(*) AS n FROM node_versions WHERE project_id = ? GROUP BY node_id').all(projectId) as { node_id: string; n: number }[]).map((r) => [r.node_id, r.n]))
    return (this.db.prepare('SELECT node_id, outputs, finished_at FROM node_outputs WHERE project_id = ?').all(projectId) as Record<string, string>[]).map((r) => ({
      nodeId: r.node_id!, outputs: JSON.parse(r.outputs!), finishedAt: r.finished_at!, versions: counts.get(r.node_id!) ?? 0,
    }))
  }

  // ---------- profiles (secrets never leave this class in plaintext except via getApiKey)
  private toProfile(r: Record<string, unknown>): ModelProfile & { hasKey: boolean } {
    return {
      id: r.id as string, name: r.name as string, kind: r.kind as ModelProfile['kind'], adapter: r.adapter as ModelProfile['adapter'],
      endpoint: r.endpoint as string, model: r.model as string, defaults: JSON.parse(r.defaults as string),
      cost: r.cost ? JSON.parse(r.cost as string) : undefined,
      secretRef: r.secret ? (r.id as string) : '', hasKey: !!r.secret,
      createdAt: r.created_at as string, updatedAt: r.updated_at as string,
    }
  }

  listProfiles() {
    return this.db.prepare('SELECT * FROM profiles ORDER BY created_at').all().map((r) => this.toProfile(r))
  }

  getProfile(id: string) {
    const r = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)
    return r ? this.toProfile(r) : undefined
  }

  createProfile(input: ModelProfileInput) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO profiles (id, name, kind, adapter, endpoint, model, defaults, secret, created_at, updated_at, cost) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id, input.name, input.kind, input.adapter, input.endpoint, input.model, JSON.stringify(input.defaults ?? {}),
      input.apiKey ? this.secrets.encrypt(input.apiKey) : null, now, now, input.cost ? JSON.stringify(input.cost) : null,
    )
    return this.getProfile(id)!
  }

  /** apiKey: undefined = keep, '' = clear, other = replace */
  updateProfile(id: string, input: ModelProfileInput) {
    const cur = this.db.prepare('SELECT secret FROM profiles WHERE id = ?').get(id) as { secret: string | null } | undefined
    if (!cur) return undefined
    const secret = input.apiKey === undefined ? cur.secret : input.apiKey === '' ? null : this.secrets.encrypt(input.apiKey)
    this.db.prepare(
      'UPDATE profiles SET name=?, kind=?, adapter=?, endpoint=?, model=?, defaults=?, secret=?, cost=?, updated_at=? WHERE id=?',
    ).run(input.name, input.kind, input.adapter, input.endpoint, input.model, JSON.stringify(input.defaults ?? {}), secret,
      input.cost ? JSON.stringify(input.cost) : null, new Date().toISOString(), id)
    return this.getProfile(id)!
  }

  deleteProfile(id: string) {
    return this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes > 0
  }

  /** server-internal only (provider calls) */
  getApiKey(id: string): string | undefined {
    const r = this.db.prepare('SELECT secret FROM profiles WHERE id = ?').get(id) as { secret: string | null } | undefined
    if (!r?.secret) return undefined
    try {
      return this.secrets.decrypt(r.secret)
    } catch {
      throw new SecretError('这个模型档案保存的 API Key 无法解密（本机的加密密钥已更换），请在「设置 → 模型档案」里重新填写 Key')
    }
  }

  // ---------- projects
  private toProject(r: Record<string, unknown>): ProjectRow {
    return { id: r.id as string, name: r.name as string, graph: JSON.parse(r.graph as string), createdAt: r.created_at as string, updatedAt: r.updated_at as string }
  }

  listProjects() {
    return (this.db.prepare('SELECT id, name, created_at, updated_at FROM projects ORDER BY updated_at DESC').all() as Record<string, string>[]).map((r) => ({
      id: r.id!, name: r.name!, createdAt: r.created_at!, updatedAt: r.updated_at!,
    }))
  }

  getProject(id: string) {
    const r = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
    return r ? this.toProject(r) : undefined
  }

  createProject(name: string, graph: ProjectGraph = EMPTY_GRAPH) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO projects VALUES (?,?,?,?,?)').run(id, name, JSON.stringify(graph), now, now)
    return this.getProject(id)!
  }

  saveProject(id: string, patch: { name?: string; graph?: ProjectGraph }) {
    const cur = this.getProject(id)
    if (!cur) return undefined
    this.db.prepare('UPDATE projects SET name=?, graph=?, updated_at=? WHERE id=?').run(
      patch.name ?? cur.name, JSON.stringify(patch.graph ?? cur.graph), new Date().toISOString(), id,
    )
    return this.getProject(id)!
  }

  deleteProject(id: string) {
    this.db.prepare('DELETE FROM node_outputs WHERE project_id = ?').run(id)
    this.db.prepare('DELETE FROM node_versions WHERE project_id = ?').run(id)
    return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0
  }

  close() { this.db.close() }
}
