import { SkillError, type SkillFile } from './skills'
import { readZip, ZipError } from './zip'

/**
 * Getting a skill folder from a GitHub link or an uploaded .zip (e.g. GitHub's "Download ZIP").
 * Only github.com archives are fetched (the host is fixed here; redirects may only go to GitHub's
 * own download host), so a link can't make the server request anything else.
 */

const MAX_ARCHIVE = 20 * 1024 * 1024
const PART = /^[A-Za-z0-9_.-]+$/
const GITHUB_HOSTS = new Set(['github.com', 'codeload.github.com'])

export interface GitHubRef { owner: string; repo: string; ref?: string; path?: string }

/** github.com/<owner>/<repo>[/tree|blob/<ref>/<path…>] → its parts; anything else is refused */
export function parseGitHubUrl(input: string): GitHubRef {
  let u: URL
  try { u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`) } catch { throw new SkillError('不是有效的链接') }
  if (!['github.com', 'www.github.com'].includes(u.hostname.toLowerCase())) throw new SkillError('目前只支持 GitHub 链接（https://github.com/作者/仓库）')
  const seg = u.pathname.split('/').filter(Boolean).map((x) => decodeURIComponent(x))
  const [owner, rawRepo, mode, ref, ...rest] = seg
  const repo = rawRepo?.replace(/\.git$/i, '')
  if (!owner || !repo || !PART.test(owner) || !PART.test(repo)) throw new SkillError('链接里没有找到「作者/仓库」，例如 https://github.com/作者/仓库')
  if (!mode) return { owner, repo }
  if ((mode !== 'tree' && mode !== 'blob') || !ref || !PART.test(ref)) throw new SkillError('请使用仓库首页或文件夹的链接（…/tree/分支/文件夹）')
  let path = rest.join('/')
  if (mode === 'blob') path = path.replace(/(?:^|\/)SKILL\.md$/i, '')
  if (path && path.split('/').some((p) => !PART.test(p) || p === '..' || p === '.')) throw new SkillError('文件夹路径里有不支持的字符')
  return { owner, repo, ref, path: path || undefined }
}

/** read a response body, refusing more than `max` bytes */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > max) throw new SkillError(`压缩包超过 ${max / 1024 / 1024} MB`)
  const reader = res.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) { await reader.cancel(); throw new SkillError(`压缩包超过 ${max / 1024 / 1024} MB`) }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/** Download a GitHub repository (or one folder of it) as skill files. */
export async function fetchGitHubSkill(url: string, opts: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<{ files: SkillFile[]; sourceUrl: string }> {
  const g = parseGitHubUrl(url)
  const doFetch = opts.fetch ?? fetch
  let target = `https://github.com/${g.owner}/${g.repo}/archive/${g.ref ?? 'HEAD'}.zip`
  let res: Response | undefined
  for (let hop = 0; hop < 5; hop++) {
    try {
      res = await doFetch(target, { redirect: 'manual', signal: opts.signal ?? AbortSignal.timeout(60_000), headers: { 'user-agent': 'HaizhuInfinityCanvas' } })
    } catch (e) {
      throw new SkillError(`连不上 GitHub（${(e as Error).message}）。可以在仓库页面点 Code → Download ZIP，再用「上传压缩包」导入`)
    }
    if (res.status < 300 || res.status >= 400) break
    const next = res.headers.get('location')
    if (!next) break
    const nu = new URL(next, target)
    if (nu.protocol !== 'https:' || !GITHUB_HOSTS.has(nu.hostname)) throw new SkillError('GitHub 返回了意外的跳转地址，已停止下载')
    target = nu.toString()
  }
  if (!res || res.status === 404) throw new SkillError('GitHub 上找不到这个仓库或分支（私有仓库需要先下载 ZIP 再上传）')
  if (!res.ok) throw new SkillError(`从 GitHub 下载失败：HTTP ${res.status}。可以稍后再试，或下载 ZIP 后上传`)
  const zip = await readCapped(res, MAX_ARCHIVE)
  const sourceUrl = `https://github.com/${g.owner}/${g.repo}${g.ref ? `/tree/${g.ref}${g.path ? `/${g.path}` : ''}` : ''}`
  return { files: skillFilesFromZip(zip, g.path), sourceUrl }
}

/**
 * The skill folder inside a zip: `path` when given; otherwise the archive root (GitHub wraps everything
 * in one "<repo>-<ref>/" folder, which is skipped), or the only folder that has a SKILL.md.
 */
export function skillFilesFromZip(buf: Buffer, path?: string): SkillFile[] {
  if (buf.length > MAX_ARCHIVE) throw new SkillError('压缩包超过 20 MB')
  let entries
  try { entries = readZip(buf, { maxEntries: 5000, maxTotal: 64 * 1024 * 1024 }) } catch (e) {
    throw new SkillError(e instanceof ZipError ? `不是可以读取的 zip 压缩包（${e.message}）` : '不是可以读取的 zip 压缩包')
  }
  let names = entries.filter((e) => !e.name.endsWith('/')).map((e) => ({ ...e, name: e.name.replace(/\\/g, '/') }))
  // GitHub (and most zip tools) put everything under one top folder
  const tops = new Set(names.map((e) => e.name.split('/')[0]))
  if (tops.size === 1 && names.every((e) => e.name.includes('/'))) {
    const top = [...tops][0]! + '/'
    names = names.map((e) => ({ ...e, name: e.name.slice(top.length) }))
  }
  let root = path ? path.replace(/\/+$/, '') + '/' : ''
  if (!root && !names.some((e) => e.name === 'SKILL.md')) {
    const found = names.filter((e) => /(?:^|\/)SKILL\.md$/.test(e.name)).map((e) => e.name.slice(0, -'SKILL.md'.length))
    if (found.length === 0) throw new SkillError('压缩包里没有 SKILL.md：这不是一个 Agent Skill')
    if (found.length > 1) throw new SkillError(`这里有多个 Skill（${found.map((f) => f.replace(/\/$/, '')).join('、')}），请把链接指到其中一个文件夹`)
    root = found[0]!
  }
  const files = names.filter((e) => e.name.startsWith(root)).map((e) => ({ path: e.name.slice(root.length), data: e.data }))
  if (!files.some((f) => f.path === 'SKILL.md')) throw new SkillError(path ? `文件夹「${path}」里没有 SKILL.md` : '压缩包里没有 SKILL.md')
  return files
}
