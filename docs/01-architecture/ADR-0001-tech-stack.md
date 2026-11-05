# ADR-0001 · 技术选型

- 状态：**已采纳**（2026-11-05）
- 依据：[调研](../00-research/01-landscape.md)、[许可证审计](../00-research/02-license-audit.md)、[可行性](../00-research/03-feasibility.md)

## 背景

产品形态：创作类智能体无限画布。用户预先配置视频/图片/视觉/文本/TTS 模型与导演 Skill，拖到画布、连线，运行后得到分镜、图片、视频、配音并导出成片。必须同时交付 **WebUI、Windows 桌面、Linux 桌面**，且源码暂不公开、日后可能商业化。

## 决策总览

| 层 | 选择 | 备选（放弃原因） |
| --- | --- | --- |
| 语言 | TypeScript 全栈（前端、服务、桌面壳、共享包） | Python 后端（与桌面打包/类型共享不利；ComfyUI 等 Python 生态通过网络 API 接入即可） |
| 仓库形态 | pnpm workspaces monorepo（+ Turborepo 可选） | 多仓库（同步成本高） |
| 画布底座 | **@xyflow/react（React Flow，MIT）** | tldraw（生产需 License Key，⛔）；Excalidraw（非节点图模型）；Konva/自研（工作量大） |
| 前端 | React 18/19 + Vite + TypeScript + Zustand + Tailwind | Next.js（SSR 对桌面打包/本地服务无益，增加复杂度） |
| 本地服务 | **Node.js + Fastify**（REST + WebSocket/SSE 推送任务进度） | Next API routes（与桌面壳耦合差） |
| 存储 | SQLite（better-sqlite3）存工程/任务/元数据 + 文件系统存素材；项目可导出为 `.hzc`（zip: project.json + assets） | JSON 单文件（并发/大工程差）；Postgres/Supabase（违背 local-first） |
| 任务队列 | 进程内持久化队列（SQLite 表 + 轮询 worker），异步 provider 任务可恢复 | Redis/BullMQ（增加外部依赖，桌面版不友好） |
| 桌面壳 | **Electron**（主进程启动同一个 Fastify 服务，窗口加载 WebUI） | Tauri（见下） |
| 打包 | electron-builder：Win → NSIS 安装包 + portable；Linux → AppImage + deb；WebUI → Docker 镜像 + 纯 Node 启动 | — |
| 媒体处理 | **FFmpeg 独立可执行文件**（子进程调用）：抽帧、拼接、混流、字幕烧录 | ffmpeg.wasm（大文件/性能差，仅作浏览器端轻量备选） |
| 剪辑工坊 | 集成 **OpenReel（MIT）**；备选 OpenCut 新版 | 自研时间轴（成本过高） |
| Skill 格式 | **Agent Skills 开放格式**：文件夹 + `SKILL.md`（YAML frontmatter `name`/`description` + 指令正文，可含 `scripts/` `references/` `assets/`） | 自定义格式（失去生态兼容） |
| Agent 编排 | v1.0 自写轻量 DAG 执行器；v1.2 评估 LangGraph（MIT） | 一开始就上 LangGraph（过度设计） |
| 测试 | Vitest（单元）+ Playwright（E2E，沙箱已预装 Chromium） | — |

## 关键决策说明

### D1：画布用 React Flow，而不是 tldraw / Excalidraw

- 需求本质是**带类型端口的节点图**，不是白板。React Flow 内建节点、连线、句柄（端口）、框选、小地图、连接校验。
- 节点是 DOM，可直接内嵌 `<video>`、`<audio>`、表单、进度条，这对「生成结果就地预览」至关重要。
- tldraw 许可证（实测）：生产环境须有 License Key，且不得移除其强制逻辑 → 闭源分发需购买商业授权，且被锁定。
- 代价：DOM 节点在数百节点后可能掉帧 → 缓解：视口外节点降级、视频懒加载（见可行性 R4）；Excalidraw/Konva 保留作未来「标注/蒙版编辑」子组件。

### D2：桌面壳用 Electron，而不是 Tauri

- 我们要在桌面里做视频**预览与（后续）剪辑**。Electron 自带固定版本 Chromium，三端 Web 能力一致（`<video>` 编解码、WebCodecs、WebGPU），Win/Linux 行为可预期。
- Tauri 用系统 WebView（Linux 为 WebKitGTK）。本次调研**没能核实** WebKitGTK 对 WebCodecs/H.264 的实际支持，发行版差异也大；在核心功能依赖媒体能力的产品里，这是不必要的风险。
- 我们已经有 Node 服务，Electron 主进程直接拉起同一服务，**代码与 WebUI 版 100% 共用**，无需 Rust 层。
- 代价：安装包更大（~100MB+）、内存占用更高。可接受。Tauri 作为 v2 的瘦身选项，待实测 WebKitGTK 后再议。

### D3：WebUI 与桌面共用同一服务

