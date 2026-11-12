# 使用指南 · 部署成多人使用的网站（账号模式）

把海柱无限画布部署成一个网站：访客在首页注册账号，每个人得到一个**独立的工作空间**——自己的画布、模型档案（自带 API Key）、素材、生成记录和备份，彼此看不见。本页讲怎么部署、怎么管理账号，以及这种模式的安全设计与限制。

> 只给自己或一个小团队共用一个空间？用访问令牌（`HZC_TOKEN`）更简单，见[项目包、桌面版与部署](./projects-and-desktop.md#webui--docker-部署)。两种模式二选一。

## 快速部署（Docker + HTTPS 反向代理）

1. 准备一台有公网地址的服务器和一个域名（下面以 `canvas.example.com` 为例），安装 Docker。
2. 在仓库目录创建 `.env`：

   ```bash
   HZC_ACCOUNTS=1
   HZC_ALLOWED_HOSTS=canvas.example.com
   HZC_TRUST_PROXY=1
   HZC_HSTS=1
   HZC_SECURE_COOKIES=1
   HZC_SIGNUP=open          # closed：只能由管理员开通账号
   HZC_USER_QUOTA_MB=2048   # 每个账号的存储上限
   ```

3. 让容器端口只监听本机：把 `docker-compose.yml` 里的 `"8787:8787"` 改成 `"127.0.0.1:8787:8787"`，然后 `docker compose up -d --build`。
4. 在前面放一个反向代理终结 HTTPS，例如 Caddy（自动申请证书）：

   ```
   canvas.example.com {
     reverse_proxy 127.0.0.1:8787
   }
   ```

5. 打开 `https://canvas.example.com/`：访客看到首页，点「免费注册」即可开始。

## 环境变量（账号模式）

| 变量 | 说明 |
| --- | --- |
| `HZC_ACCOUNTS=1` | 开启账号模式（注册 / 登录，每人一个独立空间）。不需要 `HZC_TOKEN` |
| `HZC_ALLOWED_HOSTS` | **必填**（监听非本机地址时）：访客打开的域名或地址，逗号分隔。其他域名的请求一律拒绝（防 DNS 重绑定） |
| `HZC_SIGNUP` | `open`（默认）允许自助注册；`closed` 只能用管理命令开通 |
| `HZC_USER_QUOTA_MB` | 每个账号的素材与生成结果存储上限，默认 2048 MB；满了上传和生成会提示，用户可在「素材库」删除文件腾出空间 |
| `HZC_SECURE_COOKIES=1` | 登录 Cookie 只通过 HTTPS 发送。不设置时按请求是否为 HTTPS 自动决定（反向代理后面需要 `HZC_TRUST_PROXY=1` 才能识别） |
| `HZC_TRUST_PROXY=1` | 前面有反向代理时开启：识别访客真实地址（登录失败锁定按地址计算）和 HTTPS |
| `HZC_HSTS=1` | 通过 HTTPS 访问时让浏览器以后只用 HTTPS |
| `HZC_BLOCK_PRIVATE_NETWORK` | 账号模式下**默认开启**：用户填的模型地址和结果链接不能指向服务器本机或内网。确实要让用户用内网模型时才设为 `0` |
| `HZC_MAX_PARALLEL` | 每个账号同时进行的模型调用数（1–8，默认 4） |
| `HZC_MAX_FFMPEG` | 整台服务器同时运行的 FFmpeg 进程数（导出成片、视频反推），默认 CPU 核数的一半（1–4） |
| `HZC_BACKUP_HOURS` / `HZC_BACKUP_KEEP` | 备份间隔与保留份数（每个账号的数据库、账号库各自备份） |

## 管理账号

没有邮件服务也能管理（忘记密码由管理员重置）。在服务器上运行：

```bash
docker compose exec haizhu-canvas node server/index.mjs admin users                    # 列出账号
docker compose exec haizhu-canvas node server/index.mjs admin create-user a@example.com # 开通账号，输出临时密码
docker compose exec haizhu-canvas node server/index.mjs admin reset-password a@example.com # 重置密码，所有设备退出登录
docker compose exec haizhu-canvas node server/index.mjs admin disable a@example.com    # 停用（数据保留）；enable 恢复
docker compose exec haizhu-canvas node server/index.mjs admin delete-user a@example.com # 删除账号及其全部数据
```

用户自己可以在「设置 → 账号」里：查看存储用量、修改密码（其他设备随之退出）、退出其他设备、退出登录、删除账号（需要密码并输入「删除」确认，删除全部数据）。

## 数据放在哪里

```
/data
├── accounts.sqlite          账号与登录会话（只保存会话令牌的哈希）
├── master.key               API Key 的加密密钥（所有账号共用，务必一起备份）
├── backups/accounts-*.sqlite
└── users/<账号 id>/          一个账号一个文件夹
    ├── hzc.sqlite           画布、模型档案（Key 已加密）、生成记录
    ├── assets/              素材与生成结果
    ├── skills/              导入的 Skill
    └── backups/hzc-*.sqlite 这个账号的数据库备份
```

- 每个账号的数据库在启动或首次使用时做完整性检查，损坏时自动换成最近一份完好的备份。
- 整机备份：定期把整个 `/data` 卷（含 `master.key`）复制到另一台机器或对象存储。

## 安全设计

- **隔离**：每个账号一个独立的数据库文件和文件夹。请求先确认登录身份，再只打开这个账号的空间，所以不存在「忘了加用户条件」导致看到别人数据的查询。测试覆盖了用别人的画布 id、素材 id、模型档案 id、运行 id 访问——一律 404。
- **密码**：scrypt 加盐哈希（N=2^15），恒定时间比较；不存在的邮箱也做同样的计算，不能靠响应时间判断某个邮箱是否注册过。拒绝 8 位以下、纯重复和常见弱密码。
- **会话**：256 位随机令牌放在 HttpOnly、SameSite=Lax 的 Cookie 里（HTTPS 下为 `__Host-` 前缀 + Secure），数据库只存它的哈希；30 天滑动过期；每次登录发新会话；改密码会让其他会话失效。
- **防跨站**：所有修改类请求检查 `Origin` / `Sec-Fetch-Site`，其他网站既不能借用户的登录状态操作，也不能把用户登录到别的账号。
- **防暴力破解**：同一地址 10 分钟内登录失败 10 次锁定 10 分钟；同一账号 1 小时内失败 30 次锁定；同一地址每小时最多注册 5 个账号。
- **防滥用**：每个账号的存储上限；FFmpeg 全服务器限量；用户的模型地址不能访问服务器内网和云主机元数据；手动备份每分钟最多一次。
- 其余保护与单人部署相同：内容安全策略、禁止嵌入、素材文件沙箱、内部错误不外泄等，见[安全部署清单](./projects-and-desktop.md#安全部署清单)。

## 目前的限制

- 没有邮件验证与「忘记密码」邮件：注册不验证邮箱，找回密码需要管理员重置。
- 没有付费 / 套餐：用户自带模型 Key，自己向服务商付费；网站本身只有存储上限。
- 没有团队共享：每个账号的空间只属于自己；共享画布可以导出项目包（.hzc）发给别人导入。
- 原来以令牌模式运行的数据（`/data/hzc.sqlite`）不会自动并入某个账号：切换前在「我的画布」里把需要的画布导出为项目包，注册后再导入。
