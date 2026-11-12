# Haizhu Infinity Canvas（海柱无限画布）

> 面向「创作类智能体」的无限画布创作工坊。把你预先配置好的**视频模型、图片模型、视觉分析模型、文本模型、TTS 语音模型、导演 Skill** 做成图标，拖进画布、连线成"智能体团队"，一键跑出分镜、图片、视频、配音，并导出成片。

- 当前版本：**v1.0.0-rc.16**（候选版，尚未打 tag；安装包见 GitHub Actions 的「Build installers」产物）
- 源码状态：**公开仓库（源码可见）**，但尚未授予开源许可，保留所有权利（见 [LICENSE](./LICENSE)）
- 目标平台：WebUI（浏览器/Docker，可开启注册登录部署成多人网站）· Windows 桌面版 · macOS 桌面版（Apple 芯片 / Intel）· Linux 桌面版（x64 / arm64）

## 核心理念

1. **模型即图标**：在「设置 → 模型档案」里配好一次（接口地址、Key、模型名、默认参数），它就成为侧边栏里的一个可拖拽图标。
2. **连线即工作流**：节点有类型化端口（文本 / 图片 / 视频 / 音频 / 分镜 JSON），不兼容的线拉不出来；上游输出自动注入下游。不想接线时，用画布底部的**生成栏**一句话直接生成（一次可出 1–4 个再选用，结果仍是普通节点），还能「按目标模型优化提示词」、从视频最后一帧接着生成下一段。用**主体**节点给角色 / 商品起名并放参考图，在提示词里 `@名字` 引用，保持多个镜头一致；导演的分镜可以在**分镜表**里直接改。
3. **导演 Skill**：采用开放的 Agent Skills（`SKILL.md`）格式，导演 Skill 读剧本/创意 → 输出分镜 → 扇出成多个图片/视频节点。
4. **反推闭环**：图片提示词反推（内置模板，或一键导入 GitHub 上的反推 Skill，如 image-prompt-reverse）、视频提示词反推（抽帧 + 视觉模型 → 镜头表），正向提示词与负面词分别喂给生成节点。
5. **成片导出 + 剪辑工程**：画布内容 → FFmpeg 合成成片（拼接、配音、软字幕）；同时可导出与成片一致的 MLT 剪辑工程，用开源剪辑软件 Shotcut 在时间线上精修。
6. **接入常用服务商**：火山方舟 Seedance、阿里云百炼万相、可灵、MiniMax 海螺、智谱 CogVideoX、硅基流动、Runway、ElevenLabs 有专用适配器，OpenAI、Gemini、DeepSeek、Kimi 等走 OpenAI 兼容接口，也可接 Replicate / fal 和本机模型（见[接入各家模型服务商](./docs/03-guide/model-providers.md)）。
7. **本地优先 + 自带 Key**：项目与素材存本地，API Key 加密保存（桌面版的加密密钥交给系统钥匙串），成本透明、失败不乱扣费。
8. **项目包**：一个 `.hzc` 文件带走画布、素材与全部生成结果，换电脑或备份都不丢。
9. **安全与冗余**：网页部署防跨站请求、DNS 重绑定、SSRF 与令牌暴力猜测；数据库自动备份、损坏时自动从备份恢复，保存失败的修改留在浏览器里自动重试（见[部署指南](./docs/03-guide/projects-and-desktop.md#安全部署清单)）。
10. **可部署成网站（SaaS）**：开启账号模式后访客可注册登录，每人一个独立空间（自己的数据库与文件夹），自带模型 Key，管理员命令行管理账号（见[多人网站部署](./docs/03-guide/saas-deployment.md)）。
11. **让 Agent 操作画布（MCP）**：一条命令把桌面版加到 Claude Code，像本地 MCP 一样使用：让 Claude 搭节点、写提示词、预估费用、运行并查看结果，画布实时显示它的改动（见[Agent 接入](./docs/03-guide/agent-mcp.md)）。

> 视频反推与导出成片需要系统安装 FFmpeg（应用不内置），见[视频指南](./docs/03-guide/video-and-export.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/00-research/01-landscape.md](./docs/00-research/01-landscape.md) | 竞品与开源项目调研 |
| [docs/00-research/02-license-audit.md](./docs/00-research/02-license-audit.md) | 许可证审计：哪些能用、哪些只能借鉴思路 |
| [docs/00-research/03-feasibility.md](./docs/00-research/03-feasibility.md) | 可行性结论与风险清单 |
| [docs/00-research/04-kaworkai-reference.md](./docs/00-research/04-kaworkai-reference.md) | 参考调研：咔作画布的交互思路，借鉴了什么、没有引入什么 |
| [docs/00-research/05-creative-platforms.md](./docs/00-research/05-creative-platforms.md) | 参考调研：Google Flow、即梦、LibTV、可灵、Runway、Krea、Flora、ComfyUI 等 30 余个图片 / 视频创作平台的交互规律与各模型提示词写法 |
| [docs/01-architecture/ADR-0001-tech-stack.md](./docs/01-architecture/ADR-0001-tech-stack.md) | 技术选型决策记录 |
| [docs/01-architecture/ADR-0002-ui-design-system.md](./docs/01-architecture/ADR-0002-ui-design-system.md) | 动效决策（GSAP / Galaxy / Taste Skill；配色与布局已由 ADR-0003 取代） |
| [docs/01-architecture/ADR-0003-studio-design-system.md](./docs/01-architecture/ADR-0003-studio-design-system.md) | 「工作室」设计系统：面向图片 / 视频创作者的内容优先界面（UI-UX-Pro-Max；配色字体已由 ADR-0005 取代） |
| [docs/01-architecture/ADR-0005-graphite-design-system.md](./docs/01-architecture/ADR-0005-graphite-design-system.md) | 「石墨」设计系统：去掉 AI 感（Galaxy 组件 + Taste Skill 准则；rc.11 起） |
| [docs/01-architecture/ADR-0004-editing-handoff.md](./docs/01-architecture/ADR-0004-editing-handoff.md) | 剪辑工坊：1.0 交付 Shotcut / MLT 剪辑工程，OpenReel 嵌入延后 |
| [docs/02-roadmap/roadmap.md](./docs/02-roadmap/roadmap.md) | 版本规划与里程碑 |
| [docs/02-roadmap/optimization-plan-2026-11.md](./docs/02-roadmap/optimization-plan-2026-11.md) | 优化方案（2026-11）：流畅、灵活、兼容、提示词与 Skill 的目标与 rc.14–rc.19 安排 |
| [docs/02-roadmap/build-matrix.md](./docs/02-roadmap/build-matrix.md) | Win / Linux / WebUI 构建计划 |
| [docs/03-guide/canvas-basics.md](./docs/03-guide/canvas-basics.md) | 使用指南：添加与编辑节点、画布助手、多模型对比、我的画布、提示词库、撤销 / 复制粘贴 / 右键菜单、快捷键、运行前检查与出错处理 |
| [docs/03-guide/model-profiles.md](./docs/03-guide/model-profiles.md) | 使用指南：添加模型与测试连接、提示词反推与反推 Skill、图片/视频/语音生成、费用预估 |
| [docs/03-guide/model-providers.md](./docs/03-guide/model-providers.md) | 使用指南：接入各家服务商（火山方舟、百炼万相、可灵、MiniMax、智谱、硅基流动、Runway、ElevenLabs、Gemini…）与参数怎么传 |
| [docs/03-guide/director-skills.md](./docs/03-guide/director-skills.md) | 使用指南：导演 Skill、分镜展开、快速添加 |
| [docs/03-guide/agent-mcp.md](./docs/03-guide/agent-mcp.md) | 使用指南：让 Claude Code 等 Agent 操作画布（MCP）：桌面版一条命令导入、WebUI / 多人网站用 HTTP + 密钥、工具列表、费用确认与安全 |
| [docs/03-guide/video-and-export.md](./docs/03-guide/video-and-export.md) | 使用指南：FFmpeg、视频提示词反推、导出成片、剪辑工程 |
| [docs/03-guide/projects-and-desktop.md](./docs/03-guide/projects-and-desktop.md) | 使用指南：项目包、桌面版数据与 API Key 保护、WebUI / Docker 部署、安全部署清单、数据备份与恢复 |
| [docs/03-guide/saas-deployment.md](./docs/03-guide/saas-deployment.md) | 使用指南：部署成多人使用的网站（注册登录、每人独立空间、管理命令、安全设计） |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | 第三方依赖与借鉴来源登记 |
| [CHANGELOG.md](./CHANGELOG.md) | 变更记录（中文） |
| [CHANGELOG.en.md](./CHANGELOG.en.md) | Release notes (English) |

## 快速开始（开发）

需要 Node ≥ 22.13、pnpm 10。

```bash
pnpm install
pnpm dev                 # server :8787 + web :5173（web 代理 /api）
pnpm build && pnpm start # 构建后单进程运行：http://127.0.0.1:8787
pnpm test && pnpm typecheck
pnpm desktop:dev         # Electron 桌面壳（需 pnpm build 产物）
pnpm desktop:package     # 当前系统的安装包（Linux: AppImage + deb；Windows 请用 CI）
```

WebUI 容器部署：复制 `.env.example` 为 `.env` 并设置 `HZC_TOKEN`，然后 `docker compose up -d --build`。
服务端在非回环地址监听时**必须**设置 `HZC_TOKEN`，否则拒绝启动。

## 工作方式

- 每完成一个独立步骤就提交一次，并同步到远端开发分支 `claude/haizhu-infinity-canvas-research-m939uc`。
- 版本号遵循 SemVer，预发布标签：`v1.0.0-beta.N` → `v1.0.0-rc.N` → `v1.0.0`。
