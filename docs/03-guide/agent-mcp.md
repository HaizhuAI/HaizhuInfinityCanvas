# 使用指南 · 让 Claude Code 等 Agent 操作画布（MCP，rc.16 起）

海柱无限画布内置一个 **MCP 服务**（Model Context Protocol）。把它加到 Claude Code（或任何支持 MCP 的 Agent）里以后，你可以直接用一句话让 Agent 在画布上搭节点、按目标模型写提示词、预估费用、运行、查看结果并继续修改。Agent 的每一步都会**实时出现在打开的画布上**，你可以同时编辑，双方的修改都会保留。

## 一、打开 Agent 接入

**设置 → Agent 接入**，打开「允许 Agent 访问这台电脑上的画布」。默认是关闭的：不打开，任何 Agent 都连不上。

打开后页面会给出可以直接复制的命令。关闭开关或点「更换密钥」，已经接入的 Agent 会立即失去访问权限。

## 二、桌面版：加到 Claude Code（推荐）

复制「添加到 Claude Code」里的命令，在终端里运行一次。命令的样子：

```bash
# Windows（命令提示符 cmd，或用原生安装的 Claude Code 的 PowerShell）
claude mcp add --env ELECTRON_RUN_AS_NODE=1 --transport stdio --scope user haizhu-canvas -- "C:\Users\你\AppData\Local\Programs\HaizhuInfinityCanvas\haizhu-infinity-canvas.exe" "C:\Users\你\AppData\Roaming\HaizhuInfinityCanvas\mcp\haizhu-mcp.cjs"

# macOS
claude mcp add --env ELECTRON_RUN_AS_NODE=1 --transport stdio --scope user haizhu-canvas -- "/Applications/HaizhuInfinityCanvas.app/Contents/MacOS/HaizhuInfinityCanvas" "$HOME/Library/Application Support/HaizhuInfinityCanvas/mcp/haizhu-mcp.cjs"

# Linux（deb）
claude mcp add --env ELECTRON_RUN_AS_NODE=1 --transport stdio --scope user haizhu-canvas -- "/opt/HaizhuInfinityCanvas/haizhu-infinity-canvas" "$HOME/.config/HaizhuInfinityCanvas/mcp/haizhu-mcp.cjs"
```

**请以设置页给出的命令为准**（路径因安装位置而不同）。`--scope user` 表示在你所有的项目里都能用；只想在当前项目里用就去掉它。

它是怎么工作的：

- Claude Code 启动时用**应用自己的程序**（以 Node 模式运行，不需要另装 Node.js）运行一个很小的桥接脚本 `haizhu-mcp.cjs`。脚本在每次应用启动时复制到用户目录，所以应用更新后命令仍然有效。
- 桌面版每次启动的端口都不同，桥接脚本会自己找到正在运行的应用；**应用没开时会自动打开它**。
- 访问密钥保存在数据目录的 `agent-token` 文件里（只有你的系统用户能读），桥接脚本直接读取，不需要复制密钥。

在 Claude Code 里输入 `/mcp` 可以看到 `haizhu-canvas` 的连接状态；`claude mcp list` 会显示 `Connected`。

也可以把同样的配置写进项目根目录的 `.mcp.json`（设置页有可复制的 JSON），团队成员各自运行的是自己电脑上的应用。

### 注意

- **Windows 便携版**每次启动都会解压到新的临时目录，命令里的路径下次就失效了：接入 Claude Code 请用安装版。
- **AppImage**：命令里是 AppImage 文件本身的位置，移动或改名后需要重新复制命令。
- **Windows PowerShell**：如果 Claude Code 是用 npm 安装的，PowerShell 可能吞掉命令里的 `--`，请改在「命令提示符」里运行，或使用 `.mcp.json`。

## 三、WebUI / Docker：用 HTTP 接入

WebUI 和 Docker 部署的地址是固定的，直接用 HTTP：

```bash
claude mcp add --transport http --scope user haizhu-canvas http://你的地址:8787/mcp --header "Authorization: Bearer hzc_…"
```

设置页显示的命令里已经带好了地址和密钥（屏幕上打码，复制的是完整内容）。`.mcp.json` 写法：

```json
{
  "mcpServers": {
    "haizhu-canvas": {
      "type": "http",
      "url": "http://你的地址:8787/mcp",
      "headers": { "Authorization": "Bearer ${HAIZHU_CANVAS_KEY}" }
    }
  }
}
```

`.mcp.json` 会进代码仓库时，用 `${HAIZHU_CANVAS_KEY}` 这样的环境变量代替密钥本身。

**多人网站（账号模式）**：每个账号在「设置 → Agent 接入」里生成自己的密钥，Agent 只能看到这个账号的画布。密钥只在生成时显示一次，服务器只保存它的哈希；忘了就重新生成（旧的立即失效）。

## 四、可以让 Agent 做什么

在 Claude Code 里直接说，例如：

