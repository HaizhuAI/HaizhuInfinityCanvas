# 03 · 可行性结论与风险

## 结论：**可行，建议立项**，按分阶段 beta 推进。

理由：
1. 画布底座（React Flow，MIT）成熟，节点内可嵌入预览/播放器/表单。
2. 「用户自带模型」天然规避模型成本与合规：我们只做**编排层**，模型走用户自己的 API 或本地服务。
3. 所有目标能力都有成熟的接入方式：OpenAI 兼容接口（文本/视觉/TTS/部分图片）、异步任务轮询（视频/图片网关）、ComfyUI HTTP/WS（本地生态）、FFmpeg（抽帧/合成）、Agent Skills `SKILL.md`（导演 Skill）。
4. 剪辑工坊不必自研：OpenReel（MIT）已有时间轴编辑器与 Win/Linux 桌面构建。
5. 市场验证：LibTV / TapNow / Flora / Krea 证明了需求；开源侧没有同时覆盖全链路的项目，存在整合空间。

## 需求 → 实现路径映射

| 需求 | 实现路径 | 难度 | 版本 |
| --- | --- | --- | --- |
| 无限画布、拖拽图标入画布 | React Flow + 侧边栏 HTML5 DnD / 自定义拖拽 | 低 | beta.1 |
| 预设模型（视频/视觉/文本/TTS/图片） | 「模型档案」：adapter + endpoint + key + model + 默认参数；本地加密存储 | 低 | beta.1 |
| 文本 / 视觉分析节点 | OpenAI 兼容 chat（含 image_url）、Ollama | 低 | beta.2 |
| 图片提示词反推 | 视觉节点 + 内置反推 Skill 模板（可编辑） | 低 | beta.2 |
| 图片生成 / 视频生成 | 异步任务队列 + provider 适配器（OpenAI 兼容、Replicate、fal、WaveSpeed、ComfyUI） | 中 | beta.3 |
| TTS | OpenAI 兼容 `/audio/speech`、本地 Kokoro/CosyVoice 服务、云厂商 | 低–中 | beta.4 |
| 导演 Skill | 解析 `SKILL.md`（YAML frontmatter + 指令），LLM 执行，输出结构化分镜 JSON，扇出节点 | 中 | beta.4 |
| 视频提示词反推 | FFmpeg 抽帧（场景切换检测）→ 视觉模型逐帧/分段描述 → 汇总为镜头表 | 中 | beta.5 |
| 画布导出视频 | 分镜/素材按顺序 → FFmpeg concat + 配音/字幕混流 | 中 | beta.6 |
| 开源剪辑工坊 | 集成 OpenReel（子应用）：导出时间轴工程 ↔ 画布素材互通 | 中–高 | beta.6（验证）→ 1.x |
| Win / Linux 桌面、WebUI | Electron + 同一套 Node 服务；Docker 部署 WebUI | 中 | beta.1 起骨架，beta.7 打磨 |
| 「智能体团队」自动编排 | 画布内对话 Agent 生成/修改节点图（计划审批制） | 高 | v1.2 |

## 风险清单

| # | 风险 | 级别 | 缓解 |
| --- | --- | --- | --- |
| R1 | 各视频/图片服务 API 异构且变动快 | 高 | 统一 `Provider` 接口 + 声明式参数 schema；adapter 单测 + 录制回放；优先接聚合网关 |
| R2 | 视频生成耗时长、失败率高、计费敏感 | 高 | 持久化任务队列、可恢复、取消、运行前成本预估；失败不自动重试付费调用 |
| R3 | FFmpeg 许可证（GPL 编码器）与分发 | 中 | 独立可执行文件；优先 LGPL 构建；发布前法务复核（见许可证审计） |
| R4 | 大画布性能（DOM 节点 + 视频预览） | 中 | 视口外节点卸载/降级为缩略图；视频懒加载；节点数上限提示（⚠️ 外部文章称 React Flow ~500 节点开始吃力，需自测） |
| R5 | Linux 桌面 WebView 媒体能力（WebKitGTK 对 WebCodecs/H.264 的支持不确定，⚠️ 未能核实） | 中 | 选 Electron（自带 Chromium）规避，见 ADR-0001 |
| R6 | 密钥安全 | 中 | 本地加密存储（桌面用系统 safeStorage，WebUI 用服务端加密文件）；日志脱敏；导出工程默认不含密钥 |
| R7 | 剪辑工坊集成深度不确定 | 中 | beta.6 做集成验证 spike，失败则退化为「导出 FFmpeg 成片 + 打开外部剪辑」 |
| R8 | 范围过大 | 高 | 严格按 beta 里程碑，每个 beta 都可运行、可演示；P0 只做主链路 |
| R9 | 跨平台自动化打包（Windows 安装包需在 Windows runner 构建） | 低 | GitHub Actions 矩阵：windows-latest / ubuntu-latest；本地沙箱仅做 Linux/WebUI 验证 |
| R10 | 借鉴项目许可证污染 | 中 | GPL 项目只读不抄；登记所有摘取代码 |

## 未核实项（进入对应里程碑前需实测）

- Tauri 与 WebKitGTK 的 WebCodecs/H.264 实际支持（决定是否保留 Tauri 作为 v2 备选）。
- React Flow 在含视频缩略图节点下的实际性能拐点。
- OpenReel 作为嵌入式子应用的可行性（是否能接收外部素材、导出工程格式）。
- 各候选 TTS 权重的商用条款（以官方仓库/模型卡为准）。
