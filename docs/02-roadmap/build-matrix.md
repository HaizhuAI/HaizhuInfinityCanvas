# 构建与发布矩阵

| 产物 | 平台 | 打包 | 构建环境 | 首次产出 |
| --- | --- | --- | --- | --- |
| WebUI（源码运行） | 任意有 Node 22 的机器 | `pnpm build && node apps/server/dist/index.mjs`（单文件自包含，无需 node_modules），服务同时托管前端静态文件 | 本地/CI | beta.1 |
| WebUI（容器） | Linux amd64/arm64 | Docker 镜像（多阶段构建，内含 FFmpeg） | GitHub Actions ubuntu | beta.1 骨架 / beta.5 含 FFmpeg |
| Windows 桌面 | Win10/11 x64 | electron-builder：NSIS 安装包 + portable `.exe` | **GitHub Actions `windows-latest`**（Windows 安装包需 Windows 环境构建，沙箱内不做） | beta.1 骨架 / beta.7 打磨 |
| Linux 桌面 | x64 | electron-builder：AppImage + `.deb` | GitHub Actions `ubuntu-latest` | beta.1 骨架 / beta.7 打磨 |
| macOS | arm64/x64 | dmg | — | v2.0 |

## 流水线（beta.1 建立）

1. `ci.yml`（每次 push/PR）：安装依赖 → 类型检查 → 单元测试 → 构建前端与服务。
2. `release.yml`（打 `v*` tag 触发）：矩阵构建 Win/Linux 桌面包 + Docker 镜像 → 上传为 Release 草稿资产（草稿 = 私有，符合暂不公开源码的要求）。
3. 产物命名：`HaizhuInfinityCanvas-<version>-<os>-<arch>.<ext>`，例如 `HaizhuInfinityCanvas-1.0.0-beta.1-win-x64.exe`。

## FFmpeg 分发策略

- 桌面版：随包携带 FFmpeg **独立可执行文件**（优先 LGPL 构建），放在应用资源目录，子进程调用。
- Docker：镜像内安装发行版 FFmpeg。
- 发布前专项复核许可证（见 [许可证审计](../00-research/02-license-audit.md)）。

## 本地验证边界（诚实声明）

当前开发在 Linux 云沙箱中进行，可验证：WebUI 构建与运行、服务 API、前端 E2E（预装 Chromium）、Linux 桌面包的构建。
**不能在沙箱内验证**：Windows 安装包的构建与安装、Linux 桌面包在真实桌面环境中的启动（无显示服务，可用 xvfb 做冒烟）。这两项由 CI 构建 + 你在真机上测试覆盖。
