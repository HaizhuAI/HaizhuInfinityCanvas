# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [1.0.0-beta.4] — 2026-11-05（代码完成，未打 tag）

### Changed — 沉浸式界面重做（参考 GSAP、Galaxy、Taste Skill，见 ADR-0002）
- 新设计系统「Deep Field」：近黑深蓝底、青绿强调色，**不再使用紫色**；一套圆角、一对按钮（浅色实心主按钮）、一种卡片；内置 Geist / Geist Mono 字体（离线可用）。
- 全窗口星空背景 + 毛玻璃顶栏与侧边栏；星空随画布平移轻微视差；标签页隐藏时暂停。
- GSAP 驱动的界面反馈：节点依次出现、弹窗/菜单/提示进入、节点完成时一圈成功光晕；只在 `motion.ts` 一处使用。
- 从 Galaxy（uiverse.io，MIT）改写 3 个组件并署名：运行中的轨道加载器、停止按钮的流动边框、外观设置里的开关（改为可键盘操作）。
- 设置新增「外观与动效」：一键关闭动效与星空漂移；系统开启「减少动态效果」时自动关闭。
- 普通输入节点不再显示「完成」标记，只在出错时提示；顶栏去掉重复的快捷键提示。

### Added
- **语音合成 TTS 节点**：OpenAI 兼容 `/audio/speech`（OpenAI 及模仿该接口的本地服务，如 Kokoro-FastAPI）、Replicate、fal；音色、语速；节点内直接播放。
- **Agent Skills（SKILL.md）**：按 agentskills.io 规范解析与校验；内置 3 个导演 Skill（短片导演、产品广告导演、剧本拆分镜）；设置里可粘贴或选择文件导入自己的 Skill、删除自己的 Skill。只使用 Skill 的文字指令，不执行任何脚本。
- **导演节点**：创意/剧本 → 选择 Skill、镜头数、画面比例、提示词语言、视觉风格 → 结构化分镜（每个镜头的画面、运镜、台词、时长、文生图与图生视频提示词）；输出格式不对时自动重试一次；修改 Skill 内容会使旧结果失效。
- **展开到画布**：一键把每个镜头展开成「图片生成 → 视频生成（首帧）→ 配音」节点行，提示词与台词已填好、可直接修改，并自动绑定第一个可用的图片/视频/语音模型。
- **快速添加**：画布上按 `/` 打开命令面板（模型、导演 Skill、节点、模板，可搜索、键盘选择）；双击空白画布在该位置添加。
- 新模板「创意 → 导演分镜」。
- API：`/api/skills`（列表、读取、导入、删除）。
- E2E：`e2e/director-flow.cjs`。

### Fixed
- TTS：服务器返回 JSON 时曾被当成 mp3 保存（现在只在服务器未声明类型时才按格式推断，JSON/文本会报错并显示内容，Key 已打码）。
- 命令面板输入框出现多余的焦点外框。

### Verified
- 68 个单元/集成测试（core 19、server 49）；四套 Playwright E2E 全部通过。
- 截图检查：1440 / 1024 宽度，深色与浅色模式。
- GitHub Actions（commit ffb801f）：CI run 42093685791 通过（类型检查、单测、四套 E2E）；安装包 run 42093685799 通过：Windows NSIS + portable、Linux AppImage + deb、Docker 镜像及冒烟测试。

### Not verified yet
- Windows 安装包在真机上的安装与运行。
- 未连接真实的 LLM / TTS 服务商；导演 Skill 的分镜质量取决于所用文本模型，需用你的模型实测。
- 低端显卡上毛玻璃与星空的性能（可在设置里关闭动效）。

## [1.0.0-beta.3] — 2026-11-05（代码完成，未打 tag）

