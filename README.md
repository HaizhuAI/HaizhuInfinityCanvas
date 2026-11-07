# Haizhu Infinity Canvas（海柱无限画布）

> 面向「创作类智能体」的无限画布创作工坊。把你预先配置好的**视频模型、图片模型、视觉分析模型、文本模型、TTS 语音模型、导演 Skill** 做成图标，拖进画布、连线成"智能体团队"，一键跑出分镜、图片、视频、配音，并导出成片。

- 当前版本：**v1.0.0-rc.4**（候选版，尚未打 tag；安装包见 GitHub Actions 的「Build installers」产物）
- 源码状态：**公开仓库（源码可见）**，但尚未授予开源许可，保留所有权利（见 [LICENSE](./LICENSE)）
- 目标平台：WebUI（浏览器/Docker）· Windows 桌面版 · Linux 桌面版

## 核心理念

1. **模型即图标**：在「设置 → 模型档案」里配好一次（接口地址、Key、模型名、默认参数），它就成为侧边栏里的一个可拖拽图标。
2. **连线即工作流**：节点有类型化端口（文本 / 图片 / 视频 / 音频 / 分镜 JSON），不兼容的线拉不出来；上游输出自动注入下游。
3. **导演 Skill**：采用开放的 Agent Skills（`SKILL.md`）格式，导演 Skill 读剧本/创意 → 输出分镜 → 扇出成多个图片/视频节点。
4. **反推闭环**：图片提示词反推、视频提示词反推（抽帧 + 视觉模型 → 镜头表），结果可直接喂给生成节点。
5. **成片导出 + 剪辑工程**：画布内容 → FFmpeg 合成成片（拼接、配音、软字幕）；同时可导出与成片一致的 MLT 剪辑工程，用开源剪辑软件 Shotcut 在时间线上精修。
6. **本地优先 + 自带 Key**：项目与素材存本地，API Key 加密保存（桌面版的加密密钥交给系统钥匙串），成本透明、失败不乱扣费。
7. **项目包**：一个 `.hzc` 文件带走画布、素材与全部生成结果，换电脑或备份都不丢。

> 视频反推与导出成片需要系统安装 FFmpeg（应用不内置），见[视频指南](./docs/03-guide/video-and-export.md)。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [docs/00-research/01-landscape.md](./docs/00-research/01-landscape.md) | 竞品与开源项目调研 |
| [docs/00-research/02-license-audit.md](./docs/00-research/02-license-audit.md) | 许可证审计：哪些能用、哪些只能借鉴思路 |
| [docs/00-research/03-feasibility.md](./docs/00-research/03-feasibility.md) | 可行性结论与风险清单 |
| [docs/00-research/04-kaworkai-reference.md](./docs/00-research/04-kaworkai-reference.md) | 参考调研：咔作画布的交互思路，借鉴了什么、没有引入什么 |
| [docs/01-architecture/ADR-0001-tech-stack.md](./docs/01-architecture/ADR-0001-tech-stack.md) | 技术选型决策记录 |
| [docs/01-architecture/ADR-0002-ui-design-system.md](./docs/01-architecture/ADR-0002-ui-design-system.md) | 动效决策（GSAP / Galaxy / Taste Skill；配色与布局已由 ADR-0003 取代） |
| [docs/01-architecture/ADR-0003-studio-design-system.md](./docs/01-architecture/ADR-0003-studio-design-system.md) | 「工作室」设计系统：面向图片 / 视频创作者的内容优先界面（UI-UX-Pro-Max） |
| [docs/01-architecture/ADR-0004-editing-handoff.md](./docs/01-architecture/ADR-0004-editing-handoff.md) | 剪辑工坊：1.0 交付 Shotcut / MLT 剪辑工程，OpenReel 嵌入延后 |
| [docs/02-roadmap/roadmap.md](./docs/02-roadmap/roadmap.md) | 版本规划与里程碑 |
| [docs/02-roadmap/build-matrix.md](./docs/02-roadmap/build-matrix.md) | Win / Linux / WebUI 构建计划 |
| [docs/03-guide/canvas-basics.md](./docs/03-guide/canvas-basics.md) | 使用指南：添加与编辑节点、画布助手、我的画布、提示词库、撤销 / 复制粘贴 / 右键菜单、快捷键、运行前检查与出错处理 |
| [docs/03-guide/model-profiles.md](./docs/03-guide/model-profiles.md) | 使用指南：添加模型与测试连接、提示词反推、图片/视频/语音生成、费用预估 |
| [docs/03-guide/director-skills.md](./docs/03-guide/director-skills.md) | 使用指南：导演 Skill、分镜展开、快速添加 |
| [docs/03-guide/video-and-export.md](./docs/03-guide/video-and-export.md) | 使用指南：FFmpeg、视频提示词反推、导出成片、剪辑工程 |
| [docs/03-guide/projects-and-desktop.md](./docs/03-guide/projects-and-desktop.md) | 使用指南：项目包、桌面版数据与 API Key 保护、WebUI / Docker 部署 |
| [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) | 第三方依赖与借鉴来源登记 |
| [CHANGELOG.md](./CHANGELOG.md) | 变更记录 |

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
