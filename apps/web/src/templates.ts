import type { ProjectGraph } from '@hzc/core'

export interface Template { id: string; name: string; description: string; /** node types shown as the card's pipeline */ flow: string[]; graph: () => ProjectGraph }

const id = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`

/** Starter graphs offered on an empty canvas. Model nodes are left unbound on purpose. */
export const TEMPLATES: Template[] = [
  {
    id: 'director',
    name: '创意 → 导演分镜',
    description: '一句创意交给导演 Skill，拆成可直接生成的分镜，再一键展开成镜头节点',
    flow: ['text', 'director', 'image-gen', 'video-gen'],
    graph: () => {
      const a = id('txt'), b = id('dir')
      return {
        version: 1,
        nodes: [
          { id: a, type: 'text', position: { x: 0, y: 40 }, data: { label: '创意', text: '雨夜的霓虹街头，一只机械猫在寻找回家的路，最后在一扇亮着灯的窗前停下。' } },
          { id: b, type: 'director', position: { x: 380, y: 0 }, data: { params: { skill: 'director-short-film', shots: 6, aspect_ratio: '16:9' } } },
        ],
        edges: [{ id: id('e'), source: a, sourceHandle: 'out', target: b, targetHandle: 'in' }],
      }
    },
  },
  {
    id: 'video-reverse',
    name: '视频 → 镜头反推',
    description: '上传一段视频，自动切分镜头、提取关键帧并反推每个镜头的提示词，可一键展开成翻拍节点',
    flow: ['video', 'video-reverse', 'image-gen', 'video-gen'],
    graph: () => {
      const a = id('vid'), b = id('vrev')
      return {
        version: 1,
        nodes: [
          { id: a, type: 'video', position: { x: 0, y: 40 }, data: { label: '参考视频' } },
          { id: b, type: 'video-reverse', position: { x: 400, y: 0 }, data: { params: { maxShots: 8, threshold: 0.3, lang: 'zh' } } },
        ],
        edges: [{ id: id('e'), source: a, sourceHandle: 'out', target: b, targetHandle: 'video' }],
      }
    },
  },
  {
    id: 'image-reverse',
    name: '图片 → 提示词反推',
    description: '上传一张图，反推出可复用的生成提示词',
    flow: ['image', 'image-reverse', 'preview'],
    graph: () => {
      const a = id('img'), b = id('rev'), c = id('pre')
      return {
        version: 1,
        nodes: [
          { id: a, type: 'image', position: { x: 0, y: 40 }, data: { label: '参考图' } },
          { id: b, type: 'image-reverse', position: { x: 380, y: 0 }, data: { params: { style: 'general', lang: 'zh' } } },
          { id: c, type: 'preview', position: { x: 760, y: 60 }, data: {} },
        ],
        edges: [
          { id: id('e'), source: a, sourceHandle: 'out', target: b, targetHandle: 'image' },
          { id: id('e'), source: b, sourceHandle: 'out', target: c, targetHandle: 'in' },
        ],
      }
    },
  },
  {
    id: 'script',
    name: '创意 → 文本模型润色',
    description: '写下一句创意，让文本模型扩写成短片脚本',
    flow: ['text', 'llm', 'preview'],
    graph: () => {
      const a = id('txt'), b = id('llm'), c = id('pre')
      return {
        version: 1,
        nodes: [
          { id: a, type: 'text', position: { x: 0, y: 40 }, data: { label: '创意', text: '雨夜的霓虹街头，一只机械猫在寻找回家的路。' } },
          { id: b, type: 'llm', position: { x: 380, y: 0 }, data: { params: { system: '你是一位短视频编剧。把用户的创意扩写成 30 秒短片脚本，分 4 个镜头，每个镜头写画面、运镜和台词。' } } },
          { id: c, type: 'preview', position: { x: 760, y: 60 }, data: {} },
        ],
        edges: [
          { id: id('e'), source: a, sourceHandle: 'out', target: b, targetHandle: 'in' },
          { id: id('e'), source: b, sourceHandle: 'out', target: c, targetHandle: 'in' },
        ],
      }
    },
  },
]
