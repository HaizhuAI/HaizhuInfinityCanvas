# 参考调研 · 图片 / 视频创作平台（开源与闭源）

- 调研日期：2026-11-12（rc.14 之前）
- 方式：优先读官方帮助中心、文档、更新日志（Google Flow 帮助中心、Flora 文档、Krea 文档、Runway 产品页与更新日志、阿里云百炼 / 可灵 / MiniMax 官方指南、即梦 Dreamina 官方页面）；拿不到官方资料的产品用媒体报道与第三方教程补充，并在文中注明。没有注册、付费或调用这些平台的生成功能。
- 结论性质：**只借鉴交互思路与公开的写法规律**。不复制任何产品的代码、文案、图片、图标、配色或品牌，不复刻某个产品的界面外观；界面仍用本项目自己的「石墨」设计系统（ADR-0005）。
- 方案与版本安排见 [优化方案（2026-11）](../02-roadmap/optimization-plan-2026-11.md)。

## 一、调研对象一览

### 闭源平台

| 产品 | 形态 | 值得注意的交互 |
| --- | --- | --- |
| **Google Flow**（Veo / Nano Banana / Omni） | 提示词框 + 结果网格 + 场景编辑（Scenebuilder） | 提示词框里切换模型与模式（视频 / 首尾帧 / 素材「Ingredients」/ 配音）；生成前在框底设比例、每次输出数量、时长；**输入 @ 引用项目里的素材和角色**；首尾帧有两个拖放槽；「生成后清空提示词」可选；结果有网格与逐条两种视图，可框选多选；编辑片段保留原片，右侧「历史」列出每一版及其提示词；Scenebuilder 拖动排序、裁剪首尾、整段预览下载；**Extend 延长**（写续写提示、可加 3 张参考）；暂停视频「保存这一帧」作为素材或首尾帧；左侧素材按类型筛选、集合（文件夹）、角色（1–2 张图 + 名字 + 声音） |
| **即梦 / Dreamina**（Seedance、Seedream） | 无限画布 + Agent（Octo）+ 时间线 | 节点类型：文本、图片、视频、音频、主体、时间线、分组、文件；从 Agent 对话或工具栏开始；「主体」节点是可复用的人物 / 商品参考；只重跑被改节点的下游；选中片段「加入时间线」排序配乐；导出 MP4、XML 或剪映草稿（厂商宣传页，未独立验证） |
| **LibTV**（LiblibAI） | 节点式无限画布，面向人和 Agent 双入口 | 五类节点（文本、图片、视频、音频、**脚本**）；脚本节点生成**可编辑的分镜表**，勾选行后批量出分镜图、再批量出视频；斜杠命令生成九宫格 / 25 宫格分镜与角色三视图，**宫格切分**成独立节点；主体库（多角度补全 + 名字 + 声音）；Ctrl G 分组、存为工作流、**整组执行**；每个生成器底部一条参数栏（模型、风格、比例、分辨率、时长、20 多种运镜）；多个视频节点连到「视频合成」在时间线上剪；提供给 Agent 调用的 Skill API（第三方教程与媒体报道） |
| **可灵 Kling** | 网页生成 + API | 多图参考（1–4 张，框选主体）、主体参考扩展到视频、AI 智能分镜（自动安排景别机位）、自定义多镜头分镜、多语种口型同步、音画同出（第三方资料） |
| **海螺 / MiniMax H3** | API 与网页 | 首帧 / 尾帧 / 多参考（最多 9 图 3 视频 3 音频）；提示词里用 `[pan]` `[zoom]` `[static]` 写运镜；单独的「提示词增强」任务只返回改写后的提示词 |
| **Vidu** | 网页与开放平台 | 「参考生视频」多主体一致性（多图输入）；多智能体一键生成 MV（导演、分镜智能体） |
| **Runway**（Workflows / Apps / Agent） | 节点工作流 + 应用 + 自然语言 Agent | 节点：输入（文本 / 图片 / 视频）、媒体模型、**LLM 节点（提示词分析与优化、图片描述）**、音频、放大、合成；右键或左侧 + 添加；可运行整个流程或单个节点；工作流发布成团队「应用」；Agent 用一句话搭出多步流程，可检查和修改后再跑 |
| **Krea Nodes** | 节点画布 + 应用生成器 + Node Agent | 端口按数据类型着色；**从端口拖出时只列能接的节点**；节点参数写在节点里；LLM、拆行、拼接文本等工具节点；**App Builder 选择哪些参数作为应用输入**（建议 5–7 个）；Node Agent 先给出分阶段方案、每个节点的费用，确认后逐层生成；改上游只重跑下游 |
| **Flora**（FAUNA Agent） | 节点画布 + Agent + 时间线 | 双击画布加节点、拖 + 号连线；节点底部提示词栏和生成按钮，悬停显示费用；**一次运行最多 20 个变体，节点下方缩略图条挑选，选中的那张流向下游**；复核模式（左右键翻看、数字键打标签）；每次生成进节点历史，不覆盖；**Batch 节点**（拖文件、CSV、按行拆文本，交叉 N×M 或按序配对，最多 100 项并行）；Enter 运行选中节点；Agent 的「协助 / 自动」两种模式，协助模式先列出要跑的节点和费用；时间线编辑器 |
| **Figma Weave**（原 Weavy） | 节点画布 | 生成与传统编辑（合成、蒙版、重打光）在同一张图上 |
| **Freepik Spaces** | 节点画布 | 从素材库（照片、品牌资产、模板）起步，而不是空白提示词 |
| **LTX Studio** | 分镜到视频 | 分镜生成器自动建立「元素」（角色、商品、场景）在所有镜头复用；每个镜头单独提示词、运镜、角色指导后再拼接；Retake 局部重拍 |
| **Lovart / 星流 Agent** | 设计 Agent + 无限画布 | 选中画布上的对象用一句话改；选中图片时上方出现放大、扩图、抠图、擦除工具；每张图的处理记录成可追溯的流程 |
| **Higgsfield** | 预设驱动 | 大量**命名运镜预设**（推拉、环绕、FPV、子弹时间等）；Popcorn 分镜；图片预设分类（第三方资料，数量说法不一） |
| **Luma Dream Machine**（Ray3 Modify） | 视频改视频 | 改视频时设首尾关键帧、强度滑杆；角色参考锁定外貌与服装 |
| **Midjourney** | 提示词 + 网格 | 风格参考、情绪板（Moodboard）、角色 / 全能参考；一次出四张网格再挑 |
| **Adobe Firefly Boards** | 情绪板画布 | 在同一块板上调用自家和合作方模型（Veo、Runway、Luma、Pika、FLUX 等），选合作方模型时提示「非 Adobe 模型」；预设、描述图片 |
| **Leonardo** | 图片平台 | Flow State 连续出图用于发散；Blueprints 预设流程（一张商品图 → 旋转视频等） |
| OpenArt / PixVerse / Pika | 生成平台 | 角色一致性、模板化特效、按秒计费（第三方榜单，资料较少） |