### Changed
- **产品名称更正**：Haizhu 的中文为「海柱」，不是此前误写的「海珠」。应用内（窗口标题、浏览器标签、顶栏）统一使用英文名 **Haizhu Infinity Canvas**。
- **界面全面重做**：设计令牌 + 深色/浅色自动切换、统一图标库；顶栏合并「画布菜单 + 重命名」，只保留一个主操作「运行全部」；侧边栏支持搜索、分组折叠、单击添加（自动放到视图内空位）；节点卡片重新设计（分类色条、图标、模型副标题、状态胶囊、上传区、带类型色点的端口）；连线按数据类型着色、运行时流动；空画布引导卡片 + 一键示例模板；设置改为分栏弹窗，带服务商快速填写。

### Added
- **图片生成**：`openai-compat`（/images/generations，按画面比例换算尺寸）、`replicate`、`fal`（支持参考图 → 图生图）。
- **视频生成**：`replicate`、`fal`（文生视频、首帧/尾帧图生视频，时长与画面比例参数，高级参数 JSON）。
- **异步任务持久化**：远端生成任务写入数据库；超时、重启或网络中断后再次运行会**接着等原任务，不会重复提交、不会重复扣费**；点「停止」会取消服务商侧的任务。
- **运行前费用确认**：模型档案可填写「单次调用费用」；运行包含生成类调用时弹出确认框，列出将调用的节点、复用缓存的节点数和预估总价；全部命中缓存时不打扰。
- 节点内实时进度（排队位置、已用时间、下载结果）。
- 适配器配置：`defaults._fields` 映射各模型的输入字段名，`defaults._timeoutSec` 设置最长等待；以 `_` 开头的键不会发送给服务商。
- API：`POST /api/projects/:id/estimate`。
- E2E：`e2e/gen-flow.cjs`（文本 → 图片 → 首帧视频 → 预览，费用确认、进度、缓存）。

### Fixed
- 进度节流会吞掉最后一条进度消息（改为只在内容变化时推送）。

### Verified
- 47 个单元/集成测试（core 16、server 31；生成相关 13 个，连本地 mock 的 OpenAI 图片 / Replicate / fal / CDN 服务）。
- 三套 Playwright E2E 全部通过。
- GitHub Actions（commit 646b7e2）：CI run 42066046247 通过（类型检查、单测、三套 E2E）；安装包 run 42066046267 通过：Windows NSIS + portable、Linux AppImage + deb、Docker 镜像及冒烟测试。

### Not verified yet
- Windows 安装包在真机上的安装与运行。
- 未连接真实的 Replicate / fal / OpenAI 图片服务；各模型的输入字段名差异较大，首次接入某个模型时可能需要用 `_fields` 或「高级参数」调整。

## [1.0.0-beta.2] — 2026-11-05（代码完成，未打 tag）

### Added
- **执行引擎**：按拓扑序运行；可只运行某节点及其上游；按「节点参数 + 模型档案 + 上游输入」哈希缓存，未变化不重复调用模型；上游失败则下游跳过；可随时停止；同一画布同时只有一个运行。
- **模型适配器**：`openai-compat`（Chat Completions，图片以 data URL 传入）与 `ollama`（/api/chat）；超时、禁止重定向、错误信息中的 API Key 自动打码。
- **节点实装**：文本、图片/视频/音频素材输入、文本模型（可选系统提示）、视觉分析（可选指令）、**图片提示词反推**（通用 / Midjourney / SDXL / Flux / 视频生成 五种目标风格，中/英）、预览。未实装节点会提示计划在哪个 beta 提供。
- **素材库**：上传图片/视频/音频（按内容哈希去重、图片文件头校验、仅 UUID 访问）。
- **运行界面**：节点「▶ 运行 / ↻ 重新生成」、顶部「运行全部 / 停止」、实时状态徽标、结果展示与一键复制；重开画布时恢复上次结果。
- API：`POST /api/assets`、`GET /api/assets/:id`、`POST /api/projects/:id/run`、`GET /api/runs/:id/events`（SSE）、`POST /api/runs/:id/cancel`、`GET /api/projects/:id/outputs`。
- 使用指南：[docs/03-guide/model-profiles.md](./docs/03-guide/model-profiles.md)。
- CI：开发分支推送即构建 Windows / Linux 安装包与 Docker 镜像；E2E 增加 `e2e/run-flow.cjs`。

