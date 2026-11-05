import type { ModelProfileInput, ModelProfilePublic, NodeOutputs, ProjectGraph, RunEvent } from '@hzc/core'

export interface ProjectSummary { id: string; name: string; createdAt: string; updatedAt: string }
export interface Project extends ProjectSummary { graph: ProjectGraph }

const TOKEN_KEY = 'hzc.token'
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' } }
export const setToken = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t) } catch { /* ignore */ } }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  const token = getToken()
  if (token) headers['x-hzc-token'] = token
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = ((await res.json()) as { error?: string }).error ?? msg } catch { /* ignore */ }
    throw new Error(`${res.status} ${msg}`)
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
  health: () => req<{ ok: boolean; version: string }>('GET', '/api/health'),
  listProfiles: () => req<ModelProfilePublic[]>('GET', '/api/profiles'),
  createProfile: (p: ModelProfileInput) => req<ModelProfilePublic>('POST', '/api/profiles', p),
  updateProfile: (id: string, p: ModelProfileInput) => req<ModelProfilePublic>('PUT', `/api/profiles/${id}`, p),
  deleteProfile: (id: string) => req<void>('DELETE', `/api/profiles/${id}`),
  listProjects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  getProject: (id: string) => req<Project>('GET', `/api/projects/${id}`),
  createProject: (name: string, graph?: ProjectGraph) => req<Project>('POST', '/api/projects', { name, graph }),
  saveProject: (id: string, patch: { name?: string; graph?: ProjectGraph }) => req<Project>('PUT', `/api/projects/${id}`, patch),
  deleteProject: (id: string) => req<void>('DELETE', `/api/projects/${id}`),
  uploadAsset,
  run: (projectId: string, body: { nodeIds?: string[]; force?: boolean }) => req<{ runId: string }>('POST', `/api/projects/${projectId}/run`, body),
  cancelRun: (runId: string) => req<{ ok: boolean }>('POST', `/api/runs/${runId}/cancel`),
  streamRun,
  outputs: (projectId: string) => req<{ nodeId: string; outputs: NodeOutputs; finishedAt: string }[]>('GET', `/api/projects/${projectId}/outputs`),
}
