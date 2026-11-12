import type { Estimate, ModelProfileInput, ModelProfilePublic, NodeOutputs, NodeVersion, OptimizeLang, ProjectGraph, RunEvent } from '@hzc/core'

export type SkillKind = 'director' | 'image-reverse' | 'prompt'
export interface SkillMeta {
  name: string; description: string; source: 'builtin' | 'user'; label: string; metadata: Record<string, string>
  /** frontmatter license, or recognised from the skill's LICENSE file */
  license?: string
  /** what the canvas uses it for */
  kind?: SkillKind
  /** reference files that go to the model with SKILL.md */
  references: string[]
  /** the GitHub link it was imported from (import again to update) */
  sourceUrl?: string
}

export interface AssetMeta { id: string; mime: string; size: number; name: string; createdAt: string }

export type ConnTest = { status: 'ok'; message: string; models: string[] } | { status: 'error' | 'skipped'; message: string }

export interface PlanNode { key: string; type: string; label?: string; text?: string; params?: Record<string, unknown> }
export interface PlanEdge { from: string; fromPort: string; to: string; toPort: string }
export interface Plan { nodes: PlanNode[]; edges: PlanEdge[] }
export interface AssistantReply { reply: string; plan: Plan | null; warnings: string[] }
export interface AssistantRequest {
  profileId: string; message: string
  history: { role: 'user' | 'assistant'; content: string }[]
  canvas: { nodes: { id: string; type: string; label?: string; text?: string }[]; edges: { source: string; sourceHandle?: string; target: string; targetHandle?: string }[] }
}

export interface BackupInfo { name: string; size: number; createdAt: string }
export interface SystemInfo {
  version: string; node?: string; platform?: string; maxParallel?: number
  ffmpeg: { ok: boolean; version?: string; h264: boolean; aac: boolean; error?: string }
  /** multi-user deployment (sign-in accounts) */
  accounts?: boolean
  /** bytes stored in this workspace, and the quota (accounts mode) */
  storage?: { used: number; quota?: number }
  /** automatic database backups */
  backups?: { count: number; latest?: string; keep: number; everyHours: number }
  /** the database was damaged at startup: what was restored */
  recovery?: { at: string; problem: string; restoredFrom?: string; keptAs?: string }
}

export interface SavedPrompt { id: string; title: string; text: string; createdAt: string }

export interface ProjectSummary { id: string; name: string; createdAt: string; updatedAt: string; nodeCount?: number; cover?: { assetId: string; mime: string } }
export interface Project extends ProjectSummary { graph: ProjectGraph }

const TOKEN_KEY = 'hzc.token'
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }
export const setToken = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* ignore */ } }

/** an API call that failed; `status` is 0 when the server could not be reached */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

/**
 * Accounts mode: an API answer of 401 { login: true } means there is no signed-in user. While the app
 * is starting that's a visitor, who goes to the front page; later it's an expired session, and the
 * person signs in again and comes back here.
 */
let booted = false
let leaving = false
export function markBooted() { booted = true }
function needLogin() {
  if (leaving) return
  leaving = true
  const here = location.pathname + location.search
  location.replace(booted ? `/login?next=${encodeURIComponent(here)}` : '/welcome')
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const token = getToken()
  if (token) headers['x-hzc-token'] = token
  let res: Response
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError('连接不上服务（网络中断或服务未运行）', 0)
  }
  if (!res.ok) {
    let msg = res.statusText
    let login = false
    try { const j = (await res.json()) as { error?: string; login?: boolean }; msg = j.error ?? msg; login = !!j.login } catch { /* ignore */ }
    if (res.status === 401 && login) needLogin()
    throw new ApiError(`${res.status} ${msg}`, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { 'x-hzc-token': t } : {}
}

/** URL usable in <img>/<video>/<audio> (cannot send headers, so the token goes in ?t=). */
export function assetUrl(id: string) {
  const t = getToken()
  return `/api/assets/${encodeURIComponent(id)}${t ? `?t=${encodeURIComponent(t)}` : ''}`
}

/** Download link for a project bundle (.hzc); a plain link lets the browser stream it to disk. */
export function bundleUrl(projectId: string) {
  const t = getToken()
  return `/api/projects/${encodeURIComponent(projectId)}/bundle${t ? `?t=${encodeURIComponent(t)}` : ''}`
}

export interface BundleImport { project: Project; assets: number; missing: number; results: number }

async function importSkillZip(file: Blob, kind?: SkillKind): Promise<SkillMeta> {
  const res = await fetch(`/api/skills/import-zip${kind ? `?kind=${kind}` : ''}`, { method: 'POST', headers: { 'content-type': 'application/zip', ...authHeaders() }, body: file })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = ((await res.json()) as { error?: string }).error ?? msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

async function importBundle(file: File): Promise<BundleImport> {
  const res = await fetch('/api/projects/import', { method: 'POST', headers: { 'content-type': 'application/zip', ...authHeaders() }, body: file })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = ((await res.json()) as { error?: string }).error ?? msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

async function uploadAsset(file: File): Promise<{ id: string; mime: string; size: number }> {
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), ...authHeaders() },
    body: file,
  })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = ((await res.json()) as { error?: string }).error ?? msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

