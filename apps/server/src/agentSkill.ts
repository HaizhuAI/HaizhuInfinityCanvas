/**
 * The skill an agent installs next to the MCP connection (rc.20, the idea from Toonflow's 「导出 Skill」):
 * a SKILL.md that tells Claude Code (or any agent that reads skills) when to reach for the canvas and
 * how to use its tools safely. Served at GET /api/agent/skill and offered in 设置 → Agent 接入.
 * Written for this app; kept in step with the tool list in mcp.ts (a test checks every tool is named).
 */
export const AGENT_SKILL = `---
name: haizhu-canvas
description: 用海柱无限画布（Haizhu Infinity Canvas）制作图片、视频、配音和成片：在画布上搭节点、按目标模型写提示词、先报费用再运行、查看结果并修改。用户提到海柱画布、无限画布、分镜出图出片、短剧、拆镜头、或要在画布上做图片 / 视频时使用。需要已连接的 MCP 服务 haizhu-canvas。
---

# 海柱无限画布

画布上的每个节点是一步：文本、图片 / 视频 / 音频素材、主体（角色 / 物品 / 场景）、文本模型、视觉分析、图片生成、视频生成、配音、导演分镜、导出成片。节点之间按端口类型连线，上游的结果流向下游。用户在应用里看得到你的每一步改动，也可能同时在改。

## 工作方式

1. \`list_projects\` 找到画布，或 \`create_project\` 新建；\`get_canvas\` 读取现状（节点、参数、模型、连线、结果摘要）。
2. \`list_models\` 看用户配置了哪些模型（视频模型会列出可选时长、分辨率、能否生成声音、最多几张参考图）；\`list_node_types\` 看节点端口和参数。
3. \`prompt_guide\` 取目标模型的提示词写法，再写提示词（Seedance 用中文分镜结构、MiniMax H3 用英文三段结构，等等）。
4. \`add_nodes\` 一次加好节点和连线；\`update_node\` 改提示词、参数、模型；\`group_nodes\` 把一场戏框成一组。
5. **先 \`estimate\`，把次数和预估费用告诉用户，得到同意后**再 \`run\`（带 \`confirm_cost: true\`）。没有变化的节点用缓存，不重复收费。
6. \`wait_for_run\` 等结果；\`get_results\` 读文本 / 分镜 / 文件路径，\`view_asset\` 亲眼看图片和视频关键帧；多个变体用 \`pick_result\` 选一个。
7. 不满意就改那个节点再运行，只有它和下游会重跑。

## 常用做法

- **角色一致**：建主体节点（名字 + 描述 + 参考图），提示词里写 \`@名字\`；支持参考图的模型会收到主体的图。
- **改编小说 / 短剧**：用户用 shuohao-skills 做好了 outline / cast / art / script / storyboard JSON 时，用 \`import_drama\`（传内容或本机绝对路径）一次导入：主体、每段一个分组、分镜图、段视频、导出时间线。
- **复刻参考视频**：上传视频后 \`split_shots\`，本机拆成每个镜头的关键帧、片段和原音轨（不花钱）；关键帧可作首帧或参考图，再按镜头写新提示词。
- **成片**：视频（和配音）连到导出节点；用 \`update_node\` 设置导出节点的 \`order\` / \`trims\` 排好时间线，再运行导出。
- **本机文件**：\`upload_asset\` 可以直接读用户电脑上的文件（桌面版 / 本机服务），结果里也会给出文件路径。

## 规则

- 不要绕过费用确认：会花钱的运行一定先 \`estimate\` 并征得用户同意。
- 不编造节点 ID、端口或参数；以工具返回的为准。改动前先 \`get_canvas\`，因为用户可能刚在应用里改过。
- 删除（\`remove\`）只删用户要求的内容。
- 拿不到 API Key 是正常的：模型由用户在应用里配置。
`

/** every MCP tool the skill mentions, for the test that keeps the two in step */
export const AGENT_SKILL_TOOLS = ['list_projects', 'create_project', 'get_canvas', 'list_models', 'list_node_types', 'prompt_guide', 'add_nodes', 'update_node', 'group_nodes', 'estimate', 'run', 'wait_for_run', 'get_results', 'view_asset', 'pick_result', 'import_drama', 'split_shots', 'upload_asset', 'remove']