- 「在海柱画布里新建一个画布，用 Seedance 做一条 5 秒的橘猫短片，先出一张首帧图。」
- 「读一下我现在打开的画布，把所有视频提示词按目标模型的写法改一遍。」
- 「用桌面上的 product.png 做三张不同风格的电商主图，挑一张最好的。」
- 「导演节点的分镜出来以后，把每个镜头展开成图片和视频节点并运行，最后接到导出成片。」
- 「用 shuohao-skills 把 novel.txt 做成分镜，然后把整个工程导入海柱画布的新画布。」（需要先在 Claude Code 里装好 shuohao-skills；导入用 `import_drama`）

Agent 可用的工具：

| 工具 | 作用 |
| --- | --- |
| `list_projects` / `create_project` | 列出画布 / 新建画布 |
| `get_canvas` | 读取画布：节点、参数、模型、连线、当前结果摘要 |
| `list_node_types` / `list_models` | 可用的节点类型（端口、参数）与你的模型档案、Skill（不含 API Key） |
| `add_nodes` | 一次添加多个节点和连线（也可以只连线）；自动排在画布右侧 |
| `update_node` / `remove` | 改提示词、参数、模型、素材、位置（导出节点的时间线：`order` / `trims`）；删除节点或连线 |
| `group_nodes` | 把几个节点框成一个有名字的分组（例如一场戏一组） |
| `split_shots` | 把画布上的视频拆成每个镜头的关键帧、片段和原音轨，作为节点放在旁边（本机 FFmpeg，不花钱；rc.20） |
| `import_drama` | 导入 shuohao-skills 的短剧工程（outline / cast / art / script / storyboard JSON，传内容或本机绝对路径）：主体、每段一个分组、分镜图、视频与导出节点（rc.19，见[短剧工坊](./short-drama.md)） |
| `upload_asset` | 导入本机文件（桌面版 / 本机服务）或 base64 数据，可直接成为输入节点或主体图片 |
| `prompt_guide` | 目标模型的提示词写法（与「优化提示词」用的同一套规则） |
| `estimate` / `run` / `wait_for_run` / `cancel_run` | 预估费用、运行（可只运行部分节点）、等待、停止 |
| `get_results` / `view_asset` / `pick_result` | 读取完整结果（文本、分镜、素材及本机文件路径）；查看图片和视频关键帧；多个变体里选用一个 |

### 教 Claude Code 用这块画布：导出 Skill（rc.20 起）

**设置 → Agent 接入**里有「复制 SKILL.md」和「下载」。把它存成 `~/.claude/skills/haizhu-canvas/SKILL.md`（只给某个项目用就放进项目的 `.claude/skills/haizhu-canvas/`），Claude Code 会在你提到海柱画布、出图出片、短剧、拆镜头等任务时自动读取：什么时候用画布、按什么顺序调用工具、主体 / 短剧导入 / 拆镜头怎么用，以及**先报费用、你同意后才运行**。没有网页时也可以从 `GET /api/agent/skill` 取到同样的内容。（这个做法参考了开源项目 Toonflow 的「导出 Skill」。）

`list_models` 会列出每个视频模型可选的时长、分辨率、能否生成声音和参考图上限（rc.20 起），Agent 据此设置 `duration` / `resolution` / `audio`。

## 五、费用与安全

- **先给你看，再花钱**：会调用付费模型（图片 / 视频 / 语音生成或设置了单价的模型）时，`run` 不会直接开始，而是返回次数与预估费用，要求 Agent 带 `confirm_cost: true` 再调用。Agent 应当先把预估告诉你；Claude Code 默认也会在每次调用工具前征求你的同意。
- 没有变化的节点会复用缓存结果，不会重复收费；改了哪个节点只重跑它和下游。
- Agent 拿不到任何 API Key；模型档案只显示名称、模型 ID 和单价。
- 只接受 MCP 客户端的请求：来自其他网站的浏览器请求会被拒绝（防 DNS 重绑定和跨站请求）；猜错密钥次数过多会被暂时锁定。
- 桌面版的 MCP 只监听本机地址（127.0.0.1）。
- 读取本机文件（`upload_asset` 的 `path`）只在服务运行在你自己电脑上时可用；Docker 和多人网站只能上传数据。

## 六、和画布同时编辑

- Agent 改动画布时，打开的页面会自动合并：Agent 改的节点更新、你正在改的内容保留；同一个字段两边都改了，以你在页面上的为准。
- Agent 开始运行时，页面会显示运行进度和结果，就像你自己点了运行；你也可以随时停止。
- 你在 Agent 修改之后做的撤销，可以撤掉 Agent 的改动。

## 七、协议细节（给开发者）

- 端点：`POST /mcp`（Streamable HTTP，每个请求返回一个 JSON 结果，不提供服务器推送流；`GET /mcp` 返回 405）。认证：`Authorization: Bearer <key>`。
- 协议版本：`2025-11-25`、`2025-06-18`、`2025-03-26`。
- 桥接脚本：`apps/desktop/mcp-bridge.cjs`（stdin / stdout 每行一条 JSON-RPC 消息，转发到正在运行的应用；应用地址在数据目录的 `agent-endpoint.json`）。
- 打开的页面通过 `GET /api/events`（Server-Sent Events）接收画布变化；保存时带上画布版本号，别处已经改过时服务返回 409，页面合并后再保存。
