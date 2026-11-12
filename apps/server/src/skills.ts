import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Agent Skills (https://agentskills.io/specification): a folder with a SKILL.md made of YAML
 * frontmatter (name, description, optional license / compatibility / metadata / allowed-tools)
 * followed by Markdown instructions. Built-in skills ship with the app; user skills live in
 * <dataDir>/skills/<name>/SKILL.md. Skills here are prompt instructions only — bundled scripts
 * are never executed (or even stored).
 *
 * A skill may come with reference files (references/*.md) that an agent reads on demand. The canvas
 * calls a model once per node, so those are given to the model together with SKILL.md
 * (`instructions()`). A skill imported from somewhere else keeps its own license; the canvas shows it
 * and stores the skill only in the user's data folder.
 */

export class SkillError extends Error {}

/** what a skill is used for on the canvas */
export const SKILL_KINDS = ['director', 'image-reverse', 'prompt'] as const
export type SkillKind = (typeof SKILL_KINDS)[number]
export const isSkillKind = (v: unknown): v is SkillKind => (SKILL_KINDS as readonly unknown[]).includes(v)

export interface SkillMeta {
  name: string
  description: string
  source: 'builtin' | 'user'
  /** frontmatter `license`, else recognised from a LICENSE file shipped with the skill */
  license?: string
  compatibility?: string
  metadata: Record<string, string>
  /** convenience: metadata['hzc-label'] or the name */
  label: string
  /** metadata['hzc-kind'], or what the user chose when importing */
  kind?: SkillKind
  /** reference files shipped with the skill (paths relative to its folder) */
  references: string[]
  /** where it was imported from (a GitHub link) */
  sourceUrl?: string
}

export interface Skill extends SkillMeta { body: string }

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_BYTES = 256 * 1024

export function validateName(name: unknown): string {
  if (typeof name !== 'string' || name.length < 1 || name.length > 64 || !NAME_RE.test(name))
    throw new SkillError('name 必须是 1–64 个小写字母、数字或单个连字符组成，且不能以连字符开头或结尾')
  return name
}

/** Parse and validate a SKILL.md. `dirName`, when given, must equal the frontmatter name (spec rule). */
export function parseSkill(text: string, source: SkillMeta['source'], dirName?: string): Skill {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new SkillError('SKILL.md 超过 256 KB')
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text)
  if (!m) throw new SkillError('SKILL.md 必须以 YAML frontmatter（--- … ---）开头')
  let fm: unknown
  try { fm = parseYaml(m[1]!) } catch (e) { throw new SkillError(`frontmatter 不是合法的 YAML：${(e as Error).message}`) }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) throw new SkillError('frontmatter 必须是键值对')
  const f = fm as Record<string, unknown>
  const name = validateName(f.name)
  if (dirName !== undefined && dirName !== name) throw new SkillError(`name「${name}」必须与所在文件夹名「${dirName}」一致`)
  if (typeof f.description !== 'string' || !f.description.trim() || f.description.length > 1024)
    throw new SkillError('description 必填，且不超过 1024 个字符')
  if (f.compatibility !== undefined && (typeof f.compatibility !== 'string' || f.compatibility.length > 500))
    throw new SkillError('compatibility 不超过 500 个字符')
  const metadata: Record<string, string> = {}
  if (f.metadata !== undefined) {
    if (!f.metadata || typeof f.metadata !== 'object' || Array.isArray(f.metadata)) throw new SkillError('metadata 必须是键值对')
    for (const [k, v] of Object.entries(f.metadata as Record<string, unknown>)) metadata[k] = String(v)
  }
  const body = m[2]!.trim()
  if (!body) throw new SkillError('SKILL.md 正文（指令）不能为空')
  return {
    name, description: f.description.trim(), source, metadata, body,
    license: typeof f.license === 'string' ? f.license : undefined,
    compatibility: typeof f.compatibility === 'string' ? f.compatibility : undefined,
    label: metadata['hzc-label'] || name,
    kind: isSkillKind(metadata['hzc-kind']) ? metadata['hzc-kind'] : undefined,
    references: [],
  }
}

/** Recognise the common licenses from a LICENSE file's text (for display; not legal advice). */
export function detectLicense(text: string): string {
  const t = text.slice(0, 4000)
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(t)) return 'AGPL-3.0'
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(t)) return /Version 3/i.test(t) ? 'LGPL-3.0' : 'LGPL'
  if (/GNU GENERAL PUBLIC LICENSE/i.test(t)) return /Version 3/i.test(t) ? 'GPL-3.0' : /Version 2/i.test(t) ? 'GPL-2.0' : 'GPL'
  if (/Apache License[\s\S]{0,40}Version 2\.0/i.test(t)) return 'Apache-2.0'
  if (/Mozilla Public License[\s\S]{0,20}2\.0/i.test(t)) return 'MPL-2.0'
  if (/\bMIT License\b|Permission is hereby granted, free of charge/i.test(t)) return 'MIT'
  if (/Redistribution and use in source and binary forms/i.test(t)) return 'BSD'
  if (/Creative Commons|CC BY/i.test(t)) return 'CC'
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return 'Unlicense'
  return '见 LICENSE 文件'
}