### 开源项目

| 项目 | 许可证 | 值得注意的交互 |
| --- | --- | --- |
| **ComfyUI** | GPL-3.0 | 子图（Subgraph，可嵌套）收起复杂度、只露出关键参数；模板库按开源 / 闭源模型分组；**App Mode**（2026-03）：一键把工作流变成只露输入输出的界面，App Builder 选择哪些输入输出 |
| **InvokeAI** | Apache-2.0 | 统一画布（图层、局部重绘、扩图、合成）+ 节点工作流 + 社区节点 |
| **Krita AI Diffusion** | GPL-3.0 | 在绘画软件里生成、局部重绘、实时绘画，后端藏起 ComfyUI |
| **SwarmUI** | MIT | 多 GPU 后端调度，图片与视频模型（Wan、Hunyuan Video） |
| **Jaaz** | 自述开源，第三方称为「源码可见、限制商用」 | 本地部署的「设计 Agent + 无限画布」 |
| 短剧 / 漫剧流水线（huobao-drama、Toonflow、ArcReel、Jellyfish、waoowaoo、LocalMiniDrama、Seedance2-Storyboard-Generator 等） | 各异（Toonflow 为 AGPL） | 一句话 / 小说 → 剧本 → 角色设定 → 分镜 → 视频 → 合成；多智能体分工；跨镜头一致性是共同难点 |

> 以上开源项目**只参考产品形态**，不引入其代码；GPL / AGPL 项目尤其不碰（见[许可证审计](./02-license-audit.md)）。

## 二、共性模式

