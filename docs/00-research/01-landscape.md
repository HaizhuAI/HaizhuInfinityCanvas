# 01 · 竞品与开源项目调研

> 调研日期：2026-11-05。方法：WebSearch + 直接读取各仓库 `LICENSE` / `README`（raw.githubusercontent.com）。
> 标注 ✅ 为本次亲自核对过的一手信息；标注 ⚠️ 为二手/博客信息，落地前需复核。

## 1. 行业范式结论

「无限画布 + 类型化端口 + 连线即工作流」已经是 2025–2026 年 AI 创作工具的收敛形态（Flora、Krea Nodes、Freepik Spaces、Recraft、LibTV、TapNow 都在这条路上）。⚠️ 来源：开源仓库 `sfex1320/momo-canvas` 内的《竞品分析》（2026-07-20，作者自述）。

对 Haizhu Infinity Canvas 的启示：

| 趋势 | 我们的对应设计 |
| --- | --- |
| 节点画布 + 类型安全连线 | 端口类型：text / image / video / audio / storyboard(JSON)，不兼容不让连 |
| 下一战场是「Agent 搭工作流」 | 导演 Skill 输出分镜后自动扇出节点；后续版本加画布内对话 Agent |
| 工作流分两级消费：专业者搭图，普通人用表单 | 「选中一组节点 → 打包为模板」，模板可作为一个图标再拖入 |
| 成本透明是口碑生死线（失败扣费是最大差评） | 运行前成本预估；任务失败/取消不重复计费的提示；本地 + 自带 Key |
| 一致性：角色/主体资产化 | 角色卡/主体库作为一等资产节点（v1.1+） |
| 可靠性 > 功能数 | 任务队列持久化、中断可恢复、结果可复现（节点保存参数快照） |
| 同提示词多模型 A/B | 同一上游接多个模型节点并排对比（Weavy 做法） |
| 只做「画布+生图」单点形态会死（Visual Electric 已关停） | 必须叠加：视频、TTS、导演、导出的全链路纵深 |

## 2. 商业产品（只借鉴交互与产品思路，不涉及代码）

| 产品 | 形态 | 可借鉴点 |
| --- | --- | --- |
| LibTV（LiblibAI，2026-03）⚠️ | 无限画布 + 节点，文本/图/视频/音频/脚本 5 类节点；接 30+ 模型 | `/` 斜杠命令（九宫格分镜、角色三视图）、框选「聚焦」作为参考、工作流打组→模板→Skill、画布内剪视频 |
| TapNow ⚠️ | Tapflow 节点工作区，偏电商/营销 | 参考广告一键拆分镜 |
| 即梦 AI（字节）⚠️ | 图层画布 + 自由画布 + 右侧 Agent 对话 | 框选局部重绘并一次出 2–4 候选；画布↔对话双向拖拽 |
| 可灵 AI（快手）⚠️ | 无画布，工具页 | 多图参考框选主体、运动笔刷、主体库（脸+音色绑定） |
| Krea / Flora / Weavy / Freepik Spaces ⚠️ | 节点画布 | 运行前成本预估、Ctrl+F 搜节点、Spotlight 添加节点、模板播种空画布 |
| Lovart ⚠️ | 设计 Agent 对话式 | 对话驱动画布编辑 |

## 3. 开源项目（可直接参考/部分复用的）

下表「许可证」为本次读取各仓库 LICENSE 文件首部所得 ✅。

| 项目 | 许可证 | 栈 | 价值 | 对我们的用法 |
| --- | --- | --- | --- | --- |
| **ZeroLu/open-canvas** | MIT ✅ | Next.js，local-first，JSON 落盘，BYOK（Cyberbara/OpenRouter/Replicate），上游输出自动注入下游 | 与我们目标最接近的「干净」起点：图模型、provider 抽象、存储抽象 | 借鉴其图模型与 provider/storage 接口设计；**不整仓 fork**（Next.js 不利于桌面打包，且自述 alpha） |
| **fancyboi999/Loomic** | MIT ✅ | Next.js + Fastify + LangGraph + Supabase + Excalidraw + Turborepo | 对话式画布 Agent、Markdown 技能系统、异步生图/视频 Worker 架构 | 借鉴「Agent + Skill + Worker 队列」分层；其 Supabase/付费积分部分不需要 |
| **saihhold-zhao/polox_ai (PoloX)** | MIT ✅ | Nuxt + Vue + SQLite，WaveSpeed API | 本地运行的多模态创作台，Agent 视频模型选择卡、资产库、技能页 | 借鉴「模型选择卡 + 推荐最便宜可用」「资产库抽屉」交互 |
| **Anil-matcha/Open-AI-Design-Agent** | MIT ✅ | 自托管设计 Agent | 海报/广告物料自动化 | 仅参考，定位偏设计 |
| **TG8848/Tapnow-Studio** | **GPL-3.0** ✅ | 单文件 HTML | 视频拆解/提示词反推、智能分镜表、镜头卡片——**功能与我们高度重合** | ⛔ **只读不抄**：GPL 传染，复制代码会迫使我们分发时整体 GPL。仅作功能灵感，独立实现 |
| **crisng95/flowboard** ⚠️ | 未找到 LICENSE 文件 | 依赖 Google Flow + Chrome 扩展桥 | 产品视频节点流 | 许可证不明 + 依赖第三方登录态，不使用 |
| **OpenCut-app/OpenCut** | MIT ✅ | 正在重写（Rust 核心 + Web/桌面/移动，计划含 Editor API、插件、MCP、headless） | 未来最理想的「剪辑工坊」内核；但重写期不稳定 | 观察；经典版在 `opencut-app/opencut-classic` |
| **Augani/openreel-video (OpenReel)** | MIT ✅ | React + TS + WebCodecs + WebGPU，浏览器/桌面（Win/Linux/mac alpha），含 AI 编辑器与 MCP | 现成的时间轴剪辑器，含字幕/音频/调色/导出 | **首选剪辑工坊候选**：以独立应用/iframe/子路由方式集成，v1.0.0-beta.6 做集成验证 |
| **floomhq/opencut** | MIT ✅ | 基于 Remotion 的代码驱动视频引擎 | AI 视频生产引擎 | 注意其依赖 Remotion，受 Remotion 许可证约束（见许可证审计） |
| **Comfy-Org/ComfyUI** | **GPL-3.0** ✅ | Python，HTTP/WebSocket API | 本地生图/视频模型生态最大 | ✅ 只通过网络 API 调用（不引入其代码）；作为可选 provider 适配器 |

