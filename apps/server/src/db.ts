import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ModelProfile, ModelProfileInput, ProjectGraph } from '@hzc/core'
import { EMPTY_GRAPH } from '@hzc/core'
import type { SecretBox } from './secrets'

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
    `)
  }

  // ---------- profiles (secrets never leave this class in plaintext except via getApiKey)
  private toProfile(r: Record<string, unknown>): ModelProfile & { hasKey: boolean } {
    return {
      id: r.id as string, name: r.name as string, kind: r.kind as ModelProfile['kind'], adapter: r.adapter as ModelProfile['adapter'],
      endpoint: r.endpoint as string, model: r.model as string, defaults: JSON.parse(r.defaults as string),
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
    this.db.prepare('INSERT INTO profiles VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      id, input.name, input.kind, input.adapter, input.endpoint, input.model, JSON.stringify(input.defaults ?? {}),
      input.apiKey ? this.secrets.encrypt(input.apiKey) : null, now, now,
    )
    return this.getProfile(id)!
  }

  /** apiKey: undefined = keep, '' = clear, other = replace */
  updateProfile(id: string, input: ModelProfileInput) {
    const cur = this.db.prepare('SELECT secret FROM profiles WHERE id = ?').get(id) as { secret: string | null } | undefined
    if (!cur) return undefined
    const secret = input.apiKey === undefined ? cur.secret : input.apiKey === '' ? null : this.secrets.encrypt(input.apiKey)
    this.db.prepare(
      'UPDATE profiles SET name=?, kind=?, adapter=?, endpoint=?, model=?, defaults=?, secret=?, updated_at=? WHERE id=?',
    ).run(input.name, input.kind, input.adapter, input.endpoint, input.model, JSON.stringify(input.defaults ?? {}), secret, new Date().toISOString(), id)
    return this.getProfile(id)!
  }

  deleteProfile(id: string) {
    return this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes > 0
  }

  /** server-internal only (provider calls) */
  getApiKey(id: string): string | undefined {
    const r = this.db.prepare('SELECT secret FROM profiles WHERE id = ?').get(id) as { secret: string | null } | undefined
    return r?.secret ? this.secrets.decrypt(r.secret) : undefined
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
    return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0
  }

  close() { this.db.close() }
}
