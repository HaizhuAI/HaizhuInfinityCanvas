# 版本规划与里程碑

## 版本规则

- 遵循 SemVer。起始版本 **v1.0.0-beta**（你写的 "bate" 按 beta 理解），实际打标签用 SemVer 预发布格式：
  `v1.0.0-beta.1 → v1.0.0-beta.2 → … → v1.0.0-rc.1 → v1.0.0`
- 每个 beta 必须：**可运行、可演示、三端构建骨架通过**（WebUI / Win / Linux），并更新 `CHANGELOG.md`。
- 提交规范：Conventional Commits（`feat/fix/docs/chore/build/ci/test`）。
- 同步规则：每完成一个独立步骤 → 一个 commit → 推送到开发分支。打 tag / 发布 Release 需你确认后再做。

## 里程碑

| 版本 | 代号 | 目标（验收标准） |
| --- | --- | --- |
| **v1.0.0-beta.1** | Foundation 地基 | monorepo 脚手架；WebUI 可运行：无限画布、侧边栏**模型图标/节点面板可拖入画布**、类型化端口连线校验、工程保存/加载（SQLite+JSON）、「模型档案」设置页（增删改，密钥加密存储）；Fastify 服务骨架；Electron 壳可启动；Docker/CI 三端构建流水线骨架 |
| v1.0.0-beta.2 | Brain 大脑 | DAG 执行引擎（缓存/取消/进度推送）；Text/LLM 节点、VLM 视觉分析节点（OpenAI 兼容 + Ollama）；**图片提示词反推**节点（内置可编辑模板） |
| v1.0.0-beta.3 | Hands 双手 | 图片生成、视频生成节点；异步任务队列（持久化/恢复/取消）；provider：OpenAI 兼容、Replicate、fal；运行前成本预估；界面重做（WaveSpeed 与多模型 A/B 顺延到后续 beta） |
| v1.0.0-beta.4 | Voice & Director 声音与导演 | TTS 节点（OpenAI 兼容 / 本地 Kokoro·CosyVoice 服务）；`SKILL.md` 加载器；内置**导演 Skill**（剧本/创意→分镜 JSON）；`storyboard` 扇出到图片/视频/TTS 节点；`/` 斜杠命令与 Spotlight 加节点 |
| v1.0.0-beta.5 | Reverse 反推 | FFmpeg 集成；**视频提示词反推**（场景检测抽帧→VLM→镜头表）；一键把镜头表送入生成节点 |
| v1.0.0-beta.6 | Studio 工坊 | 导出成片节点（concat+配音+字幕）；**剪辑工坊（OpenReel）集成验证**；画布素材↔时间轴互通；工程导出/导入 `.hzc` |
| v1.0.0-beta.7 | Desktop 桌面版 | Win（NSIS + portable）/ Linux（AppImage + deb）打磨：自动更新通道、FFmpeg 随包/按需下载、系统 safeStorage、首次启动向导 |
| v1.0.0-beta.8 | Hardening 加固 | 性能（大画布）、E2E 覆盖、错误恢复、日志脱敏、安全审查、文档补全 |
| v1.0.0-rc.1 … | Release Candidate | 冻结功能，只修 bug；法务复核 FFmpeg/第三方 |
| **v1.0.0** | 正式版 | 三端稳定版 |

## 1.0 之后

| 版本 | 方向 |
| --- | --- |
| v1.1 | ComfyUI（GPL，仅 API）与本地模型适配器；角色卡/主体库资产；局部重绘/蒙版节点（Konva/Excalidraw 组件） |
| v1.2 | 「智能体团队」：画布内对话 Agent，一句话生成/改动节点图（计划审批制）；LangGraph 评估 |
| v1.3 | 工作流模板市场（本地/导入导出）；插件系统；画布 MCP Server（让外部 Agent 调用画布能力） |
| v2.0 | macOS；协作；Tauri 瘦身版评估 |

## P0 / P1 / P2 功能优先级（1.0 范围内）

- **P0（主链路，beta.1–6）**：画布与拖拽、模型档案、LLM/VLM、图片/视频生成、TTS、导演 Skill、图片/视频反推、导出成片。
- **P1**：成本预估、A/B 对比、模板打包、Spotlight/斜杠命令、剪辑工坊深度集成。
- **P2**：自动更新、多语言（先中文+英文）、主题。

## 当前进度

- [x] Phase 0：调研、许可证审计、可行性、技术选型（本目录 + `docs/00-research`、`docs/01-architecture`）
- [x] v1.0.0-beta.1 代码部分：脚手架、WebUI 画布与拖拽、模型档案、Electron 壳、Linux 包、Docker/CI 配置（详见 CHANGELOG 的 Verified / Not verified）
- [ ] v1.0.0-beta.1 发布收尾：CI 在远端跑通、Windows 安装包产出并由你真机验证、打 tag（需你确认）
- [x] v1.0.0-beta.2 代码部分：执行引擎、openai-compat/ollama、素材库、文本/视觉/图片提示词反推节点、运行界面
- [x] v1.0.0-beta.3 代码部分：界面重做、图片/视频生成（openai-compat / Replicate / fal）、异步任务持久化与恢复、运行前费用确认
- [x] v1.0.0-beta.4 代码部分：TTS 节点、Agent Skills 与内置导演 Skill、分镜展开到画布、`/` 命令面板、沉浸式界面重做（GSAP / Galaxy / Taste Skill）
- [x] v1.0.0-beta.5 代码部分：「工作室」界面重做（UI-UX-Pro-Max，ADR-0003）、FFmpeg 集成、视频提示词反推、复刻行展开
- [x] v1.0.0-beta.6 代码部分：导出成片节点（拼接、配音对齐、软字幕、SRT），分镜一键变成成片流水线
- [x] v1.0.0-beta.7/8 → 合并进 rc.1：应用图标、错误恢复页、项目包 `.hzc`（含素材与结果）、Shotcut / MLT 剪辑工程（ADR-0004）、桌面版 API Key 密钥进系统钥匙串、打包后应用的启动测试（Linux / Windows）、上传与下载接口加固
- [x] v1.0.0-rc.2 易用性：模型自动选用、运行前检查（带就地修复）、可操作的错误提示、撤销 / 重做、复制粘贴 / 创建副本 / 右键菜单、拖入或粘贴文件、快捷键面板、添加模型时测试连接并列出可用模型
- [ ] v1.0.0-rc 发布收尾：你在 Windows 真机上安装测试、用真实服务商跑通一条完整链路、决定 Docker 镜像是否公开发布（见许可证审计 FFmpeg 一节）、打 tag（需你确认）

### 与原计划的差异（如实记录）

| 原计划 | 实际 | 原因 |
| --- | --- | --- |
| beta.6 OpenReel 集成验证、画布素材 ↔ 时间轴互通 | 改为导出 Shotcut / MLT 剪辑工程；OpenReel 嵌入延后到 1.1 | OpenReel 仍为 alpha，嵌入需要稳定的导入接口与安全审查；见 ADR-0004 |
| beta.7 FFmpeg 随包 / 按需下载 | 不内置，使用系统 FFmpeg，设置里显示状态与安装方法 | 避免分发 GPL 编码器；见许可证审计 |
| beta.7 自动更新通道 | 未做 | 需要正式发布渠道（Release）后才有意义；1.0 正式版后评估 |
| beta.7 首次启动向导 | 以空画布引导卡片 + 「接入第一个模型」+ 服务商快速填写代替 | 同样的引导，少一个弹窗 |
| beta.8 日志脱敏 | 服务端不记录请求日志；服务商错误信息中的 Key 打码 | 没有日志可泄露 |
