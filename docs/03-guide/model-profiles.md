# 使用指南 · 配置模型档案

「设置 → 模型档案」里每添加一个档案，左侧「我的模型智能体」就多一个图标；把图标拖进画布，就得到一个已绑定该模型的节点。

API Key 只保存在本机服务端（AES-256-GCM 加密），浏览器拿不到明文；所有模型请求都由本机服务端发出。

## 字段说明

| 字段 | 说明 |
| --- | --- |
| 名称 | 侧边栏图标上显示的名字，如「通义视觉」「DeepSeek 编剧」 |
| 类型 | 文本模型 / 视觉分析 / 图片生成 / 视频生成 / 语音 TTS。决定它能绑定到哪些节点 |
| 适配器 | 调用协议。文本/视觉：`openai-compat`、`ollama`；图片生成：`openai-compat`、`replicate`、`fal`；视频生成：`replicate`、`fal` |
| 接口地址 | 服务商的 Base URL（填到 `/v1` 这一级即可，`/chat/completions` 会自动补上） |
| 模型 ID | 服务商的模型名 |
| API Key | 可留空（本地模型）。编辑时留空表示保持不变 |
| 单次调用费用 | 可选。按你在服务商处的实际价格填写，用于运行前的费用确认 |

## 常见服务商填写示例

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
| OpenAI 图片 | openai-compat | `https://api.openai.com/v1` | 如 `gpt-image-1`（只支持文生图，不支持参考图） |
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
2. 拖入「图片提示词反推」节点，绑定一个**视觉分析**类型的档案，选择目标风格（通用 / Midjourney / SDXL / Flux / 视频生成）和语言。
3. 连线：图片 → 反推节点的「图片」端口。
4. 点反推节点的「▶ 运行」。结果可一键复制，也可以连到下游（例如文本模型润色，或直接作为图片/视频生成节点的提示词）。

再次运行时，如果图片、参数和模型档案都没变，会直接「复用缓存」不再调用模型（不重复计费）；想换一个结果点「↻ 重新生成」。

## 安全提示

- WebUI 部署到局域网/服务器时，必须设置 `HZC_TOKEN`，并在「设置 → 访问口令」里填入。
- 服务端会代你访问档案里填写的任何地址（包括内网地址，这是接入本地模型所必需的）。只把访问口令交给你信任的人。