### Fixed
- 重新打开画布时视图适配早于节点测量导致显示错位（改为按画布重挂载并由 React Flow 在测量后适配）。
- 图片输入节点运行后重复显示同一张图。

### Verified
- 34 个单元/集成测试（core 16、server 18；provider 测试连的是真实的本地 mock HTTP 服务）。
- 两套 Playwright E2E：上传图片 → 反推 → 预览、缓存命中不重复调用、未绑定模型报错清晰、重载后结果恢复。

### Not verified yet
- 未连接任何真实的云端模型服务（只用 mock 验证了协议格式）；真实服务商的兼容性请用你的 Key 实测。
- Windows 安装包在真机上的安装与运行（未签名，首次运行 SmartScreen 会提示「未知发布者」）。

### Verified on CI（GitHub Actions run 42056605765，commit 32367b3）
- Windows：NSIS 安装包 + portable `.exe` 构建成功（artifact `desktop-windows-latest`）。
- Linux：AppImage + `.deb` 构建成功（artifact `desktop-ubuntu-latest`）。
- Docker：镜像构建成功；冒烟测试通过（带口令可访问、无口令 401、未设置口令时拒绝启动）。
- CI：类型检查、单元测试、两套 E2E 全部通过。

## [1.0.0-beta.1] — 2026-11-05（代码完成，未打 tag）

### Added
- 项目初始化：README、LICENSE（私有）、.gitignore、CHANGELOG。
- Phase 0 文档：竞品/开源调研、许可证审计、可行性、ADR-0001 技术选型、版本路线图、构建矩阵。
- `@hzc/core`：端口类型与连线规则、节点类型注册表（输入/模型/工具/输出共 14 种）、图结构与环检测、模型档案校验。
- `@hzc/server`：Fastify REST API（模型档案 / 工程）、SQLite（`node:sqlite`）、AES-256-GCM 加密密钥库、可选访问口令、非回环绑定必须设置口令。
- `@hzc/web`：React Flow 无限画布、侧边栏「我的模型智能体」图标 + 内置节点拖拽入画布、类型化连线校验、模型档案设置页（Key 只写不回传）、自动保存、多画布。
- `@hzc/desktop`：Electron 壳（拉起同一服务，随机端口 + 随机口令，仅回环）；Linux AppImage + deb 打包配置；Windows NSIS + portable 配置。
- Dockerfile / docker-compose、GitHub Actions（CI：类型检查/单测/构建/E2E；Release：Win+Linux 安装包 + Docker 冒烟）。
- E2E 冒烟脚本 `e2e/smoke.cjs`（Playwright）。

### Fixed
- 首个节点落入画布时视图被自动放大导致后续落点错位（改为仅在打开工程时适配视图）。
- 打包器剥掉 `node:sqlite` 前缀导致运行时崩溃（改用运行时 `createRequire` 加载）。
- 服务端产物把依赖当外部包导致打包版启动失败（改为单文件 `index.mjs` 全量打包）。

### Verified（beta.1，Linux 沙箱内）
- 16 个单元测试通过；类型检查通过；干净副本 `--frozen-lockfile` 安装与构建通过。
- Playwright E2E：拖拽建节点、合法连线通过/非法连线拒绝、保存与重载恢复、API Key 不出现在任何 API 响应中。
- Electron（Node 24.22）打包后的 Linux 版在 xvfb 下真实启动并加载 UI；AppImage 与 deb 构建成功。

### Not verified yet
- Windows 安装包（需 Windows runner，交由 CI）。
- Docker 镜像构建（沙箱无 Docker 守护进程；已用等价步骤验证，镜像本身交由 CI）。
- GitHub Actions 工作流本身（尚未在远端运行）。
- 尚未实现任何真实模型调用（beta.2 起）。
