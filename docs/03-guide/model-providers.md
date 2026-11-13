# 使用指南 · 接入各家模型服务商（rc.13 起）

「设置 → 模型档案 → 添加模型」里，服务商按**国内 / 海外 / 本机**分组。先选类型（文本、视觉、图片、视频、语音），再点服务商：接口地址和适配器自动填好，下面列出这家的**常用模型**，点一下即可填入模型 ID。粘贴 Key、点「测试连接」（不产生费用）后保存。

文本、视觉和多数图片模型走 OpenAI 兼容接口（`openai-compat`）；视频、部分图片和语音走服务商**自己的接口**（rc.13 新增的专用适配器）。同一家服务商的 Key 通常各种类型通用，只是要分别建档案（例如「可灵 · 视频」和「可灵 · 图片」）。

## 一览

| 服务商 | 文本 / 视觉 | 图片 | 视频 | 语音 | 获取 Key |
| --- | --- | --- | --- | --- | --- |
| 火山方舟（豆包） | openai-compat | openai-compat（Seedream） | **ark**（Seedance） | — | 火山引擎控制台 → 方舟 |
| 阿里云百炼（通义 / 万相） | openai-compat（兼容模式） | **dashscope**（万相） | **dashscope**（万相） | — | 百炼控制台；国际站另有「阿里云百炼（国际）」 |
| 可灵 Kling | — | **kling** | **kling** | — | 可灵开放平台 |
| MiniMax 海螺 | openai-compat | — | **minimax**（海螺） | **minimax** | 国内：platform.minimax.cn；国际：「MiniMax（国际）」 |
| 智谱 BigModel | openai-compat | openai-compat（CogView） | **zhipu**（CogVideoX） | — | open.bigmodel.cn → API Keys |
| 硅基流动 | openai-compat | openai-compat（自动用 `image_size`） | **siliconflow** | openai-compat | cloud.siliconflow.cn → API 密钥 |
| Kimi（月之暗面） | openai-compat | — | — | — | platform.moonshot.cn |
| DeepSeek | openai-compat | — | — | — | platform.deepseek.com |
| OpenAI | openai-compat | openai-compat | — | openai-compat | platform.openai.com |
| Google Gemini | openai-compat | openai-compat（Gemini 图片模型） | — | — | Google AI Studio |
| Runway | — | **runway** | **runway** | **runway** | dev.runwayml.com |
| ElevenLabs | — | — | — | **elevenlabs** | elevenlabs.io → API Keys |
| Replicate / fal.ai | — | replicate / fal | replicate / fal | replicate / fal | 各自控制台 |
| Ollama / LM Studio / Kokoro | 本机 | — | — | Kokoro（本机） | 不需要 |

## 节点参数怎么传给各家

画布上的节点参数统一为：提示词、负面词、参考图、首帧、尾帧、画面比例、时长、音色、语速，以及「高级参数（JSON）」。专用适配器把它们换成各家要求的格式：

| 适配器 | 首帧 / 尾帧 | 画面比例 | 时长 | 负面词 |
| --- | --- | --- | --- | --- |
| ark（Seedance） | `content` 里的图片，`role` 为 `first_frame` / `last_frame` | `ratio` | `duration` | 写进提示词（Avoid: …） |
| dashscope（万相视频） | wan2.7 起用 `media` 列表；更早的模型只支持首帧（`img_url`）；首尾帧模型（`kf2v`）走专用接口 | wan2.7 文生视频用 `ratio`；图生视频跟随图片 | `duration`（kf2v 固定 5 秒） | `negative_prompt` |
| dashscope（万相图片） | — | 换算成 `size`（wan2.6 起在 1280² ~ 1440² 像素之间） | — | `negative_prompt` |
| kling | `contents` 里的 `first_frame` / `last_frame`（纯 base64） | 文生视频 `aspect_ratio`；图片 `aspect_ratio` | `duration` | 视频写进提示词；图片用 `negative_prompt`（有参考图时可灵不支持） |
| minimax | Hailuo-02 / 2.3：`first_frame_image` / `last_frame_image`；MiniMax-H3：`content` 列表 | 只有 H3 支持 `ratio` | Hailuo 只有 6 / 10 秒（按最接近的取）；H3 为 4–30 秒（rc.20 起） | 写进提示词 |
| runway | `promptImage`（首尾帧用 `position`） | 换算成像素比例，如 `1280:720` | `duration`（默认 5） | 写进提示词 |
| zhipu（CogVideoX） | `image_url`（首尾帧为两张图的列表） | 文生视频换算成 `size` | 仅 cogvideox-3：5 / 10 秒 | 写进提示词 |
| siliconflow | `images` 列表，`role` 为 `first_frame` / `last_frame` | `ratio` | `duration` | 写进提示词 |

