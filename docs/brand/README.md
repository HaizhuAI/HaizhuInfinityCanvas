# 标志（rc.18 起）

一个只用线条的标志：**一块画布**（圆角框），右上角开着口；画布上有**一个节点**（小圆环），一条**贝塞尔连线**从节点出发、穿过开口伸到画布外，终点是一个**信号橙**的点。意思是：在一块没有边的画布上，用节点和连线把想法画出来。不再沿用早期「海中之柱」的图形。

| 文件 | 用途 |
| --- | --- |
| [mark.svg](./mark.svg) | 浅色背景上的标志（石墨线条） |
| [mark-on-dark.svg](./mark-on-dark.svg) | 深色背景上的标志（浅色线条） |
| [app-icon.svg](./app-icon.svg) · [app-icon-256.png](./app-icon-256.png) | 应用图标：石墨圆角底 + 浅色线条（桌面版、网页图标） |

规则：

- 线条 1.8（24 网格），圆头；只有终点用强调色 `#ff4a1f`，其余线条跟随文字颜色（界面里用 `currentColor`）。
- 最小 16 px；周围留出至少一个圆环直径的空白；不加阴影、渐变、描边或变形。
- 字标：**Haizhu** 加粗，**Infinity Canvas** 常规、次要文字颜色。

桌面版的图标（`apps/desktop/build/icon.png` 与 `icons/`）由 `app-icon.svg` 渲染生成。

## GitHub 仓库简介（About）

仓库首页右侧「About」需要在 GitHub 上点齿轮图标填写，建议：

- **Description**：`给图片和视频创作者的无限节点画布：自带模型连线运行，从一句话到带配音字幕的成片；Windows / macOS / Linux / 网页版，可接入 Claude Code（MCP）。An infinite node canvas for image & video creators.`
- **Topics**：`infinite-canvas` `node-editor` `ai-video` `image-generation` `text-to-video` `storyboard` `mcp` `claude-code` `electron` `react-flow`
- 勾选「Releases」「Packages」以外的项目时可以去掉不需要的；社交预览图（Settings → Social preview）可以用 `docs/images/pipeline.webp` 转成的 1280×640 PNG：[social-preview.png](./social-preview.png)。
