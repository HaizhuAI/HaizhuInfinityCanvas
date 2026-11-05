# 使用指南 · 配置模型档案

「设置 → 模型档案」里每添加一个档案，左侧「我的模型智能体」就多一个图标；把图标拖进画布，就得到一个已绑定该模型的节点。

API Key 只保存在本机服务端（AES-256-GCM 加密），浏览器拿不到明文；所有模型请求都由本机服务端发出。

## 字段说明

| 字段 | 说明 |
| --- | --- |
| 名称 | 侧边栏图标上显示的名字，如「通义视觉」「DeepSeek 编剧」 |
| 类型 | 文本模型 / 视觉分析 / 图片生成 / 视频生成 / 语音 TTS。决定它能绑定到哪些节点 |
| 适配器 | 调用协议。v1.0.0-beta.2 支持 `openai-compat` 与 `ollama`（文本/视觉）；其余在后续 beta 开放 |
| 接口地址 | 服务商的 Base URL（填到 `/v1` 这一级即可，`/chat/completions` 会自动补上） |
| 模型 ID | 服务商的模型名 |
| API Key | 可留空（本地模型）。编辑时留空表示保持不变 |

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

`defaults`（默认参数）目前通过 API 设置，会原样合并进请求体（如 `temperature`、`max_tokens`）；`model`、`messages`、`stream` 不可覆盖。

## 图片提示词反推怎么用

1. 拖入「图片」节点，点「上传素材」。
2. 拖入「图片提示词反推」节点，绑定一个**视觉分析**类型的档案，选择目标风格（通用 / Midjourney / SDXL / Flux / 视频生成）和语言。
3. 连线：图片 → 反推节点的「图片」端口。
4. 点反推节点的「▶ 运行」。结果可一键复制，也可以连到下游（例如文本模型润色，或 beta.3 起的图片/视频生成节点）。

再次运行时，如果图片、参数和模型档案都没变，会直接「复用缓存」不再调用模型（不重复计费）；想换一个结果点「↻ 重新生成」。

## 安全提示

- WebUI 部署到局域网/服务器时，必须设置 `HZC_TOKEN`，并在「设置 → 访问口令」里填入。
- 服务端会代你访问档案里填写的任何地址（包括内网地址，这是接入本地模型所必需的）。只把访问口令交给你信任的人。
