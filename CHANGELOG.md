# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
