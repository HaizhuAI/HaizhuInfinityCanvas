/**
 * "Optimise prompt": rewrite a generation prompt the way the target model reads best.
 * The rules below are this project's own wording, distilled from the structure the providers'
 * official guides recommend (see docs/00-research/05-creative-platforms.md, section 3).
 */
import type { ModelKind } from './profiles'

export const PROMPT_FAMILIES = [
  'seedance', 'kling', 'wan', 'hailuo', 'hailuo-h3', 'runway', 'cogvideo', 'veo', 'video',
  'seedream', 'wan-image', 'kling-image', 'gpt-image', 'gemini-image', 'flux', 'sd', 'image',
] as const
export type PromptFamily = (typeof PROMPT_FAMILIES)[number]

export const PROMPT_FAMILY_LABEL: Record<PromptFamily, string> = {
  seedance: 'Seedance', kling: '可灵', wan: '通义万相', hailuo: '海螺', 'hailuo-h3': 'MiniMax H3', runway: 'Runway',
  cogvideo: 'CogVideoX', veo: 'Veo', video: '通用视频',
  seedream: 'Seedream', 'wan-image': '万相图片', 'kling-image': '可灵图片', 'gpt-image': 'GPT Image',
  'gemini-image': 'Gemini 图片', flux: 'FLUX', sd: 'Stable Diffusion', image: '通用图片',
}

export const OPTIMIZE_LANGS = ['auto', 'zh', 'en'] as const
export type OptimizeLang = (typeof OPTIMIZE_LANGS)[number]
export const isOptimizeLang = (v: unknown): v is OptimizeLang => (OPTIMIZE_LANGS as readonly unknown[]).includes(v)

/** Which writing rules fit a model: by its name first (hosts such as Runway or fal serve many families), then by adapter. */
export function promptFamily(t: { kind: ModelKind; adapter?: string; model?: string }): PromptFamily {
  const m = (t.model ?? '').toLowerCase()
  const a = t.adapter ?? ''
  if (t.kind === 'video') {
    if (m.includes('seedance')) return 'seedance'
    if (m.includes('kling')) return 'kling'
    if (/\bveo/.test(m)) return 'veo'
    if (/minimax-h3|hailuo3|\bh3\b/.test(m)) return 'hailuo-h3'
    if (/hailuo|minimax|[it]2v-01/.test(m)) return 'hailuo'
    if (/\bwan|wanx/.test(m)) return 'wan'
    if (m.includes('cogvideo')) return 'cogvideo'
    if (/gen-?4|gen-?3|runway/.test(m)) return 'runway'
    const byAdapter: Record<string, PromptFamily> = { ark: 'seedance', kling: 'kling', dashscope: 'wan', minimax: 'hailuo', runway: 'runway', zhipu: 'cogvideo' }
    return byAdapter[a] ?? 'video'
  }
  if (m.includes('seedream') || a === 'ark') return 'seedream'
  if (/\bwan|wanx/.test(m) || a === 'dashscope') return 'wan-image'
  if (m.includes('kling') || a === 'kling') return 'kling-image'
  if (/gpt-image|dall-?e/.test(m)) return 'gpt-image'
  if (/gemini|nano-?banana|imagen/.test(m)) return 'gemini-image'
  if (m.includes('flux')) return 'flux'
  if (/sdxl|stable-diffusion|\bsd3|sd-?1\.5|sd-?xl/.test(m)) return 'sd'
  return 'image'
}

const VIDEO_BASE = [
  '先写主体与动作，再写场景，然后是镜头（景别、视角、运镜），最后是光线、风格与声音。',
  '一个镜头只写一个主要运镜；没有运镜就写「固定镜头」。',
  '用具体的动词和看得见的细节，少用「电影感、高级、震撼、绝美」这类空泛的形容词。',
]