### A. 提示词栏与生成参数
几乎所有产品都把「模型、比例、时长、数量、参考图」放在提示词旁边，一眼看完、一次点完（Flow 的提示词框、LibTV 每个生成器底部的参数栏、Flora 节点上的提示词栏）。费用在点生成之前就能看到（Flora 悬停显示，Krea / Flora 的 Agent 先列出每个节点的费用）。
**我们的现状**：参数在右侧属性面板，提示词在节点里，费用在运行前的确认框里——步骤多一步，适合精细调节，但「想到就生成」不够快。

### B. 变体与挑选
一次多出几张再挑是默认做法（Flow「每次输出数量」、Midjourney 四宫格、Flora 最多 20 个变体）。挑中的那一个流向下游，其余留在历史里（Flora）。
**我们的现状**：有版本历史（‹ 2 / 5 ›），但一次只出一个；要多个候选只能多点几次。

### C. 参考与一致性
「素材 / 主体 / 角色 / 元素」是跨镜头一致性的核心：Flow 的 Ingredients 与角色、即梦的主体节点、LibTV 的主体库与三视图、LTX 的 Elements、Vidu 的参考生、Seedance / Kling 提示词里的 `@image1` `@Element1`。共同点：**一个有名字的参考，在提示词里点名引用**。
**我们的现状**：图片生成有参考图端口；视频生成只有首帧 / 尾帧；没有可复用的角色 / 主体。

### D. 首尾帧、延长、截帧
首尾帧已成标配；Flow 的 Extend（从片尾续写）和「保存这一帧」、即梦的关键帧提取，都是让一条长内容一段段接下去的方法。
**我们的现状**：首尾帧有；从片尾接着生成要手工截图再上传。

### E. 分镜与时间线
脚本 → 可编辑的分镜表 → 勾选批量出图 → 批量出视频 → 时间线排序剪辑（LibTV、即梦、LTX、Flow Scenebuilder、Flora 时间线）。
**我们的现状**：导演 Skill 输出分镜并展开成节点行、导出成片节点拼接；缺少「表格式改分镜」和「时间线上排序预览」。

### F. 批量
Flora 的 Batch 节点（文件、CSV、按行拆分，交叉或配对）、Krea 的拆行节点、LibTV 的勾选批量。
**我们的现状**：只能靠分镜展开得到多个节点。

### G. 提示词优化与 Skill
Runway 有专门做提示词优化的 LLM 节点，Krea 的 Agent 方案里有「提示词优化」一步，MiniMax 有单独的增强任务，百炼万相有服务端扩写（`prompt_extend`）。各家官方写法指南差别明显（见第三节），**同一句话交给不同模型，最佳写法不同**。社区已有大量面向某个模型的提示词 Skill（例如针对 Seedance 的 Skill）。
**我们的现状**：反推 Skill、导演 Skill 已有；生成节点没有「按目标模型优化提示词」，也不能导入提示词 Skill。

### H. Agent 搭流程
Runway Agent、Krea Node Agent、Flora FAUNA、即梦 Octo、LibTV 的 Skill API：一句话 → 方案（含费用）→ 确认 → 节点上画布 → 运行。Flora 区分「协助（先确认）」与「自动」。
**我们的现状**：画布助手（rc.4）已是「先给方案、确认后加入」；方案里还没有费用，也不能对已有节点做修改。

### I. 复用：分组、模板、应用
LibTV 分组存为工作流并整组执行；ComfyUI 子图与 App Mode；Krea / Runway 把工作流发布成只露出几个输入的应用；Flora Techniques。
**我们的现状**：有模板与项目包；没有分组、没有「应用模式」。

### J. 导出与交接
即梦导出 XML / 剪映草稿；Flow 下载整段场景；LibTV 视频合成节点。
**我们的现状**：导出成片 + Shotcut / MLT 剪辑工程。

### K. 流畅度
排队 / 生成中状态与预估时间（Flora）；运行中可以改下一次的参数（Flora）；只重跑下游（即梦、Krea）；结果缓存（Krea）；失败自动退款（Flora，平台计费才有意义）。
**我们的现状**：缓存、只跑上游与下游、运行进度、恢复进行中的任务都已具备；同一画布同时只能有一个运行，新的运行会取消旧的。

## 三、各模型官方写法要点（用于「优化提示词」）

只提炼结构与规则，内置写法由本项目自己撰写。