### 视频参考图（rc.15 起）

视频生成节点新增「参考图」端口（可以连多张），主体的图片也走这里：

| 适配器 | 参考图怎么传 |
| --- | --- |
| ark（Seedance） | `content` 里 `role` 为 `reference_image` 的图片（Seedance 2.x 最多 9 张，更早的模型 4 张） |
| minimax（MiniMax-H3） | `content` 里 `role` 为 `reference_image` 的图片（最多 9 张）；Hailuo-02 / 2.3 不支持 |
| replicate / fal | 各模型字段名不同：在档案默认参数里写 `{"_fields": {"ref": "字段名"}}` 后发送；没设置时连了参考图会提示 |
| 万相、可灵、Runway、CogVideoX、硅基流动 | 不支持：连了参考图会提示；主体的图片会被跳过，只用文字描述 |

### 按模型的时长、分辨率与声音（rc.20 起）

视频节点的「时长」「分辨率」「生成声音」跟着所选模型变化（按模型 ID 识别）：

| 模型 | 时长 | 分辨率（`resolution`） | 生成声音（`generate_audio`） |
| --- | --- | --- | --- |
| Seedance 2.0（`doubao-seedance-2-0-…`） | 4–15 秒 | 480p / 720p / 1080p（Fast 版到 720p） | 可以 |
| Seedance 2.5 | 4–30 秒 | 480p / 720p | 可以 |
| MiniMax H3 | 4–30 秒 | 768P / 2K（默认 768P） | — |
| 其他模型 | 5 / 10 秒 | 服务商默认 | — |

导入或 Agent 设置的其他时长也会保留在菜单里。数值来自 Toonflow 的供应商模型表中多家一致的部分，以服务商文档为准；对不上时在「高级参数」里覆盖即可。

### OpenAI 兼容图片模型的参考图（rc.20 起）

连到「参考图」的图片会发给 OpenAI 兼容接口：

- Seedream、Qwen-Image、Flux Kontext、Gemini 图片一类：`/images/generations` 的 `image` 字段（一张为字符串，多张为列表，data URI）。
- gpt-image 一类（其余模型默认）：上传到 `/images/edits`（`multipart`，多张时为 `image[]`）。
- 不确定时在档案默认参数里写 `{"_imageRefs": "json"}` 或 `{"_imageRefs": "edits"}` 指定。
- 主体（`@名字`）的图片只发给已知支持参考图的模型（上面两类，或设置了 `_imageRefs` 的档案）；其他模型只用文字描述。

「高级参数（JSON）」最后合并，并且**按层合并**：例如在万相节点里写 `{"parameters": {"seed": 42, "watermark": false}}`，只会加上这两项，不会把画面比例和时长冲掉。档案的「默认参数」在最底层。

### 语音

| 适配器 | 音色（节点里的「音色」） | 语速 |
| --- | --- | --- |
| minimax | `voice_id`，如 `Chinese (Mandarin)_Lyrical_Voice`（默认）、`male-qn-qingse`；完整列表见 MiniMax 文档的系统音色表 | `voice_setting.speed`（0.5–2） |
| elevenlabs | `voice_id`（在 ElevenLabs → Voices 里复制），留空使用一个所有账号都有的预置音色 | `voice_settings.speed`（会限制在 0.7–1.2） |
| runway | 预置音色名，如 `Maya`（默认）、`Rachel` | — |