/** a skill that doesn't say what it is for: guess from its name and description (the user can change it) */
export function guessKind(s: Pick<SkillMeta, 'name' | 'description'>): SkillKind | undefined {
  const t = `${s.name} ${s.description}`
  if (/反推|reverse|image[- ]?to[- ]?prompt|prompts? from (?:an? |the )?(?:reference )?images?/i.test(t)) return 'image-reverse'
  if (/导演|分镜|剧本|storyboard|director|screenplay/i.test(t)) return 'director'
  if (/提示词|prompt/i.test(t)) return 'prompt'
  return undefined
}

/** what may be stored from an imported skill folder: its instructions, references and license — no scripts */
const KEEP = /^(?:SKILL\.md|(?:LICEN[CS]E|COPYING|README)(?:\.(?:md|txt))?|references\/(?:[A-Za-z0-9._-]+\/){0,3}[A-Za-z0-9._-]+\.(?:md|txt))$/
const MAX_FILES = 64
const MAX_TOTAL = 2 * 1024 * 1024
const MAX_INSTRUCTIONS = 512 * 1024

export interface SkillFile { path: string; data: Buffer | string }
interface Sidecar { kind?: SkillKind; sourceUrl?: string; importedAt?: string; label?: string }

/** a display name some skills ship for agent apps (agents/openai.yaml → interface.display_name) */
function displayName(files: SkillFile[]): string | undefined {
  const f = files.find((x) => x.path.replace(/^\.\//, '') === 'agents/openai.yaml')
  if (!f) return undefined
  try {
    const y = parseYaml(typeof f.data === 'string' ? f.data : f.data.toString('utf8')) as { interface?: { display_name?: unknown } } | null
    const n = y?.interface?.display_name
    return typeof n === 'string' && n.trim() && n.length <= 40 ? n.trim() : undefined
  } catch { return undefined }
}

function listRefs(dir: string, rel = 'references'): string[] {
  const abs = join(dir, rel)
  if (!existsSync(abs)) return []
  const out: string[] = []
  for (const d of readdirSync(abs, { withFileTypes: true })) {
    const p = `${rel}/${d.name}`
    if (d.isDirectory()) out.push(...listRefs(dir, p))
    else if (KEEP.test(p)) out.push(p)
  }
  return out.sort()
}

function licenseFile(dir: string): string | undefined {
  for (const n of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING']) {
    const f = join(dir, n)
    if (existsSync(f)) return detectLicense(readFileSync(f, 'utf8'))
  }
  return undefined
}

export class SkillStore {
  private builtin = new Map<string, Skill>()
  private userDir: string

  private dirs = new Map<string, string>()

  constructor(builtinDir: string | undefined, dataDir: string) {
    this.userDir = join(dataDir, 'skills')
    mkdirSync(this.userDir, { recursive: true })
    if (builtinDir && existsSync(builtinDir)) {
      for (const d of readdirSync(builtinDir, { withFileTypes: true })) {
        const file = join(builtinDir, d.name, 'SKILL.md')
        if (!d.isDirectory() || !existsSync(file)) continue
        // a broken built-in is a packaging bug: fail loudly in tests, skip with a warning at runtime
        try { this.builtin.set(d.name, this.withFiles(parseSkill(readFileSync(file, 'utf8'), 'builtin', d.name), join(builtinDir, d.name))) } catch (e) { console.warn(`[hzc] skipping built-in skill ${d.name}: ${(e as Error).message}`) }
      }
    }
  }

  /** add what lives next to SKILL.md: reference files, a LICENSE, and (user skills) how it was imported */
  private withFiles(s: Skill, dir: string): Skill {
    this.dirs.set(`${s.source}:${s.name}`, dir)
    let side: Sidecar = {}
    try { side = JSON.parse(readFileSync(join(dir, 'hzc.json'), 'utf8')) as Sidecar } catch { /* none */ }
    return {
      ...s,
      kind: isSkillKind(side.kind) ? side.kind : s.kind,
      label: s.metadata['hzc-label'] || (typeof side.label === 'string' && side.label) || s.label,
      sourceUrl: typeof side.sourceUrl === 'string' ? side.sourceUrl : undefined,
      license: s.license ?? licenseFile(dir),
      references: listRefs(dir),
    }
  }

  private readUser(name: string): Skill | undefined {
    const dir = join(this.userDir, name)
    const file = join(dir, 'SKILL.md')
    if (!existsSync(file)) return undefined
    try { return this.withFiles(parseSkill(readFileSync(file, 'utf8'), 'user', name), dir) } catch { return undefined }
  }

  /**
   * SKILL.md plus every reference file, as one text for a single model call. References the body
   * mentions come first, in the order it mentions them.
   */
  instructions(name: string): string | undefined {
    const s = this.get(name)
    if (!s) return undefined
    if (!s.references.length) return s.body
    const dir = this.dirs.get(`${s.source}:${s.name}`)!
    const at = (ref: string) => { const i = s.body.indexOf(ref.replace(/^references\//, '')); return i < 0 ? Infinity : i }
    const refs = [...s.references].sort((a, b) => at(a) - at(b) || a.localeCompare(b))
    const parts = [s.body, '', '---', '以下是这个 Skill 附带的参考文件。它们原本按需读取，这里一次全部给出；请按上面正文的说明决定何时使用哪一份。']
    let size = Buffer.byteLength(s.body)
    for (const ref of refs) {
      const text = readFileSync(join(dir, ref), 'utf8').trim()
      size += Buffer.byteLength(text)
      if (size > MAX_INSTRUCTIONS) { parts.push('', `（其余参考文件过长，已省略：从 ${ref} 起）`); break }
      parts.push('', `## 参考文件 ${ref}`, '', text)
    }
    return parts.join('\n')
  }

  list(): SkillMeta[] {
    const user: Skill[] = []
    for (const d of readdirSync(this.userDir, { withFileTypes: true })) {
      if (!d.isDirectory() || !NAME_RE.test(d.name)) continue
      const s = this.readUser(d.name)
      if (s) user.push(s)
    }
    return [...this.builtin.values(), ...user].map(({ body: _b, ...meta }) => meta)
  }

  get(name: string): Skill | undefined {
    if (!NAME_RE.test(name)) return undefined
    return this.builtin.get(name) ?? this.readUser(name)
  }

  /** Save a user skill from SKILL.md text. Name comes from the validated frontmatter (no path tricks). */
  import(text: string, opts: { kind?: SkillKind } = {}): Skill {
    return this.importFiles([{ path: 'SKILL.md', data: text }], opts)
  }

  /**
   * Save a user skill from the files of its folder (paths relative to the folder). Only SKILL.md,
   * references/*.md|txt and LICENSE / README are kept; anything else (scripts, images) is dropped.
   * Importing a skill with the name of an existing user skill replaces it (an update).
   */
  importFiles(files: SkillFile[], opts: { kind?: SkillKind; sourceUrl?: string } = {}): Skill {
    const kept = new Map<string, Buffer>()
    let total = 0
    for (const f of files) {
      const path = f.path.replace(/^\.\//, '')
      if (!KEEP.test(path) || path.split('/').some((seg) => seg === '..' || seg === '.')) continue
      const data = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data
      if (data.length > MAX_BYTES) throw new SkillError(`${path} 超过 256 KB`)
      total += data.length
      if (kept.size >= MAX_FILES || total > MAX_TOTAL) throw new SkillError('这个 Skill 的文件太多或太大（最多 64 个文件、共 2 MB）')
      kept.set(path, data)
    }
    const md = kept.get('SKILL.md')
    if (!md) throw new SkillError('没有找到 SKILL.md')
    const s = parseSkill(md.toString('utf8'), 'user')
    if (this.builtin.has(s.name)) throw new SkillError(`「${s.name}」与内置 Skill 同名，请改一个 name`)
    // write to a fresh folder, then swap it in: a failed import never leaves half a skill behind
    const dir = join(this.userDir, s.name)
    const tmp = join(this.userDir, `.${s.name}.${process.pid}.${Date.now()}`)
    try {
      for (const [path, data] of kept) {
        mkdirSync(dirname(join(tmp, path)), { recursive: true })
        writeFileSync(join(tmp, path), data)
      }
      const side: Sidecar = { kind: opts.kind ?? s.kind ?? guessKind(s), sourceUrl: opts.sourceUrl, importedAt: new Date().toISOString(), label: displayName(files) }
      writeFileSync(join(tmp, 'hzc.json'), JSON.stringify(side, null, 2))
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
      renameSync(tmp, dir)
    } finally {
      if (existsSync(tmp) && statSync(tmp).isDirectory()) rmSync(tmp, { recursive: true, force: true })
    }
    return this.readUser(s.name)!
  }

  /** change what a user skill is used for (the guess on import can be wrong) */
  setKind(name: string, kind: SkillKind): Skill | undefined {
    if (!NAME_RE.test(name)) return undefined
    if (this.builtin.has(name)) throw new SkillError('内置 Skill 的用途不能修改')
    const dir = join(this.userDir, name)
    if (!existsSync(join(dir, 'SKILL.md'))) return undefined
    let side: Sidecar = {}
    try { side = JSON.parse(readFileSync(join(dir, 'hzc.json'), 'utf8')) as Sidecar } catch { /* none yet */ }
    writeFileSync(join(dir, 'hzc.json'), JSON.stringify({ ...side, kind }, null, 2))
    return this.readUser(name)
  }

  remove(name: string): boolean {
    if (!NAME_RE.test(name)) return false
    if (this.builtin.has(name)) throw new SkillError('内置 Skill 不能删除')
    const dir = join(this.userDir, name)
    if (!existsSync(dir)) return false
    rmSync(dir, { recursive: true, force: true })
    return true
  }
}
