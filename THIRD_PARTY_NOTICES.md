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
| @fontsource-variable/geist、@fontsource-variable/geist-mono | OFL-1.1 | 界面字体，随包打包（rc.11 起 Geist 重新作为正文字体，Inter 已移除） | beta.4 |
| yaml | ISC | 解析 SKILL.md 的 YAML frontmatter | beta.4 |
| nodemailer | MIT-0 | 账号模式下发送「找回密码」邮件（可选，配置了 HZC_SMTP_URL 才使用） | rc.12 |
| FFmpeg（独立可执行文件） | LGPL-2.1+ / GPL（视编译选项） | 抽帧/合成。**桌面安装包不包含**，使用用户自己安装的 FFmpeg；Docker 镜像内为 Debian 软件包 | beta.5 |

### 外部工具（不随产品分发）

| 工具 | 许可证 | 关系 |
| --- | --- | --- |
| Shotcut | GPL-3.0 | 用户自行安装，用来打开我们导出的剪辑工程（MLT XML 数据文件） |
| MLT 框架 / `melt` 命令行 | 框架 LGPL-2.1+，`melt` 命令行 GPL-2.0+（Debian 版权文件实测） | 仅在 CI 中安装，用于测试导出的剪辑工程能否正确渲染；不分发、不链接 |

### 用户自行导入的 Skill（不随产品分发）

