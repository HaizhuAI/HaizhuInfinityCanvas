# Haizhu Infinity Canvas · 服务器版 / server package

网页版（WebUI），不需要 Docker：解压后用 Node.js 直接运行。
The web version without Docker: unpack and run with Node.js.

## 需要 / Requirements

- Node.js **22.13 或更高** / 22.13 or newer（`node -v`）
- 可选 / optional：FFmpeg（视频反推、拆镜头、导出成片 / video reverse, shot splitting, export）

## 启动 / Start

```sh
./start.sh                         # 只在本机访问 / this machine only: http://127.0.0.1:8787
HZC_HOST=0.0.0.0 HZC_TOKEN=换成一串长随机字符 ./start.sh   # 局域网 / 服务器访问（必须设访问口令）
```

- 数据默认放在解压目录的 `data/`，可用 `HZC_DATA_DIR` 改到别处；升级时保留它即可。
  Data lives in `data/` next to this file (`HZC_DATA_DIR` to move it); keep it when upgrading.
- 监听非本机地址时**必须**设置 `HZC_TOKEN`（单一工作区），或 `HZC_ACCOUNTS=1` 加 `HZC_ALLOWED_HOSTS`（注册登录、每人独立空间）。
  Listening beyond localhost requires `HZC_TOKEN`, or `HZC_ACCOUNTS=1` with `HZC_ALLOWED_HOSTS`.
- 端口 / port：`PORT=8787`。放在 HTTPS 反向代理后面时设 `HZC_TRUST_PROXY=1`、`HZC_HSTS=1`。
- 全部选项见 / all options: docs/03-guide/projects-and-desktop.md、docs/03-guide/saas-deployment.md（GitHub 仓库）。

## 开机自启（systemd 示例）/ run as a service

```ini
[Service]
WorkingDirectory=/opt/haizhu-infinity-canvas
Environment=HZC_HOST=0.0.0.0 HZC_TOKEN=换成一串长随机字符
ExecStart=/opt/haizhu-infinity-canvas/start.sh
Restart=on-failure
User=haizhu
```

第三方许可见 `THIRD_PARTY_NOTICES.md`；本软件许可见 `LICENSE`。
Third-party notices: `THIRD_PARTY_NOTICES.md`; licence: `LICENSE`.
