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
| FFmpeg（独立可执行文件） | LGPL-2.1+（视编译选项） | 抽帧/合成 | beta.5 |

## B. 摘取代码登记

| 日期 | 本仓库文件 | 来源仓库 / 提交 | 许可证 | 改动说明 |
| --- | --- | --- | --- | --- |
| — | — | — | — | 暂无 |

## C. 仅借鉴思路（未复制代码）

| 项目 | 许可证 | 借鉴内容 |
| --- | --- | --- |
| ZeroLu/open-canvas | MIT | 图模型、provider/存储接口分层、上游输出注入下游的执行规则 |
| fancyboi999/Loomic | MIT | Agent + Skill + 异步 Worker 分层 |
| saihhold-zhao/polox_ai | MIT | 视频模型选择卡、资产库抽屉 |
| TG8848/Tapnow-Studio | **GPL-3.0** | 仅功能灵感（视频拆解、分镜表）；**未复制任何代码** |
| LibTV / TapNow / 即梦 / 可灵 / Krea / Flora / Weavy（商业产品） | — | 仅公开的产品交互思路 |