/** Reads the run's Server-Sent Events with fetch (EventSource cannot send the token header). */
async function streamRun(runId: string, onEvent: (e: RunEvent) => void, signal?: AbortSignal) {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, { headers: authHeaders(), signal })
  if (!res.ok || !res.body) throw new Error(`事件流连接失败：${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const line = block.split('\n').find((l) => l.startsWith('data: '))
      if (line) onEvent(JSON.parse(line.slice(6)) as RunEvent)
    }
  }
}

export const api = {
  health: () => req<{ ok: boolean; version: string; accounts?: boolean }>('GET', '/api/health'),
  deleteAsset: (id: string) => req<void>('DELETE', `/api/assets/${encodeURIComponent(id)}`),
  listProfiles: () => req<ModelProfilePublic[]>('GET', '/api/profiles'),
  createProfile: (p: ModelProfileInput) => req<ModelProfilePublic>('POST', '/api/profiles', p),
  updateProfile: (id: string, p: ModelProfileInput) => req<ModelProfilePublic>('PUT', `/api/profiles/${id}`, p),
  deleteProfile: (id: string) => req<void>('DELETE', `/api/profiles/${id}`),
  listPrompts: () => req<SavedPrompt[]>('GET', '/api/prompts'),
  savePrompt: (text: string, title?: string) => req<SavedPrompt>('POST', '/api/prompts', { text, title }),
  deletePrompt: (id: string) => req<void>('DELETE', `/api/prompts/${id}`),
  assistant: (b: AssistantRequest) => req<AssistantReply>('POST', '/api/assistant', b),
  testProfile: (b: { adapter: string; endpoint: string; apiKey?: string; profileId?: string }) => req<ConnTest>('POST', '/api/profiles/test', b),
  listProjects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  getProject: (id: string) => req<Project>('GET', `/api/projects/${id}`),
  createProject: (name: string, graph?: ProjectGraph) => req<Project>('POST', '/api/projects', { name, graph }),
  saveProject: (id: string, patch: { name?: string; graph?: ProjectGraph }) => req<Project>('PUT', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => req<void>('DELETE', `/api/projects/${id}`),
  duplicateProject: (id: string, name?: string) => req<Project>('POST', `/api/projects/${id}/duplicate`, { name }),
  uploadAsset,
  assetFrame: (id: string, at: number | 'last') => req<{ id: string; mime: string; size: number }>('POST', `/api/assets/${encodeURIComponent(id)}/frame`, { at }),
  saveStoryboard: (projectId: string, nodeId: string, sb: { title?: string; shots: unknown[] }) =>
    req<{ outputs: NodeOutputs; finishedAt: string; versions: number }>('PUT', `/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/storyboard`, sb),
  pickResult: (projectId: string, nodeId: string, index: number) =>
    req<{ outputs: NodeOutputs; finishedAt: string; versions: number }>('POST', `/api/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/pick`, { index }),
  optimizePrompt: (body: { profileId: string; prompt: string; target: { profileId?: string; kind: 'image' | 'video' }; fromImage?: boolean; imageIds?: string[]; lang?: OptimizeLang; skill?: string }) =>
    req<{ prompt: string; family: string; familyLabel: string; skill?: string }>('POST', '/api/prompt/optimize', body),
  importBundle,
  run: (projectId: string, body: { nodeIds?: string[]; force?: boolean }) => req<{ runId: string }>('POST', `/api/projects/${projectId}/run`, body),
  listAssets: (kind?: 'image' | 'video' | 'audio') => req<AssetMeta[]>('GET', `/api/assets${kind ? `?kind=${kind}` : ''}`),
  system: (refresh = false) => req<SystemInfo>('GET', `/api/system${refresh ? '?refresh=1' : ''}`),
  backups: () => req<BackupInfo[]>('GET', '/api/backups'),
  backupNow: () => req<BackupInfo>('POST', '/api/backups'),
  listSkills: () => req<SkillMeta[]>('GET', '/api/skills'),
  importSkill: (content: string, kind?: SkillKind) => req<SkillMeta>('POST', '/api/skills', { content, kind }),
  importSkillUrl: (url: string, kind?: SkillKind) => req<SkillMeta>('POST', '/api/skills/import-url', { url, kind }),
  importSkillZip,
  setSkillKind: (name: string, kind: SkillKind) => req<SkillMeta>('PUT', `/api/skills/${encodeURIComponent(name)}/kind`, { kind }),
  deleteSkill: (name: string) => req<void>('DELETE', `/api/skills/${encodeURIComponent(name)}`),
  estimate: (projectId: string, body: { nodeIds?: string[]; force?: boolean }) => req<Estimate>('POST', `/api/projects/${projectId}/estimate`, body),
  cancelRun: (runId: string) => req<{ ok: boolean }>('POST', `/api/runs/${runId}/cancel`),
  streamRun,
  outputs: (projectId: string) => req<{ nodeId: string; outputs: NodeOutputs; finishedAt: string; versions: number }[]>('GET', `/api/projects/${projectId}/outputs`),
  listVersions: (projectId: string, nodeId: string) => req<NodeVersion[]>('GET', `/api/projects/${projectId}/nodes/${encodeURIComponent(nodeId)}/versions`),
  useVersion: (projectId: string, nodeId: string, seq: number) => req<{ outputs: NodeOutputs; finishedAt: string; versions: number }>('POST', `/api/projects/${projectId}/nodes/${encodeURIComponent(nodeId)}/versions/${seq}/use`),
}

// ---- accounts (multi-user deployments)
export interface Me { email: string; createdAt: string; isAdmin?: boolean }
export type SignupMode = 'open' | 'invite' | 'closed'
export interface AuthConfig { accounts: boolean; signup: boolean; signupMode?: SignupMode; passwordReset?: boolean; passwordMin: number }
/** sign-in calls report their own errors (a 401 here is "wrong password", not "go sign in") */
async function authReq<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError('连接不上服务，请检查网络', 0)
  }
  if (!res.ok) {
    let msg = res.statusText
    try { msg = ((await res.json()) as { error?: string }).error ?? msg } catch { /* ignore */ }
    throw new ApiError(msg, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}
export const auth = {
  config: () => authReq<AuthConfig>('GET', '/api/auth/config'),
  me: () => authReq<Me>('GET', '/api/auth/me'),
  signup: (email: string, password: string, invite?: string) => authReq<Me>('POST', '/api/auth/signup', { email, password, ...(invite ? { invite } : {}) }),
  forgot: (email: string) => authReq<{ ok: boolean }>('POST', '/api/auth/forgot', { email }),
  reset: (token: string, password: string) => authReq<Me>('POST', '/api/auth/reset', { token, password }),
  login: (email: string, password: string) => authReq<Me>('POST', '/api/auth/login', { email, password }),
  logout: () => authReq<void>('POST', '/api/auth/logout'),
  logoutOthers: () => authReq<void>('POST', '/api/auth/logout-others'),
  changePassword: (current: string, next: string) => authReq<void>('POST', '/api/auth/password', { current, next }),
  deleteAccount: (password: string) => authReq<void>('POST', '/api/auth/delete-account', { password }),
}

// ---- admin console (accounts mode, admins only)
export interface AdminOverview { users: number; admins: number; disabled: number; active7d: number; signups7d: number; bytes: number; runs: number; signupMode: SignupMode; defaultQuotaMb?: number; openWorkspaces: number }
export interface AdminUser { id: string; email: string; createdAt: string; lastLogin?: string; disabled: boolean; isAdmin: boolean; quotaMb: number | null; effectiveQuotaMb: number | null; usage: { bytes: number; runs: number; lastRun?: string } }
export interface AdminInvite { id: string; label: string; note?: string; createdAt: string; expiresAt: string; maxUses: number; uses: number; revoked: boolean; active: boolean }
export const admin = {
  overview: () => authReq<AdminOverview>('GET', '/api/admin/overview'),
  users: (q = '', offset = 0) => authReq<{ users: AdminUser[]; total: number }>('GET', `/api/admin/users?q=${encodeURIComponent(q)}&offset=${offset}&limit=100`),
  setDisabled: (id: string, disabled: boolean) => authReq<{ ok: boolean }>('POST', `/api/admin/users/${id}/disable`, { disabled }),
  setAdmin: (id: string, isAdmin: boolean) => authReq<{ ok: boolean }>('POST', `/api/admin/users/${id}/admin`, { admin: isAdmin }),
  resetPassword: (id: string) => authReq<{ password: string }>('POST', `/api/admin/users/${id}/reset-password`),
  setQuota: (id: string, mb: number | null) => authReq<{ ok: boolean }>('PUT', `/api/admin/users/${id}/quota`, { mb }),
  remove: (id: string) => authReq<void>('DELETE', `/api/admin/users/${id}`),
  invites: () => authReq<AdminInvite[]>('GET', '/api/admin/invites'),
  createInvite: (o: { maxUses: number; days: number; note?: string }) => authReq<{ invite: AdminInvite; code: string; link: string }>('POST', '/api/admin/invites', o),
  revokeInvite: (id: string) => authReq<void>('DELETE', `/api/admin/invites/${id}`),
  setSignupMode: (signupMode: SignupMode) => authReq<{ signupMode: SignupMode }>('PUT', '/api/admin/settings', { signupMode }),
}
