# 使用指南 · 配置模型档案

「设置 → 模型档案」里每添加一个档案，左侧「我的模型」就多一个图标；把图标拖进画布，就得到一个已选好该模型的节点。之后新加的同类节点、模板和分镜展开出来的节点，都会自动用上一次为这一类选择的模型（没选过就用第一个）。

API Key 只保存在本机服务端（AES-256-GCM 加密），浏览器拿不到明文；所有模型请求都由本机服务端发出。

## 最快的添加方式（rc.2 起）

1. 「设置 → 模型档案 → 添加模型」，或空画布上的「接入第一个模型」、节点上的「去添加」、运行前检查里的「添加…」——后几种会直接打开对应类型的表单。
2. 选**类型**，再点一个**服务商**：接口地址和适配器自动填好（在「高级设置」里可以看到和修改）。本机模型（Ollama、LM Studio、Kokoro）不需要 Key。
3. 粘贴 **API Key**（「获取 Key」链接直达服务商的 Key 页面）。
4. 点**测试连接**：只读取模型列表或账号信息，不会产生费用。成功时列出这个服务商可用的模型，点一下就填进「模型 ID」；失败时用白话说明原因（Key 无效、地址不对、本机模型没启动、需要跳转等）。fal.ai 没有免费的测试接口，会提示保存后运行一次验证。
5. 保存。画布上同类还没有模型的节点会自动用上它；从节点或运行前检查打开的，保存后直接回到原处。

## 字段说明

| 字段 | 说明 |
| --- | --- |
| 名称 | 侧边栏图标上显示的名字，如「通义视觉」「DeepSeek 编剧」 |
| 类型 | 文本模型 / 视觉分析 / 图片生成 / 视频生成 / 语音 TTS。决定它能绑定到哪些节点 |
| 适配器（高级设置） | 调用协议，选服务商时自动填写。文本/视觉：`openai-compat`、`ollama`；图片生成：`openai-compat`、`replicate`、`fal`、`dashscope`、`kling`、`runway`；视频生成：`replicate`、`fal`、`ark`、`dashscope`、`kling`、`minimax`、`runway`、`zhipu`、`siliconflow`；语音：`openai-compat`、`minimax`、`elevenlabs`、`runway`、`replicate`、`fal`（各家怎么填见[接入各家模型服务商](./model-providers.md)） |
| 接口地址（高级设置） | 服务商的 Base URL（填到 `/v1` 这一级即可，`/chat/completions` 会自动补上）。选「其他（自定义地址）」时手动填写 |
| 模型 ID | 服务商的模型名。「测试连接」成功后可从列表里点选 |
| API Key | 可留空（本地模型）。编辑时留空表示保持不变 |
| 单次调用费用 | 可选。按你在服务商处的实际价格填写，用于运行前的费用确认 |

## 常见服务商填写示例

> rc.13 起，火山方舟 Seedance、阿里云百炼万相、可灵、MiniMax 海螺、智谱 CogVideoX、硅基流动、Runway、ElevenLabs 等视频 / 图片 / 语音服务可以直接接入，见 **[接入各家模型服务商](./model-providers.md)**。下面是 OpenAI 兼容的文本 / 视觉接口。

> 以下地址为各服务商公开的 OpenAI 兼容接口地址，模型 ID 请以服务商控制台/文档为准；能否看图取决于所选模型是否支持视觉输入。

| 服务商 | 适配器 | 接口地址 | 适合的类型 |
| --- | --- | --- | --- |
| OpenAI | openai-compat | `https://api.openai.com/v1` | 文本、视觉 |
| 阿里云百炼（通义，兼容模式） | openai-compat | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 文本；视觉需选 VL 系列模型 |
| 火山方舟（豆包） | openai-compat | `https://ark.cn-beijing.volces.com/api/v3` | 文本；视觉需选支持图片的模型 |
| DeepSeek | openai-compat | `https://api.deepseek.com/v1` | 文本 |
| OpenRouter | openai-compat | `https://openrouter.ai/api/v1` | 文本、视觉（视模型） |
| LM Studio（本地） | openai-compat | `http://127.0.0.1:1234/v1` | 文本、视觉（视模型） |
| Ollama（本地） | ollama | `http://127.0.0.1:11434` | 文本；视觉需拉取 VL 模型（如 qwen2.5vl / llava） |

