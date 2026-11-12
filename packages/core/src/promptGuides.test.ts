import { describe, expect, it } from 'vitest'
import { cleanOptimizedPrompt, optimizePromptRequest, promptFamily } from './promptGuides'

describe('prompt families', () => {
  it('reads the model name first, then the adapter', () => {
    expect(promptFamily({ kind: 'video', adapter: 'ark', model: 'doubao-seedance-1-0-pro-250528' })).toBe('seedance')
    expect(promptFamily({ kind: 'video', adapter: 'runway', model: 'veo3.1' })).toBe('veo')
    expect(promptFamily({ kind: 'video', adapter: 'runway', model: 'gen4.5' })).toBe('runway')
    expect(promptFamily({ kind: 'video', adapter: 'fal', model: 'fal-ai/kling-video/v2.5' })).toBe('kling')
    expect(promptFamily({ kind: 'video', adapter: 'minimax', model: 'MiniMax-H3' })).toBe('hailuo-h3')
    expect(promptFamily({ kind: 'video', adapter: 'minimax', model: 'MiniMax-Hailuo-02' })).toBe('hailuo')
    expect(promptFamily({ kind: 'video', adapter: 'dashscope', model: 'wan2.7-t2v' })).toBe('wan')
    expect(promptFamily({ kind: 'video', adapter: 'zhipu', model: 'cogvideox-3' })).toBe('cogvideo')
    expect(promptFamily({ kind: 'video', adapter: 'replicate', model: 'someone/new-model' })).toBe('video')
    expect(promptFamily({ kind: 'image', adapter: 'openai-compat', model: 'gpt-image-1' })).toBe('gpt-image')
    expect(promptFamily({ kind: 'image', adapter: 'openai-compat', model: 'gemini-2.5-flash-image' })).toBe('gemini-image')
    expect(promptFamily({ kind: 'image', adapter: 'openai-compat', model: 'doubao-seedream-4-0' })).toBe('seedream')
    expect(promptFamily({ kind: 'image', adapter: 'replicate', model: 'black-forest-labs/flux-1.1-pro' })).toBe('flux')
    expect(promptFamily({ kind: 'image', adapter: 'replicate', model: 'stability-ai/sdxl' })).toBe('sd')
    expect(promptFamily({ kind: 'image', adapter: 'dashscope', model: 'wan2.6-t2i' })).toBe('wan-image')
    expect(promptFamily({ kind: 'image', adapter: 'openai-compat', model: 'Kwai-Kolors/Kolors' })).toBe('image')
  })
})

describe('optimise request', () => {
  it('carries the family rules, the keep-the-meaning rules and the language', () => {
    const r = optimizePromptRequest({ family: 'wan', kind: 'video', prompt: '  海边的橘猫  ' })
    expect(r.user).toBe('海边的橘猫')
    expect(r.system).toContain('通义万相')
    expect(r.system).toContain('固定镜头')
    expect(r.system).toContain('保留原意')
    expect(r.system).toContain('用和原文相同的语言写')
    expect(r.system).not.toContain('首帧')
    expect(optimizePromptRequest({ family: 'runway', kind: 'video', prompt: 'x' }).system).toContain('用英文写')
    expect(optimizePromptRequest({ family: 'runway', kind: 'video', prompt: 'x', lang: 'zh' }).system).toContain('用简体中文写')
    expect(optimizePromptRequest({ family: 'video', kind: 'video', prompt: 'x', fromImage: true }).system).toContain('不要重新描述图片里已有的')
  })
  it('a skill replaces the built-in rules', () => {
    const r = optimizePromptRequest({ family: 'seedance', kind: 'video', prompt: 'x', skill: { name: 'mine', instructions: 'RULES HERE' } })
    expect(r.system).toContain('RULES HERE')
    expect(r.system).not.toContain('无背景音乐')
  })
})

describe('cleaning the answer', () => {
  it('drops fences, labels and wrapping quotes, keeps inner quotes', () => {
    expect(cleanOptimizedPrompt('```text\n橘猫抬头\n```')).toBe('橘猫抬头')
    expect(cleanOptimizedPrompt('优化后的提示词：橘猫抬头')).toBe('橘猫抬头')
    expect(cleanOptimizedPrompt('Prompt: a cat looks up')).toBe('a cat looks up')
    expect(cleanOptimizedPrompt('“橘猫抬头”')).toBe('橘猫抬头')
    expect(cleanOptimizedPrompt('招牌上写着「海边小馆」，橘猫抬头')).toBe('招牌上写着「海边小馆」，橘猫抬头')
    expect(cleanOptimizedPrompt('"a" and "b"')).toBe('"a" and "b"')
  })
})