MiniMax 语音直接返回音频，不需要轮询；输出 mp3，可在档案默认参数里改 `{"audio_setting": {"format": "wav"}}`。

## 各家要注意的地方

- **火山方舟**：视频（Seedance）用 `ark` 适配器；图片（Seedream）和对话用 `openai-compat`，地址相同。Seedream 的模型 ID 请在方舟控制台复制。停止运行时会请求取消（排队中的任务才能取消）。
- **阿里云百炼**：北京地域用 `dashscope.aliyuncs.com`，国际站（新加坡）用 `dashscope-intl.aliyuncs.com`，Key 与地域必须一致。任务结果只保留 24 小时。只有排队中的任务能取消。
- **可灵**：使用开放平台的 API Key（新版鉴权；旧版的 Access Key + Secret Key 签名方式不支持）。预设地址是 `api-singapore.klingai.com`（可灵文档中「服务器在中国大陆以外」使用的地址）；如果你的账号要求其他地址，在「高级设置」里修改。可灵没有取消任务的接口。结果链接保留 30 天，画布会在完成时立即下载保存。
- **MiniMax**：国内账号用「MiniMax 海螺」（`api.minimax.cn`），国际账号用「MiniMax（国际）」（`api.minimax.io`）。MiniMax-H3 需要按量付费的 Key。
- **Runway**：直接上传的图片（data URI）不能超过约 3.3 MB，太大的图片会在提交前提示压缩。每次请求带 `X-Runway-Version: 2024-11-06`。
- **智谱**：对话、视觉和 CogView 图片用 `openai-compat`，CogVideoX 视频用 `zhipu`，地址相同。智谱文档里没有模型列表接口，对话档案的「测试连接」可能提示 404，地址正确时可以直接保存。
- **硅基流动**：图片接口的尺寸字段叫 `image_size`、结果在 `images[]` 里，选这个服务商时会自动写入 `{"_sizeField": "image_size"}`；不同模型支持的尺寸不同，可在节点高级参数里写 `{"image_size": "…"}`。视频结果链接一小时内有效（画布会立即下载）。
- **Google Gemini**：只接入 OpenAI 兼容接口（对话、看图、Gemini 图片模型）。Google 已经下线了 Veo 3.1 预览版和 Imagen 的旧接口，视频请通过 Runway（`veo3.1`）、fal 或 Replicate 使用。
- **ElevenLabs**：Key 放在 `xi-api-key` 请求头里（适配器自动处理）。「测试连接」会列出账号可用的语音模型。

## 测试连接做了什么

全部是**不产生费用**的只读请求：OpenAI 兼容接口读模型列表；火山方舟读任务列表；可灵读图片任务列表；硅基流动读视频模型列表；ElevenLabs 读模型列表；百炼、Runway、智谱、MiniMax 查询一个不存在的任务——服务返回「找不到」说明 Key 有效，返回 401 / 403 说明 Key 无效。

## 依据与验证范围

适配器按各家官方 API 文档编写（2026-11-12 查阅）：火山方舟（视频任务接口与官方 Python SDK）、阿里云百炼（万相文生视频 / 图生视频 / 首尾帧 / 文生图、异步任务管理）、可灵（API Key 鉴权、2.5 Turbo 文生 / 图生视频、任务查询、图片生成）、MiniMax（视频 v1 / v2、文件下载、同步语音）、Runway（接口说明与官方 Node SDK 的类型定义）、智谱（CogVideoX、异步结果）、硅基流动（视频提交 / 状态、图片、模型列表）、ElevenLabs（模型与音色列表；文字转语音的调用方式依据官方 SDK 用法，因为接口说明页当时无法打开）。

单元测试用本地模拟服务逐家验证了请求格式（地址、请求头、字段、首尾帧、比例与时长换算）、轮询状态、结果读取、失败信息与连接测试。**没有用真实账号调用过**——请用你自己的 Key 先跑一个最便宜的模型确认；如果某家的字段变了，可以先用「高级参数」覆盖，并告诉我们修正。