| 模型 | 推荐结构 | 运镜写法 | 图生视频 | 多镜头 / 其他 |
| --- | --- | --- | --- | --- |
| 通义万相 Wan（百炼官方） | 主体 + 场景 + 运动；进阶再加美学控制（光线、景别、角度、镜头、运镜）与风格；有声版再加声音 | 「镜头推进」「镜头左移」；不动写「固定镜头」 | **只写运动 + 运镜**（主体、场景、风格由图片决定） | 「镜头 1 [0–3 秒] …」+ 硬切；wan3 起有「No …」否定清单，不写会自行加对白与配乐 |
| Seedance（第三方整理） | 主体 → 动作 → 镜头 → 风格，用自然句子 | 每个镜头只写一个主要运镜：景别 + 视角 + 一个运动 + 速度 | 写动作与镜头 | 时间段「00–05s」、转场名称；`@image1` 每个参考写清用途；不要堆「电影感、高级、绝美」；明确写「无对白 / 无音乐」 |
| 可灵 Kling 4.0（官方指南） | 整体风格 → 人物 / 道具 → 镜头与动作（带时间码） | 具体运镜名，可写距离（如「缓慢推进 10 厘米」）；切换写「硬切」并带时间码 | 说明每个锚定帧的作用，写两帧之间发生什么 | 否定写成句子（「不要出现文字、标志、水印」），没有单独的否定字段；`@Image1` `@Element1` |
| MiniMax H3（官方） | 未给出顺序 | 在关键描述后加 `[pan]` `[zoom]` `[static]` 等方括号命令 | — | 最多 7000 字；参考写成「动作参考视频 1，外貌参考图片 1、2」 |
| 共同规律 | 主体与动作在前，镜头其次，风格与声音最后 | 一个镜头一个运镜；单镜头就写明 | 不要重复描述图片里已有的东西 | 多镜头用时间码 + 硬切 |

Runway 的提示词指南页对自动访问返回 403，未纳入；按共同规律处理。

## 四、对照：本项目已有与缺口

| 能力 | 本项目现状 | 缺口 / 机会 | 安排 |
| --- | --- | --- | --- |
| 想到就生成（提示词栏） | 节点 + 属性面板 + 运行确认 | 底部「生成栏」：提示词、模型、比例、时长、数量、参考、费用、生成，一步完成，结果仍是画布上的节点 | rc.14 |
| 按模型优化提示词 | 无 | 用你的文本模型，按目标模型的写法改写；可导入提示词 Skill | rc.14 |
| 变体 | 一次一个 | 一次 1–4 个，网格显示，「选用」其中一个流向下游 | rc.14 |
| 延长 / 截帧 | 手工截图 | 「从最后一帧接着生成」、查看大图时「保存这一帧」 | rc.14 |
| 选中即运行 | Ctrl Enter 运行全部 | Enter 运行选中的节点 | rc.14 |
| 参考 / 主体 / 角色 | 图片参考端口 | 视频参考图端口；有名字的主体（多张图 + 描述）；提示词里 `@名字` 引用 | rc.15 |
| 分镜表与时间线 | 导演分镜 + 展开 + 导出节点 | 表格式编辑分镜、勾选批量生成；时间线排序、裁剪、预览 | rc.15 |
| 分组与整组运行 | 无 | 框选分组、整组运行、存为模板 | rc.15 |
| 批量 | 无 | 批量节点（按行 / 文件 / CSV，交叉或配对） | rc.16 |
| 宫格分镜与切分 | 无 | 九宫格 / 25 宫格分镜模板与切分成节点 | rc.16 |
| 复核模式 | 版本条 | 网格复核、键盘翻看、打标签 | rc.16 |
| Agent | 画布助手（方案 → 确认） | 方案带费用；能修改已有节点；协助 / 自动两种模式 | rc.17 |
| 应用模式 | 模板 | 选几个输入，把一条流程变成表单式「应用」 | rc.17 |
| 给外部 Agent 用 | 无 | 本地 API / MCP：列出画布、运行、取结果（自带 Key 的前提下） | 1.1 |
| 剪辑交接 | MLT / Shotcut | FCPXML、剪映草稿 | 1.1 |

## 五、不借鉴的部分

- 积分订阅、社区发布、平台托管模型：本项目坚持自带模型与 Key、本地优先。
- 人像实名授权、平台内容审核：属于服务商自己的合规流程，由服务商的接口处理。
- 任何产品的视觉风格、图标、配色、文案；Jaaz（许可证存疑）、Toonflow（AGPL）、ComfyUI / Krita AI Diffusion（GPL）的代码。

## 来源