```
        ┌────────────── apps/web (React SPA) ──────────────┐
        │  画布 / 侧边栏模型图标 / 设置 / 资产库 / 预览      │
        └───────────────▲──────────────────────────────────┘
                        │ REST + WebSocket(SSE)
        ┌───────────────┴──────────────────────────────────┐
        │ apps/server (Fastify)                            │
        │  ├ 工程/资产 API（SQLite + 文件）                 │
        │  ├ 执行引擎（DAG、缓存、取消、恢复）               │
        │  ├ Provider Runtime（适配器）                     │
        │  ├ Skill Runtime（SKILL.md 加载/执行）            │
        │  └ Media（FFmpeg 子进程）                         │
        └───────▲─────────────────────────▲────────────────┘
                │ 浏览器访问/Docker         │ Electron 主进程拉起并加载
          WebUI 部署                   apps/desktop（Win / Linux）
```

- WebUI：`docker run` 或 `node server` 后浏览器访问；桌面：Electron 启动本地服务（随机端口 + 本地 token，仅回环）。
- 因此 Win/Linux/WebUI 三端是**同一份业务代码**，差异仅在壳和打包。

### D4：模型档案（Model Profile）模型

```ts
type ModelKind = 'llm' | 'vlm' | 'image' | 'video' | 'tts' | 'asr'
interface ModelProfile {
  id: string
  name: string                 // 侧边栏图标名
  kind: ModelKind
  adapter: 'openai-compat' | 'replicate' | 'fal' | 'wavespeed' | 'comfyui' | 'ollama' | 'custom-http'
  endpoint: string
  secretRef: string            // 指向加密密钥库，不落明文
  model: string
  defaults: Record<string, unknown>  // 默认参数（尺寸、时长、voice…）
  paramSchema?: JSONSchema           // 声明式参数表单
  costHint?: { unit: string; amount: number }  // 用于运行前预估
}
```

- 拖「模型图标」到画布 = 实例化一个绑定该档案的节点；节点可覆盖默认参数。
- 新增服务商只需写 adapter，不改画布。

### D5：节点与端口类型

端口类型：`text | image | video | audio | storyboard | list<T> | any`。连接规则：同类型或经显式转换节点。`storyboard` 是 JSON（镜头数组：画面描述、台词、时长、运镜、参考图），导演 Skill 产出它，并扇出到图片/视频/TTS 节点。

初始节点集（beta 逐步交付）：
- 输入：Text/Note、Image、Video、Audio
- 模型：LLM、VLM（视觉分析）、ImageGen、VideoGen、TTS
- 工具：图片提示词反推、视频提示词反推、导演 Skill、列表迭代（扇出/汇聚）
- 输出：预览、导出成片（FFmpeg）、发送到剪辑工坊

### D6：执行语义

- 拓扑排序执行；节点输出按输入哈希缓存，未变化不重跑（省钱）。
- 异步任务（视频/图片）：提交 → 持久化 `job` → 轮询/回调 → 落盘素材；应用重启后自动恢复轮询。
- 支持取消、单节点重跑、失败原因可见；**运行前汇总预估成本**，用户确认才执行付费节点。
- 每个产出素材保存「参数快照」，可一键 Remix。

### D7：安全

- 密钥：桌面用 Electron `safeStorage`，WebUI 用服务端本地加密文件；前端永不读取明文 Key，请求均由服务端代发。
- 服务仅监听回环（桌面）；WebUI 部署启用访问口令。
- 日志默认脱敏；工程导出默认不含密钥。
- 外部 URL/文件读取做 SSRF 与路径穿越防护（尤其 custom-http adapter 与资产接口）。

## 借鉴与魔改策略（回应「不必从零开始」）

不整仓 fork 任何单一项目，原因：没有哪个项目覆盖全链路；Open Canvas / Loomic 为 Next.js 架构，与「桌面 + 同一服务」不匹配；Tapnow 为 GPL。具体做法：

1. 参考 **Open Canvas（MIT）** 的图模型、provider/storage 接口分层与上游注入规则，按 TypeScript 重新实现，必要的摘取登记到 `THIRD_PARTY_NOTICES.md`。
2. 参考 **Loomic（MIT）** 的 Agent/Skill/Worker 分层。
3. 参考 **PoloX（MIT）** 的模型选择卡与资产库抽屉交互。
4. 剪辑工坊直接**集成 OpenReel（MIT）**，而非自研。
5. Tapnow（GPL）：只读功能清单，**不看其实现细节也不复制代码**，视频反推/分镜表独立实现。

## 后果

- 正面：单一代码库覆盖三端；无 GPL 传染；可自由决定后续开源/商业策略。
- 负面：Electron 包体较大；需要自建 provider 适配器与执行引擎（工作量集中在这里）；FFmpeg 分发需专项合规。
- 复审触发条件：WebKitGTK 实测满足需求且包体成为痛点 → 评估 Tauri；OpenReel 集成失败 → 退化为 FFmpeg 导出 + 外部剪辑。