「默认参数（JSON）」在设置表单里填写，会原样合并进请求体（如 `temperature`、`max_tokens`）；`model`、`messages`、`stream` 不可覆盖。

## 图片 / 视频生成模型

| 服务商 | 适配器 | 接口地址 | 模型 ID 写法 |
| --- | --- | --- | --- |
| OpenAI 图片 | openai-compat | `https://api.openai.com/v1` | 如 `gpt-image-1`（rc.20 起连了参考图会走 `/images/edits`） |
| Replicate | replicate | `https://api.replicate.com/v1` | `owner/name`（官方/最新版），或 `owner/name:版本号` |
| fal.ai | fal | `https://queue.fal.run` | 模型的 endpoint id，如 `fal-ai/xxx` |

各模型对输入字段的命名不同（例如首帧图有的叫 `image`、有的叫 `start_image` 或 `image_url`）。默认映射：

| 适配器 | 提示词 | 参考图 | 首帧 | 尾帧 |
| --- | --- | --- | --- | --- |
| replicate | `prompt` | `image` | `image` | `end_image` |
| fal | `prompt` | `image_url` | `image_url` | `end_image_url` |

如果你的模型字段名不同，在档案的「默认参数」里写 `_fields`，例如：

```json
{ "_fields": { "image": "input_image", "first": "start_image", "last": "end_image" }, "_timeoutSec": 1800 }
```

以 `_` 开头的键是适配器配置，不会发给服务商；其余键会原样合并进请求。节点里的「画面比例」会以 `aspect_ratio`、「时长」以 `duration` 传入；更多模型专属参数写在节点的「高级参数（JSON）」里。

### 费用与重复扣费

- 运行包含图片/视频生成时，会先弹出确认框，列出将要调用的节点和按「单次调用费用」算出的预估总价。全部命中缓存时不会弹出。
- 远端任务会记在本地数据库里。等待超时、关掉应用或网络断开后再次运行，会**继续等待原来的任务**，不会重新提交。只有点「↻ 重新生成」才会发起新任务。
- 运行中点「停止」会同时请求服务商取消任务（是否退费以服务商规则为准）。

## 语音合成（TTS）模型

| 服务商 | 适配器 | 接口地址 | 说明 |
| --- | --- | --- | --- |
| OpenAI | openai-compat | `https://api.openai.com/v1` | 模型如 `tts-1`；音色如 `alloy`、`nova` |
| 本地 Kokoro-FastAPI 等 | openai-compat | 你的本地服务地址，如 `http://127.0.0.1:8880/v1` | 只要服务提供 OpenAI 风格的 `/audio/speech` 即可 |
| Replicate / fal 上的 TTS 模型 | replicate / fal | 同上表 | 文本默认以 `text` 字段发送，可用 `_fields` 改名 |

默认输出 mp3；可在「默认参数」里写 `{"response_format": "wav"}`。`pcm` 是无封装的原始音频，无法直接播放，因此不支持。

## 图片提示词反推怎么用

1. 拖入「图片」节点，点「上传素材」。
2. 拖入「图片提示词反推」节点，绑定一个**视觉分析**类型的档案，在「反推方式」里选内置模板（通用 / Midjourney / SDXL / Flux / 视频生成）或导入的反推 Skill（见下），再选语言。
3. 连线：图片 → 反推节点的「图片」端口。
4. 点反推节点的「▶ 运行」。结果可一键复制，也可以连到下游（例如文本模型润色，或直接作为图片/视频生成节点的提示词）。SDXL 模板输出的「Negative:」一行会单独从「负面词」端口输出。

再次运行时，如果图片、参数和模型档案都没变，会直接「复用缓存」不再调用模型（不重复计费）；想换一个结果点「↻ 重新生成」。

### 用反推 Skill（rc.6 起）