- Google Flow 帮助中心：[入门](https://support.google.com/labs/answer/16353333)、[生成视频](https://support.google.com/flow/answer/16353334)、[管理项目与素材](https://support.google.com/flow/answer/16935308)、[编辑与场景](https://support.google.com/flow/answer/16935718)；[发布博文](https://blog.google/technology/ai/google-flow-veo-ai-filmmaking-tool/)
- 即梦 Dreamina：[AI Canvas](https://dreamina.capcut.com/ai-video/ai-canvas-review)、[Creative Agent](https://dreamina.capcut.com/ai-video/ai-creative-agent)、[Storyboards](https://dreamina.capcut.com/resource/ai-for-storyboards)；[Seedance 2.0 发布](https://seed.bytedance.com/zh/blog/seedance-2-0-official-launch)
- LibTV：[品玩报道](https://www.pingwest.com/a/312278)、[第三方攻略](https://deepseek.csdn.net/6a3207ef662f9a54cb803c49.html)、[moge.ai 介绍](https://moge.ai/zh/product/libtv)、[投资界报道](https://news.pedaily.cn/202603/561904.shtml)
- Runway：[Workflows](https://runway.com/workflows)、[Changelog](https://runway.com/changelog)
- Flora：[文档索引](https://docs.flora.ai/llms.txt)、[画布](https://docs.flora.ai/editor/canvas)、[节点如何运行](https://docs.flora.ai/nodes/how-nodes-run.md)、[Batch 节点](https://docs.flora.ai/nodes/batch-node.md)、[FAUNA](https://docs.flora.ai/editor/fauna.md)
- Krea：[Nodes 文档](https://www.krea.ai/docs/user-guide/features/nodes.md)、[Realtime Edit](https://krea.ai/blog/realtime-edit)
- ComfyUI：[Subgraph](https://blog.comfy.org/p/subgraph-official-release)、[模板库更新](https://blog.comfy.org/p/comfyui-0366-updates)、[App Mode 报道](https://gigazine.net/gsc_news/en/20260312-comfyui-app-mode)
- LTX Studio：[功能](https://ltx.studio/blog/top-ltx-studio-features)、[一致角色](https://ltx.studio/blog/how-to-create-a-consistent-character)
- 其他：[Krea 节点类产品对比](https://www.krea.ai/blog/top-node-based-ai-workflow-apps)、[Lovart](https://www.lovart.ai/features/ai-design-agent)、[Jaaz](https://github.com/11cafe/jaaz)、[星流](https://ai-bot.cn/xingliu-art-agent/)、[Higgsfield 预设](https://higgsfield.ai/blog/Introducing-20-New-Experimental-Presets)、[Luma Ray3 Modify](https://lumalabs.ai/learning-hub/ray3-modify-user-guide)、[Midjourney Omni Reference](https://the-decoder.com/midjourney-expands-image-control-with-omni-reference-tool/)、[Firefly Boards 合作模型](https://helpx.adobe.com/firefly/web/create-mood-boards/firefly-boards/partner-models-to-generate-videos.html)、[Leonardo 指南](https://knightli.com/en/2026/06/26/leonardo-ai-image-video-design-guide/)、[Vidu 参考生](https://www.digitaling.com/articles/1379412.html)、[可灵 3.0 介绍](https://ai-bot.cn/kelingai-3-0/)、[InvokeAI](https://cdn.jsdelivr.net/gh/invoke-ai/InvokeAI@main/README.md)、[Krita AI Diffusion](https://cdn.jsdelivr.net/gh/acly/krita-ai-diffusion@main/README.md)、[SwarmUI](https://cdn.jsdelivr.net/gh/mcmonkeyprojects/swarmui@master/README.md)、[开源短剧流水线综述](https://pixo.video/blog/open-source-ai-video-pipelines)
- 写法指南：[百炼万相视频提示词指南](https://help.aliyun.com/zh/model-studio/text-to-video-prompt)、[万相 3.0 提示词指南](https://help.aliyun.com/en/model-studio/wan3-video-generation-prompt-guide)、[可灵 4.0 提示词指南](https://kling.ai/document-api/api/usage-guide/kling-4-0-prompt-guide.md)、[MiniMax 视频生成指南](https://platform.minimax.io/docs/guides/video-generation.md)、[Seedance 2.5 指南（RunDiffusion）](https://www.rundiffusion.com/seedance-2-5-prompt-guide)、[Seedance 2.0 指南（第三方）](https://www.heyuan110.com/posts/ai/2026-07-11-seedance-2-prompt-guide/)
