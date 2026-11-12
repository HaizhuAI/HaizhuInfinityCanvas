# 构建与发布矩阵

| 产物 | 平台 | 打包 | 构建环境 | 首次产出 |
| --- | --- | --- | --- | --- |
| WebUI（源码运行） | 任意有 Node 22 的机器 | `pnpm build && node apps/server/dist/index.mjs`（单文件自包含，无需 node_modules），服务同时托管前端静态文件 | 本地/CI | beta.1 |
| WebUI（容器） | Linux amd64/arm64 | Docker 镜像（多阶段构建，内含 FFmpeg；构建阶段在 runner 本机架构上跑一次，arm64 镜像在 QEMU 下构建并启动验证） | GitHub Actions ubuntu | beta.1 骨架 / beta.5 含 FFmpeg / rc.16 arm64 验证 |
| Windows 桌面 | Win10/11 x64 | electron-builder：NSIS 安装包 + portable `.exe` | **GitHub Actions `windows-latest`**（Windows 安装包需 Windows 环境构建，沙箱内不做） | beta.1 骨架 / beta.7 打磨 |
| Linux 桌面 | x64 / arm64 | electron-builder：AppImage + `.deb` | GitHub Actions `ubuntu-latest`（arm64 交叉打包） | beta.1 骨架 / beta.7 打磨 / rc.16 arm64 |
| macOS 桌面 | arm64 / x64 | electron-builder：dmg + zip（临时签名，未公证） | GitHub Actions `macos-latest`（Apple 芯片） | rc.16 |

## 流水线（beta.1 建立）

1. `ci.yml`（每次 push/PR）：安装依赖 → 类型检查 → 单元测试 → 构建前端与服务。
2. `release.yml`（打 `v*` tag 触发）：矩阵构建 Win/Linux 桌面包 + Docker 镜像 → 上传为 Release 草稿资产（草稿 = 私有，符合暂不公开源码的要求）。
3. 产物命名：`HaizhuInfinityCanvas-<version>-<os>-<arch>.<ext>`；Windows 的安装包与便携版分别加 `-setup` / `-portable`，例如 `HaizhuInfinityCanvas-1.0.0-rc.1-win-x64-setup.exe`、`HaizhuInfinityCanvas-1.0.0-rc.1-win-x64-portable.exe`（rc.1 之前两者同名，便携版覆盖了安装包）。

## FFmpeg 分发策略（beta.5 起实际执行）

- 桌面版：**不内置** FFmpeg。使用系统 PATH 中的 `ffmpeg` / `ffprobe`，或 `HZC_FFMPEG` / `HZC_FFPROBE`；设置 → 关于 显示状态与安装方法。这样安装包不包含任何 GPL / LGPL 编码器。
- Docker：镜像内安装 Debian 的 FFmpeg 软件包（GPL 构建）。镜像目前只在 CI 中构建、未公开发布；公开发布前见 [许可证审计](../00-research/02-license-audit.md) 的 FFmpeg 一节。

## 启动测试（rc.1 起）

`Build installers` 流水线在打包后真正启动应用：Linux 在虚拟显示（xvfb）下运行 `linux-unpacked`，Windows 在 `windows-latest` 上运行 `win-unpacked` 里的程序，macOS 在 `macos-latest` 上运行 Apple 芯片版（先校验签名）。应用以 `HZC_SMOKE=1` 启动内置服务、加载界面、把结果写到 `HZC_SMOKE_OUT` 文件后退出；找不到「window ready」即判定失败。

rc.16 起冒烟测试还会：故意杀掉后台服务，确认应用自动重启它并重新显示界面；打开 Agent 接入，用应用自己的程序（Node 模式）运行 MCP 桥接脚本，完成 initialize、tools/list 和一次工具调用（「mcp bridge ok」）。arm64 Linux 包与 Intel Mac 包是交叉打包的，没有在对应硬件上启动过。

## 本地验证边界（诚实声明）

当前开发在 Linux 云沙箱中进行，可验证：WebUI 构建与运行、服务 API、前端 E2E（预装 Chromium）、Linux 桌面包的构建。
**不能在沙箱内验证**：Windows / macOS 安装包的构建与安装、Linux 桌面包在真实桌面环境中的启动（无显示服务，可用 xvfb 做冒烟）。这些由 CI 构建与启动测试 + 你在真机上测试覆盖。
