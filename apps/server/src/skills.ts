import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Agent Skills (https://agentskills.io/specification): a folder with a SKILL.md made of YAML
 * frontmatter (name, description, optional license / compatibility / metadata / allowed-tools)
 * followed by Markdown instructions. Built-in skills ship with the app; user skills live in
 * <dataDir>/skills/<name>/SKILL.md. Skills here are prompt instructions only — bundled scripts
 * are never executed.
 */

export class SkillError extends Error {}

export interface SkillMeta {
  name: string
  description: string
  source: 'builtin' | 'user'
  license?: string
  compatibility?: string
  metadata: Record<string, string>
  /** convenience: metadata['hzc-label'] or the name */
  label: string
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
  }
}

export class SkillStore {
  private builtin = new Map<string, Skill>()
  private userDir: string

  constructor(builtinDir: string | undefined, dataDir: string) {
    this.userDir = join(dataDir, 'skills')
    mkdirSync(this.userDir, { recursive: true })
    if (builtinDir && existsSync(builtinDir)) {
      for (const d of readdirSync(builtinDir, { withFileTypes: true })) {
        const file = join(builtinDir, d.name, 'SKILL.md')
        if (!d.isDirectory() || !existsSync(file)) continue
        // a broken built-in is a packaging bug: fail loudly in tests, skip with a warning at runtime
        try { this.builtin.set(d.name, parseSkill(readFileSync(file, 'utf8'), 'builtin', d.name)) } catch (e) { console.warn(`[hzc] skipping built-in skill ${d.name}: ${(e as Error).message}`) }
      }
    }
  }

  private readUser(name: string): Skill | undefined {
    const file = join(this.userDir, name, 'SKILL.md')
    if (!existsSync(file)) return undefined
    try { return parseSkill(readFileSync(file, 'utf8'), 'user', name) } catch { return undefined }
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
  import(text: string): Skill {
    const s = parseSkill(text, 'user')
    if (this.builtin.has(s.name)) throw new SkillError(`「${s.name}」与内置 Skill 同名，请改一个 name`)
    const dir = join(this.userDir, s.name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), text)
    return s
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