## 4. 底座与组件库

| 组件 | 许可证 | 结论 |
| --- | --- | --- |
| **@xyflow/react (React Flow)** | MIT ✅ | ★ 选为画布底座：节点/连线/端口/小地图/框选内建；节点是 DOM，可塞富 UI（预览视频、播放器、表单） |
| tldraw | 自有许可证 ✅：**生产环境须有 License Key，不得在生产使用**（开发环境可）；另有商业/爱好许可 | ✖ 不选：闭源分发会触发商业授权 |
| Excalidraw | MIT ✅ | 自由绘图很强，但不是节点图模型；保留作为「标注/蒙版绘制」子组件候选 |
| Konva | MIT ✅ | 低层 Canvas2D，需自行实现节点图；用于未来的蒙版/裁剪编辑器 |
| Remotion | 自有许可证 ✅：个人/≤3 人营利公司/非营利免费，更大公司需购买；**禁止复制修改以售卖/再授权其衍生品** | ✖ 不作为核心依赖：我们要分发产品 |
| ffmpeg.wasm | MIT ✅（封装；FFmpeg 本体 LGPL/GPL 取决于编译选项） | 浏览器端轻量处理候选 |
| Mediabunny | **MPL-2.0** ✅ | 可用（文件级 copyleft，修改其文件需回馈）；WebCodecs 读写封装候选 |
| Electron | MIT ✅ | ★ 选为桌面壳（见 ADR-0001） |
| Tauri | MIT/Apache-2.0（⚠️ 本次仅确认存在 LICENSE.spdx，未读正文） | 备选；Linux WebKitGTK 的媒体能力有不确定性，见 ADR |
| LangGraph | MIT ✅ | 可选：画布内 Agent 编排（v1.2） |
| LiteLLM | MIT（`enterprise/` 目录除外）✅ | 可选：统一 LLM 网关；但引入 Python，先不用 |
| Ollama | MIT ✅ | 本地 LLM/VLM provider |

## 5. 模型生态（决定 provider 适配器的优先级）

**视觉分析 / 提示词反推**（⚠️ 来源：搜索结果，未逐一验证许可证）：Florence-2（结构化一致的 caption）、JoyCaption（创意/带提示 caption）、Qwen2.5-VL（质量最高）。用户自带的任意 OpenAI 兼容视觉模型同样适用——这是**默认路径**，本地模型是可选路径。

**视频生成**：开源权重——Wan2.1（Apache-2.0 ✅）、LTX-Video（Apache-2.0 ✅，代码；权重许可需另核）、HunyuanVideo（腾讯社区许可 ✅，**排除欧盟/英国/韩国**）。闭源 API——Veo、Kling、Seedance、Sora、Hailuo 等，通常经 Replicate / fal.ai / WaveSpeed 等聚合网关访问（⚠️ Loomic、PoloX、Open Canvas 的 README 均如此做）。

**TTS**：
- 可商用、许可宽松 ✅：Kokoro（Apache-2.0）、CosyVoice（Apache-2.0，代码）、Chatterbox（MIT）
- ⚠️ 需谨慎（二手来源称非商用/受限）：IndexTTS-2、Fish Speech(OpenAudio S1-mini，CC-BY-NC-SA)、XTTS v2(CPML)
- 云 TTS 通过 OpenAI 兼容 `/v1/audio/speech` 接口接入即可。

> 注意：**模型权重许可证 ≠ 代码许可证**。我们不随安装包分发任何模型权重；用户自行下载/自带 API，责任边界在文档中写明。

## 6. 调研中发现的关键事实（影响决策）

1. 没有一个现成开源项目同时具备「节点画布 + 多模型 + TTS + 导演 Skill + 视频反推 + 剪辑导出」。最接近的 Tapnow 是 GPL；Open Canvas / Loomic / PoloX 是 MIT 但各缺一部分。→ **必须自建整合层，而不是 fork 单一项目**。
2. 视频反推/分镜这块功能价值已被 Tapnow、LibTV 验证，但我们只能独立实现。
3. 剪辑工坊不要自己从零写时间轴：OpenReel（MIT，已有 Win/Linux 桌面 alpha）是现成资源。