const GUIDES: Record<PromptFamily, string[]> = {
  // Seedance and MiniMax H3: the official guides as distilled by shuohao-skills (novel-storyboard's
  // shot-writing / seedance-prompt / h3-prompt references, Apache-2.0; see THIRD_PARTY_NOTICES.md)
  seedance: [
    '整条用中文写；多镜头用【镜头1】【镜头2】按顺序写，不写秒数和时间码（官方：模型对精确时间支持不稳定，节奏交给模型）。',
    '每个镜头只写一个运镜（推、拉、跟拍、固定镜头……），按「运镜 → 主体动作与表情 → 位置或空间变化」写。',
    '人物用通用身份（「一名穿藏青学生装的年轻女子」），不写角色姓名；身份、语气、是否画外音写在台词外面。',
    '台词逐字放进 {}，音效用 <>，配乐用（）；不需要对白或配乐时写明「无对白、无背景音乐」。',
    '动作要在这几秒内做得完：肢体细化加程度（缓慢抬手、微微低头），优先低缓连续的小动作，写出前后动作的承接；情绪写成身体细节（低头、肩膀微颤），不写「很悲伤」。',
    '构图写成可量化的：焦距与景深（50mm 标准，中浅景深）、机位、构图法、视线落点、焦点、稳定性；多人同框时写清谁在左谁在右、相距多远。',
    '不写画风词（电影感、色调名）；末尾加约束「保持无字幕」，多人同框时加「禁止出现外形、着装、配饰完全一致的人物」。',
  ],
  kling: [
    '顺序：整体风格 → 人物 / 物体（外观要具体）→ 镜头与动作。',
    '运镜写具体名称（跟拍、推近、拉远、上摇、环绕、手持），可以写幅度和速度。',
    '多镜头时每段写时间码（如「00:00–00:03」），镜头之间用「硬切」，并说明不要淡入淡出。',
    '不想要的东西写成完整句子，例如「画面中不要出现文字、标志和水印」。',
  ],
  wan: [
    '结构：主体 + 场景 + 运动；需要更精确时再加光线、景别、拍摄角度、镜头与运镜、风格。',
    '运镜用直白的说法：「镜头推进」「镜头向左平移」「镜头环绕」；不动写「固定镜头」。',
    '多镜头写成「镜头 1（0–3 秒）：…」，镜头之间写「硬切」。',
    '需要声音时写清人声、音效或背景音乐；台词写成「某某说：「……」」。',
  ],
  hailuo: [
    ...VIDEO_BASE,
    '运镜用方括号命令紧跟在对应描述后：[Push in] [Pull out] [Pan left] [Pan right] [Truck left] [Truck right] [Tilt up] [Tilt down] [Pedestal up] [Pedestal down] [Zoom in] [Zoom out] [Tracking shot] [Shake] [Static shot]；同时发生的写在同一个括号里，用逗号分开。',
    '控制在 2000 字以内。',
  ],
  'hailuo-h3': [
    '官方口径整条英文；人物用通用身份（an old ferryman），不写角色姓名；只有台词、歌词和画面里的文字保留原文。',
    '结构三段：integrated_multimodal_description:（每个镜头独立一行，[Shot 1] 开头，后面的镜头以 At 00:03.000, the camera cuts to … 开头）、overall_soundscape:（环境声与动作声 1–4 句，不复述台词）、non_diegetic_music:（配器与速度，没有写 N/A）。',
    '有多张参考图时，第一行写对齐：Picture k (from Shot k) aligns with the X.XX-second mark of the target video；每个镜头先用 <Picture k> 锚定构图和人物状态，再写动作。',
    '台词逐字放进 <d>[Chinese] …</d>，说话人的身份、音色、语气写在 <d> 外面；画外音写 says in an off-screen voiceover … while their lips remain completely closed。',
    '每个镜头一个运镜，用官方词（static shot / push in / pull out / tracking shot / pan left …），写在自己那一行；动作要在这几秒内做得完，情绪写成身体细节。',
    '不写画风句——画风由调用方统一附加。',
  ],
  runway: [
    '用简洁的英文句子描述画面里发生的运动与镜头运动。',
    '不要写否定句（例如「没有云」），模型容易反着理解；只写想看到的东西。',
    '一个镜头一个主要运镜；不要堆叠形容词。',
  ],
  cogvideo: [
    ...VIDEO_BASE,
    '中英文都可以；总长度不超过 500 个字符。',
  ],
  veo: [
    ...VIDEO_BASE,
    '写清镜头语言（景别、焦段、运镜）与环境光线。',
    '需要声音时写出对白（用引号）、音效和环境声；不需要时写「无对白」。',
  ],
  video: [...VIDEO_BASE, '多镜头时按时间段分开写，并说明转场。'],
  seedream: [
    '主体与外观细节在前，再写场景、构图、光线与风格；用自然句子，具体而不堆砌。',
    '画面里要出现的文字用引号原样写出，并说明位置与字体风格。',
  ],
  'wan-image': [
    '主体 + 外观细节 + 场景 + 构图 + 光线 + 风格，用自然句子。',
    '画面里要出现的文字用引号原样写出。',
  ],
  'kling-image': ['主体与外观在前，再写场景、构图、光线与风格；用自然句子。', '不想要的元素写成完整句子。'],
  'gpt-image': [
    '像对设计师交代需求一样用完整句子描述：主体、构图、风格、光线、用途。',
    '画面里要出现的文字用引号原样写出，并说明位置。',
  ],
  'gemini-image': ['用叙述性的完整段落描述画面，不要关键词堆砌；写清风格、光线、构图和用途。'],
  flux: [
    '用英文自然语言句子：主体与动作在前，再写环境、光线、镜头与画面质感。',
    'FLUX 不支持负面提示词：不想要的东西不要写进去，也不要写「没有……」。',
  ],
  sd: [
    '用英文、逗号分隔的短语，按重要性排序：主体、属性、场景、光线、风格、画质词。',
    '可以用括号权重强调关键词，例如 (red umbrella:1.2)。',
  ],
  image: ['主体与外观细节在前，再写场景、构图、光线与风格；用具体的自然句子。', '画面里要出现的文字用引号原样写出。'],
}

