# 02 · 许可证审计

目的：在写第一行业务代码之前，划清「哪些可以直接依赖/复用」「哪些只能借鉴思路」，避免日后被迫改许可证或下架。

核对方式：直接读取各仓库默认分支上的 LICENSE 文件首部（2026-11-05）。未能读到正文的已标 ⚠️。

## 规则

| 级别 | 许可证 | 做法 |
| --- | --- | --- |
| 🟢 可依赖、可改 | MIT / Apache-2.0 / BSD / ISC | 可直接依赖、复制修改。保留版权声明，登记到 `THIRD_PARTY_NOTICES.md`；Apache-2.0 注意保留 NOTICE |
| 🟡 有条件 | MPL-2.0（文件级 copyleft）、LGPL（FFmpeg 默认） | 作为独立依赖/独立进程使用；若修改了其源文件需公开这些修改；FFmpeg 以**独立可执行文件**方式调用，不静态链接 |
| 🔴 只借鉴思路，不抄代码 | GPL-3.0 / AGPL / 无许可证 | 不复制、不依赖进我们的二进制。若是独立服务，只通过 HTTP/WebSocket 调用 |
| ⛔ 不使用 | 带生产授权限制的源码可见许可（tldraw）、限制衍生品的许可（Remotion）、非商用模型 | 不纳入核心依赖 |

## 逐项结论

| 项目 | 许可证（实测） | 结论 |
| --- | --- | --- |
| @xyflow/react | MIT | 🟢 画布底座 |
| Excalidraw | MIT | 🟢 备选（标注/蒙版） |
| Konva | MIT | 🟢 备选（裁剪/蒙版） |
| Electron | MIT | 🟢 桌面壳 |
| ZeroLu/open-canvas | MIT | 🟢 可参考/摘取（登记来源） |
| fancyboi999/Loomic | MIT | 🟢 可参考/摘取（登记来源） |
| saihhold-zhao/polox_ai | MIT | 🟢 可参考/摘取（登记来源） |
| Augani/openreel-video | MIT | 🟢 剪辑工坊候选 |
| OpenCut-app/OpenCut | MIT | 🟢 观察（重写中） |
| ffmpeg.wasm（封装层） | MIT | 🟢（FFmpeg 本体另见下） |
| LangGraph / Ollama | MIT | 🟢 |
| LiteLLM | MIT（`enterprise/` 目录为另一许可） | 🟢 但避开 enterprise 目录；暂不引入 |
| Mediabunny | MPL-2.0 | 🟡 作为依赖可用，勿魔改其源文件 |
| FFmpeg 本体 | LGPL-2.1+（默认）/ GPL（启用 x264/x265 等） | 🟡 独立可执行文件分发；优先使用 LGPL 构建；H.264 编码用硬件编码器或评估 GPL 影响。**发布前必须专项复核** |
| Tauri | ⚠️ 仅确认存在 `LICENSE.spdx`，通常为 MIT/Apache-2.0 | 🟢（备选，待复核） |
| ComfyUI | GPL-3.0 | 🔴 只通过 HTTP/WS 调用，不引入代码 |
| Tapnow-Studio | GPL-3.0 | 🔴 只读功能灵感，**不复制任何代码** |
| flowboard（crisng95） | 无 LICENSE 文件 | 🔴 默认视为保留所有权利，不使用 |
| tldraw | 自有许可：生产环境需 License Key | ⛔ |
| Remotion | 自有许可：>3 人营利公司需付费；禁止衍生品再授权 | ⛔ 不作核心依赖 |
| Wan2.1 / LTX-Video 代码 | Apache-2.0 | 🟢（权重许可单独核对，不随包分发） |
| HunyuanVideo | 腾讯社区许可（排除欧盟/英国/韩国） | ⛔ 不内置，用户自行承担 |
| Kokoro / CosyVoice / Chatterbox | Apache-2.0 / Apache-2.0 / MIT | 🟢 推荐的内置建议 TTS |
| IndexTTS-2 / Fish Speech / XTTS v2 | ⚠️ 二手来源称非商用或受限 | ⛔ 不内置推荐；用户自带 API 可用 |

## beta.4 新增

| 项目 | 许可证（实测） | 结论 |
| --- | --- | --- |
| GSAP 3.15 | GSAP Standard "No Charge" License（Webflow，2025-04-30 起；**不是 OSI 开源许可**） | 🟡 有条件使用，见下 |
| uiverse-io/galaxy（Galaxy） | MIT（仓库 LICENSE 实测；作者希望署名） | 🟢 摘取 3 个片段并改写，已在 THIRD_PARTY_NOTICES 署名 |
| Leonxlnx/taste-skill（Taste Skill） | MIT（仓库 LICENSE 实测） | 🟢 只作为设计准则参考，未复制代码 |
| Geist / Geist Mono（@fontsource-variable） | OFL-1.1 | 🟢 字体随包分发，保留许可 |
| yaml | ISC | 🟢 |

### GSAP 的使用边界（必须遵守）

许可证原文（读取自 ScanCode LicenseDB 收录的 `gsap-standard-no-charge-2025` 全文）：

- 允许（Permitted Uses）：在任何网站、Web 应用或数字界面中实现和使用 GSAP。
- 禁止（Prohibited Uses）：在「允许用户无需写代码即可制作视觉动画」的工具中使用 GSAP，且该工具与 Webflow 的视觉动画制作能力构成竞争。
- Webflow 可在不遵守条款时终止许可；条款可被单方修改。

我们的规则：

1. GSAP **只**用于本应用自身界面的反馈动效（节点出现、弹窗、成功提示）。唯一引用处是 `apps/web/src/motion.ts`。
2. **不得**用 GSAP 实现任何面向用户的「动画制作」功能，例如剪辑工坊里的关键帧动画、文字动效模板、转场编辑器。这些功能必须用其他库（如 Motion，MIT）或自研。
3. 如果将来以开源许可发布源码，GSAP 不随源码重新授权；需要在发布说明里写明它的独立许可。
4. 若 Webflow 修改条款导致不再适用，只需替换 `motion.ts` 一个文件。

## 对我们自己许可证的约束

1. 因为没有引入任何 GPL/AGPL 代码，我们日后**可以自由选择**闭源商业、源码可见或 MIT/Apache 开源。
2. 我们**不分发**模型权重、不分发含 GPL 编码器的 FFmpeg（除非专项评估通过）。
3. 任何外部代码摘取必须在 `THIRD_PARTY_NOTICES.md` 登记：来源 URL、提交哈希、许可证、改动说明。
4. 与 GPL 服务（ComfyUI）的集成严格限于网络 API，且作为可选 provider，默认不启用。

> 以上为工程层面的合规整理，不构成法律意见。正式发布（尤其含 FFmpeg 的安装包）前建议做一次人工法务复核。