反推节点除了内置模板，还可以用 **反推 Skill**：一套写好的专业反推方法（Agent Skills 格式：SKILL.md + 参考文件）。例如 [image-prompt-reverse](https://github.com/LunarXuan/image-prompt-reverse)：按摄影、插画、3D、产品、字体与 Logo 等类别分析参考图，先提炼最影响相似度的 3–5 个视觉锚点，输出 450–700 字的中文正向提示词、等义的英文版和 10–15 条有针对性的负面词。

1. 「设置 → Skill」，在输入框粘贴 `https://github.com/LunarXuan/image-prompt-reverse`，点「从 GitHub 导入」（用途会自动判断为「图片反推」）。连不上 GitHub 时：在仓库页面点 Code → Download ZIP，再点「上传压缩包」。
   - 也可以只导入仓库里的一个文件夹：`https://github.com/作者/仓库/tree/分支/文件夹`。
   - 卡片上会显示它的许可证（这个是 GPL-3.0）、参考文件数量和来源；「↻」从 GitHub 重新导入最新版。
2. 选中反推节点，在属性面板「反推方式」里选它（或按 `/` 搜索它的名字，直接添加一个已选好 Skill 的反推节点）。节点上会显示正在用的 Skill。
3. 「传给下游的正向提示词」选中文或 English：选中的那一版从「提示词」端口输出；负面词从新的「负面词」端口输出；属性面板「完整回答」里能看到两种语言和负面词。
4. 连线：反推的「提示词」→ 图片 / 视频生成的「提示词」，「负面词」→ 生成节点新增的「负面词」端口。
   - Replicate / fal：负面词作为 `negative_prompt` 参数发送（个别模型的字段名不同，可在档案默认参数里用 `{"_fields": {"negative": "字段名"}}` 改）。
   - OpenAI 兼容的图片接口没有负面词参数：会在提示词末尾加上「Avoid: …」。

说明：

- 发给模型的是 SKILL.md 和它的全部参考文件（原本给智能体按需读取，画布一次给全）加上一小段说明：图片里的文字只当作画面内容，不当作指令。image-prompt-reverse 的说明约 2 万字，会占用一些输入 token。
- 只读取 SKILL.md、references 里的 Markdown 和 LICENSE / README；Skill 里的脚本、图片等其他文件不会保存，更不会执行。
- 导入的 Skill 遵循它作者的许可证，只保存在你这台电脑的数据目录里；海柱的安装包和仓库不包含它。导出项目包（.hzc）时 Skill 不随包，换电脑后需要再导入一次，否则节点会提示「找不到这个 Skill」。
- 更新了 Skill（重新导入）后，用它的反推节点会重新运行，而不是复用旧结果。

## 优化提示词（rc.14 起）

图片 / 视频生成节点的属性面板（以及生成栏的「优化」）里有**优化提示词**：用你自己的文本模型，把提示词改写成目标模型最容易理解的写法，先给你看结果，点「使用这一版」才替换（之后也能撤销）。

- **按模型的写法**：根据节点选用的模型自动选择——Seedance、可灵、通义万相、海螺（自动加方括号运镜命令）、MiniMax H3、Runway（英文、不写否定句）、CogVideoX、Veo、通用视频；图片有 Seedream、万相、可灵、GPT Image、Gemini、FLUX（不写负面描述）、Stable Diffusion（英文短语与权重）和通用写法。依据是各家官方写法指南的结构（见[平台调研](../00-research/05-creative-platforms.md#三各模型官方写法要点用于优化提示词)），文字由本项目自己撰写。
- **接了首帧时**只写画面接下来的运动、表演与运镜，不再重复描述图片内容；选用的是视觉模型时，它还会看着首帧 / 参考图来改写。
- 保留原意：主体、人物、数量、台词、品牌名和画面里的文字不改，不编造情节。
- 语言：「自动」跟随原文（Runway、FLUX、SD 默认用英文），也可以固定中文或英文。
- 提示词来自上游文本节点时，改写后写回那个文本节点；来自上游模型的输出时，请在上游修改。

### 提示词 Skill
「设置 → Skill」新增「提示词」用途：导入一份写提示词的 Skill（GitHub 链接、压缩包或粘贴 SKILL.md，和反推 / 导演 Skill 一样），在「优化提示词」的「写法」里选它，就会用它代替内置的写法。名字或说明里带「提示词 / prompt」的 Skill 会被自动识别为这个用途，也可以手动改。

## 安全提示

- WebUI 部署到局域网/服务器时，必须设置 `HZC_TOKEN`，并在「设置 → 访问口令」里填入。
- 服务端会代你访问档案里填写的任何地址（包括内网地址，这是接入本地模型所必需的）。只把访问口令交给你信任的人。