/** the built-in writing rules for a model family (agents read them before writing a prompt) */
export const promptGuide = (family: PromptFamily): string[] => [...GUIDES[family]]

/** families whose models follow English best when the user leaves the language on auto */
const ENGLISH_FIRST = new Set<PromptFamily>(['runway', 'flux', 'sd', 'hailuo-h3'])

export interface OptimizeInput {
  family: PromptFamily
  kind: 'image' | 'video'
  prompt: string
  lang?: OptimizeLang
  /** a first frame is connected: the picture is given, describe motion only */
  fromImage?: boolean
  /** an imported prompt skill replaces the built-in rules */
  skill?: { name: string; instructions: string }
  /** the images themselves are attached (vision model) */
  seesImages?: boolean
}

/** System + user message for the text model. */
export function optimizePromptRequest(o: OptimizeInput): { system: string; user: string } {
  const lang = o.lang ?? 'auto'
  const langRule = lang === 'zh' ? '用简体中文写（模型参数、专有名词和方括号运镜命令保持原样）。'
    : lang === 'en' ? 'Write the prompt in English.'
      : ENGLISH_FIRST.has(o.family) ? '用英文写（这个模型对英文理解最好）。' : '用和原文相同的语言写。'
  const rules = o.skill
    ? [`## 写法（来自 Skill「${o.skill.name}」）`, o.skill.instructions]
    : [`## 写法（${PROMPT_FAMILY_LABEL[o.family]}）`, ...GUIDES[o.family].map((r) => `- ${r}`)]
  const system = [
    `你是一名${o.kind === 'video' ? '视频' : '图片'}生成提示词编辑。把用户的提示词改写成目标模型最容易理解、最能出好效果的写法。`,
    ...rules,
    '## 必须遵守',
    '- 保留原意：主体、人物、数量、台词、品牌名、数字和画面里的文字不能改；不要编造原文没有的人物或情节。',
    '- 可以补充让画面更明确的细节（景别、运镜、光线、构图、材质、时间与天气），但不要喧宾夺主。',
    o.fromImage ? '- 已经提供了首帧图片：只写画面接下来的运动、表演和运镜，不要重新描述图片里已有的主体、场景和风格。' : '',
    o.seesImages ? '- 附带的图片是这次生成的参考 / 首帧，改写时要和它一致。' : '',
    `- ${langRule}`,
    '- 只输出改写后的提示词本身：不要标题、解释、引号、Markdown 或「提示词：」这样的前缀。',
  ].filter(Boolean).join('\n')
  return { system, user: o.prompt.trim() }
}

const QUOTE_PAIRS: Record<string, string> = { '"': '"', '“': '”', '「': '」', '『': '』' }

/** Strip what chat models like to wrap around an answer. */
export function cleanOptimizedPrompt(text: string): string {
  let t = text.trim()
  const fence = /^```[a-z]*\s*\n([\s\S]*?)\n```$/i.exec(t)
  if (fence) t = fence[1]!.trim()
  t = t.replace(/^(?:优化后的?提示词|改写后的?提示词|提示词|prompt|optimized prompt)\s*[:：]\s*/i, '')
  const close = QUOTE_PAIRS[t[0] ?? '']
  if (close && t.length > 2 && t.endsWith(close)) {
    const inner = t.slice(1, -1)
    if (!inner.includes(t[0]!) && !inner.includes(close)) t = inner.trim()
  }
  return t
}
