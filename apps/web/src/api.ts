import type { ModelProfileInput, ModelProfilePublic, ProjectGraph } from '@hzc/core'

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
}
