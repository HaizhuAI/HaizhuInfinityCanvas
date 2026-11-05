# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased] — v1.0.0-beta 规划中

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