| Skill | 许可证 | 关系 |
| --- | --- | --- |
| [LunarXuan/image-prompt-reverse](https://github.com/LunarXuan/image-prompt-reverse) | GPL-3.0 | 可在「设置 → Skill」用 GitHub 链接或 zip 导入，用作图片反推节点的反推方式。由用户从作者处下载到自己的电脑；本仓库与安装包**不包含**它的任何文件 |

## B. 摘取代码登记

| 日期 | 本仓库文件 | 来源仓库 / 提交 | 许可证 | 改动说明 |
| --- | --- | --- | --- | --- |
| 2026-11-05 | `apps/web/src/styles.css`（`.btn.running`） | [uiverse-io/galaxy](https://github.com/uiverse-io/galaxy) `Buttons/Shashvhat_moody-moth-69.html`，作者 Shashvhat（main 分支，2026-11-05） | MIT | 保留「四边边框颜色循环」的做法；去掉旋转与放大（Taste Skill：不倾斜）；颜色换成本项目的端口色。**rc.11 已移除，由下方 rc.11 行取代** |
| 2026-11-05 | `apps/web/src/styles.css`（`.orbit`） | 同上 `loaders/Cornerstone-04_ugly-rattlesnake-41.html`，作者 Cornerstone-04 | MIT | 三层反向旋转弧线；缩小到图标尺寸，颜色换成端口色，可通过 `--s` 调尺寸。**rc.11 已移除，由下方 rc.11 行取代** |
| 2026-11-05 | `apps/web/src/styles.css`（`.switch`） | 同上 `Toggle-switches/ICe1BotMaker_quick-goat-3.html`，作者 ICe1BotMaker | MIT | 复选框改为可聚焦的视觉隐藏（原为 display:none，键盘无法操作），增加焦点环，改用设计令牌。**rc.11 已移除，由下方 rc.11 行取代** |

| 2026-11-12 | `apps/web/src/styles.css`（`.chips` / `.seg2`，分段选择） | [uiverse-io/galaxy](https://github.com/uiverse-io/galaxy) `Radio-buttons/andrew-demchenk0_stupid-seahorse-9.html`，作者 andrew-demchenk0（提交 adbd2ad，2026-11-12） | MIT | 保留「一条底轨、选中项为实心块」的结构；改用本项目令牌（选中为墨色块）、去掉阴影，键盘可操作 |
| 2026-11-12 | `apps/web/src/styles.css`（`.switch`） | 同上 `Toggle-switches/The-Best-Codes_bright-rabbit-33.html`，作者 The-Best-Codes | MIT | 平面轨道 + 纯色滑块，无阴影；开启时轨道为强调色；隐藏的复选框可聚焦，焦点环 |
| 2026-11-12 | `apps/web/src/styles.css`（`.link`） | 同上 `Buttons/MuhammadHasann_happy-cobra-7.html`，作者 MuhammadHasann | MIT | 悬停时下划线从左向右画出；改为背景尺寸动画，颜色跟随文字 |
| 2026-11-12 | `apps/web/src/styles.css`（`.rail-btn .tip`，提示） | 同上 `Tooltips/SouravBandyopadhyay_ugly-pug-52.html`，作者 SouravBandyopadhyay | MIT | 纯色深底文字标签；改为墨色底、无阴影、无动画位移 |
| 2026-11-12 | `apps/web/src/styles.css`（`.ftoolbar`，画布底部工具条） | 同上 `Tooltips/csemszepp_ordinary-owl-54.html`，作者 csemszepp | MIT | 一条不透明的图标条，细分隔线；去掉半透明与模糊 |
| 2026-11-12 | `apps/web/src/styles.css`（`.node.st-running::before`、`.frame.running::after`，运行进度条） | 同上 `loaders/SteveBloX_wise-moose-53.html`，作者 SteveBloX | MIT | 细进度条的轨道与填充；改为不确定进度（来回移动的强调色段） |
| 2026-11-12 | `apps/web/src/styles.css`（`.orbit`，刻度加载器） | 同上 `loaders/elijahgummer_chatty-rattlesnake-90.html`，作者 elijahgummer | MIT | 十二道刻度依次变亮；改为一个圆锥渐变 + 遮罩实现，颜色跟随文字，`--s` 调尺寸 |
| 2026-11-12 | `apps/web/src/styles.css`（`.cmp-pick input`、`input.box`，复选框） | 同上 `Checkboxes/IndexOC_moody-mouse-53.html`，作者 IndexOC | MIT | 方形框、选中时墨色填充 + 对勾；改用本项目令牌与焦点环 |
| 2026-11-12 | `apps/web/src/App.tsx`（画布网格背景） | 同上 `Patterns/adamgiebl_curvy-earwig-79.html`，作者 adamgiebl | MIT | 细线网格；用 React Flow 的两层线条背景重新实现（每 5 格一条稍深的线），随画布平移缩放 |
| 2026-11-12 | `apps/web/src/styles.css`（`:root` 深色令牌） | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill/library/palettes.json`「Graphite and orange」 | MIT | 底色 `#18191b`、文字 `#eff0f1`、次要文字 `#9c9ea3`、强调色 `#ff4a1f` 四个色值；其余层级与浅色主题按同一思路自行推导 |
| 2026-11-13 | `apps/server/skills/short-drama-storyboard/references/`（shot-writing.md、seedance-prompt.md、h3-prompt.md）、同目录 `LICENSE`、`NOTICE` | [eternityspring/shuohao-skills](https://github.com/eternityspring/shuohao-skills) `skills/novel-storyboard/references/`，作者 烁皓（提交 8af10e0） | Apache-2.0 | 原文照录，每个文件开头加一行来源说明；随内置的「短剧分镜（shuohao）」导演 Skill 一起分发。`SKILL.md` 是本项目按画布的分镜格式自行撰写的改编说明 |
| 2026-11-13 | `packages/core/src/drama.ts`（`subjectRefViews`、`seedanceSegmentPrompt`、景别 / 运镜 / 稳定性词表、动漫与写实画风文字、`SEEDANCE_NO_SUBTITLES` / `SEEDANCE_NO_TWINS`） | 同上 `skills/character-refs/scripts/core.mjs`、`looks.mjs`，`skills/novel-storyboard/scripts/novel-storyboard.mjs`（提交 8af10e0） | Apache-2.0 | 视图提示词：原 skill 按结构化角色字段拼（含性别代词），这里改为一段自由描述 + 中性代词，比例改用画布支持的 3:4；新增物品与场景的参考图组。Seedance 段提示词：保留结构与符号规范，参考图标签改为画布上的分镜图节点。导入器（`dramaToGraph`）为本项目自行编写，读取原 skill 的 JSON 格式 |
| 2026-11-13 | `packages/core/src/promptGuides.ts`（seedance、hailuo-h3 两组写法规则） | 同上 `skills/novel-storyboard/references/` | Apache-2.0 | 把原文要点改写成简短的中文规则，供「优化提示词」使用 |
| 2026-11-13 | `e2e/fixtures/shuohao-dukou/`（outline / cast / art / script / storyboard.json、LICENSE、NOTICE） | 同上 `skills/novel-storyboard/references/test-fixtures/upstream/`、`examples/渡口-storyboard.json` | Apache-2.0 | 原样拷贝的测试样例（原创故事《渡口》），只用于测试导入，不随产品分发 |
| 2026-11-13 | `packages/core/src/imageTools.ts`（`ANGLE_PRESETS`、`buildAnglePrompt`、`RELIGHT_PRESETS`、`buildRelightPrompt` 与光位描述） | [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) `packages/nodes/imageNode/src/imageMultiAngle.ts`、`imageLighting.ts`（提交 6086cdf），Copyright (c) 2026 HBAI-Ltd | MIT | 坐标系、预设与提示词措辞沿用原文；`{{ref 1}}` 改为 "the reference image"（画布把连入的图作为唯一参考图发送），去掉了只供原界面使用的字段（智能模式开关、元数据标记），预设颜色字段改名。许可文本见下方「MIT（Toonflow）」 |
| 2026-11-13 | `packages/core/src/videoCaps.ts`（Seedance 2.0 / 2.5、MiniMax H3 的可选时长、分辨率、参考图上限） | 同上 `packages/providers/src/media/apiMart.ts`、`compshare.ts`、`metaso.ts` 的模型表 | MIT | 只取两家以上供应商定义一致的数值（事实数据），代码为本项目自行编写 |

## C. 仅借鉴思路（未复制代码）

| 项目 | 许可证 | 借鉴内容 |
| --- | --- | --- |
| ZeroLu/open-canvas | MIT | 图模型、provider/存储接口分层、上游输出注入下游的执行规则 |
| fancyboi999/Loomic | MIT | Agent + Skill + 异步 Worker 分层 |
| saihhold-zhao/polox_ai | MIT | 视频模型选择卡、资产库抽屉 |
| nextlevelbuilder/ui-ux-pro-max-skill（UI-UX-Pro-Max） | MIT | beta.5 工作室界面：按其「照片编辑 / 短视频编辑 / 生成艺术 / 绘画画布」产品档案选定中性深灰 + 内容优先风格、粉色强调色、Inter 字体（#60 Modern Dark Cinema）；按其 UX 规则与交付前清单检查对比度、焦点、图标一致性与减少动态效果；未复制其代码或数据 |
| Leonxlnx/taste-skill（Taste Skill） | MIT | rc.11「去 AI 感」重做：一套系统、界面 90–95% 中性、只有一个强调色、无发光 / 渐变按钮 / 毛玻璃 / 字距大写标签 / 编号步骤、首页一屏一节与平实文案（用其 copy-lint 检查首页文字）。beta.4 界面重做的设计准则：一套系统（一对按钮、一种卡片、一套圆角）、不用紫色、克制的悬停/按下反馈、不倾斜、尊重减少动态效果、多宽度真实浏览器检查；未复制其代码或素材 |
| HBAI-Ltd/Toonflow-app | MIT（当前版本） | rc.20：「逐帧拉片」把关键帧、片段与原音轨落到画布（本项目用自己的 FFmpeg 镜头检测重新实现，见 `apps/server/src/shots.ts`）、宫格切分、按模型变化的视频时长 / 分辨率 / 生成音频、为外部 Agent 导出 Skill；调研见 [docs/00-research/06-toonflow.md](./docs/00-research/06-toonflow.md) |
| TG8848/Tapnow-Studio | **GPL-3.0** | 仅功能灵感（视频拆解、分镜表）；**未复制任何代码** |
| LibTV / TapNow / 即梦 / 可灵 / Krea / Flora / Weavy（商业产品） | — | 仅公开的产品交互思路 |

## MIT（Toonflow）

`packages/core/src/imageTools.ts` 中改编自 Toonflow 的部分遵循以下许可：

```
MIT License

Copyright (c) 2026 HBAI-Ltd

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
