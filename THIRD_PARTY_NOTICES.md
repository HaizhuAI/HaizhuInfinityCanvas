# Third-Party Notices

本文件登记：① 打进产品的第三方依赖；② 从其他项目**摘取/改写**的代码或资源；③ 仅借鉴思路、未复制代码的项目（供审计）。

规则见 [docs/00-research/02-license-audit.md](./docs/00-research/02-license-audit.md)。每次摘取代码必须在「B. 摘取代码登记」新增一行。

## A. 计划依赖（随各里程碑实际引入后更新为精确版本）

| 依赖 | 许可证 | 用途 | 引入版本 |
| --- | --- | --- | --- |
| @xyflow/react | MIT | 画布底座 | beta.1 |
| React / Vite | MIT | WebUI | beta.1 |
| Fastify | MIT | 本地服务 | beta.1 |
| Electron | MIT | 桌面壳 | beta.1 |
| lucide-react | ISC | 界面图标（随包打包，离线可用） | beta.3 |
| gsap | **GSAP Standard "No Charge" License**（非开源许可，见许可证审计） | 仅用于本应用自身界面的动效（`apps/web/src/motion.ts` 是唯一引用处） | beta.4 |
| @fontsource-variable/geist、@fontsource-variable/geist-mono | OFL-1.1 | 界面字体，随包打包 | beta.4 |
| yaml | ISC | 解析 SKILL.md 的 YAML frontmatter | beta.4 |
| FFmpeg（独立可执行文件） | LGPL-2.1+（视编译选项） | 抽帧/合成 | beta.5 |

## B. 摘取代码登记

| 日期 | 本仓库文件 | 来源仓库 / 提交 | 许可证 | 改动说明 |
| --- | --- | --- | --- | --- |
| 2026-11-05 | `apps/web/src/styles.css`（`.btn.running`） | [uiverse-io/galaxy](https://github.com/uiverse-io/galaxy) `Buttons/Shashvhat_moody-moth-69.html`，作者 Shashvhat（main 分支，2026-11-05） | MIT | 保留「四边边框颜色循环」的做法；去掉旋转与放大（Taste Skill：不倾斜）；颜色换成本项目的端口色 |
| 2026-11-05 | `apps/web/src/styles.css`（`.orbit`） | 同上 `loaders/Cornerstone-04_ugly-rattlesnake-41.html`，作者 Cornerstone-04 | MIT | 三层反向旋转弧线；缩小到图标尺寸，颜色换成端口色，可通过 `--s` 调尺寸 |
| 2026-11-05 | `apps/web/src/styles.css`（`.switch`） | 同上 `Toggle-switches/ICe1BotMaker_quick-goat-3.html`，作者 ICe1BotMaker | MIT | 复选框改为可聚焦的视觉隐藏（原为 display:none，键盘无法操作），增加焦点环，改用设计令牌 |

## C. 仅借鉴思路（未复制代码）

| 项目 | 许可证 | 借鉴内容 |
| --- | --- | --- |
| ZeroLu/open-canvas | MIT | 图模型、provider/存储接口分层、上游输出注入下游的执行规则 |
| fancyboi999/Loomic | MIT | Agent + Skill + 异步 Worker 分层 |
| saihhold-zhao/polox_ai | MIT | 视频模型选择卡、资产库抽屉 |
| Leonxlnx/taste-skill（Taste Skill） | MIT | beta.4 界面重做的设计准则：一套系统（一对按钮、一种卡片、一套圆角）、不用紫色、克制的悬停/按下反馈、不倾斜、尊重减少动态效果、多宽度真实浏览器检查；未复制其代码或素材 |
| TG8848/Tapnow-Studio | **GPL-3.0** | 仅功能灵感（视频拆解、分镜表）；**未复制任何代码** |
| LibTV / TapNow / 即梦 / 可灵 / Krea / Flora / Weavy（商业产品） | — | 仅公开的产品交互思路 |
