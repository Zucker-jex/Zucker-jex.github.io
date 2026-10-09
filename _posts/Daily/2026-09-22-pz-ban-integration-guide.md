---
title: Project Zomboid Server Shared Ban Integration Guide
key: pzbanserver
tags: ["Daily"]
aside:
  toc: true
---

# PZ 服务器联 Ban 接入说明书 <!--more-->

**更新**：2026-10-09
**注意**：由于已获取ICP备案所以均使用标准端口提供服务（原8088现已改为443/80），请手动修改接入脚本或获取完整接入脚本并重新配置
**适用**：僵尸毁灭工程（Project Zomboid）专用服务器（Linux / Windows 均可）
**目标**：让 PZ 服务器的封禁列表自动与中心 Ban 服器（banserver）保持同步，并提供完整的网页端管理界面

> **路径说明**：本文中出现的 `/home/debian/pz-bansync/`、`/home/debian/Zomboid/...`、`User=debian`、`/usr/bin/python3` 等均为 **Linux 示例路径/用户名**，不是强制路径。请按你的实际服务器系统和用户名替换。
>
> **Linux 与 Windows 服务器均可接入**。Windows 示例路径如 `C:\pz-bansync\`、`C:\Users\你的用户名\Zomboid\...`。systemd 章节仅适用于 Linux；Windows 可使用任务计划程序、NSSM、WinSW 等方式常驻运行。
>
> **接入前必须先注册 Web 端并等待管理员审批**，见 **第 1 节**。
> 想最快接入：**第 1 节 → 第 2 节 → 第 5 节 → 第 6 节 → 第 8 节 → 第 9 节**。

---

## 目录

1. [接入前准备：注册 Web 端并获取服主账户密码](#1-接入前准备注册-web-端并获取服主账户密码)
2. [快速接入总览](#2-快速接入总览)
3. [前置条件](#3-前置条件)
4. [脚本版本选择：域名版 / IP 直连版](#4-脚本版本选择域名版--ip-直连版)
5. [完整同步脚本](#5-完整同步脚本)
6. [配置说明](#6-配置说明)
7. [同步模式](#7-同步模式)
8. [部署与启动](#8-部署与启动)
9. [验证同步效果](#9-验证同步效果)
10. [日志解读](#10-日志解读)
11. [常见问题](#11-常见问题)
12. [故障排查](#12-故障排查)
13. [网页端完整使用教程（登录后功能）](#13-网页端完整使用教程登录后功能)
14. [安全建议](#14-安全建议)
15. [卸载](#15-卸载)
16. [附录](#16-附录)
17. [使用流程全景图](#17-使用流程全景图)

---

## 1. 接入前准备：注册 Web 端并获取服主账户密码

> 接入 PZ 同步脚本前，必须先完成本节。
> 脚本里的 `API_USERNAME` / `API_PASSWORD` 就来自 banserver 网页端账号。未审批通过无法登录，也无法同步。

### 1.1 网页入口

| 项       | 值                                              |
| -------- | ----------------------------------------------- |
| 访问地址 | `https://banserver.zuckertech.cn`          |
| 登录页   | `https://banserver.zuckertech.cn/login`    |
| 注册页   | `https://banserver.zuckertech.cn/register` |
| 协议     | HTTPS（Let's Encrypt 证书）                     |

⚠️ **首次访问**：浏览器地址栏应显示 🔒 锁标；如提示证书风险，检查 DNS 是否指向正确 IP。

### 1.2 注册账号

打开：

```text
https://banserver.zuckertech.cn/register
```

或从登录页底部点击“**注册**”链接。

填写注册信息：

| 字段     | 要求        | 说明                         |
| -------- | ----------- | ---------------------------- |
| 用户名   | 3~30 字符   | 支持字母、数字、下划线、中文 |
| 密码     | 8~128 字符  | 建议混合大小写 + 数字 + 符号 |
| 确认密码 | 同上        | 二次输入                     |
| QQ 号    | 5~12 位数字 | 用于联系和身份核验           |
| 邮箱     | 可选        | 便于密码重置（若开启）       |

> **用户名命名建议**：用 Steam 昵称或服务器名，方便其他服主识别。

点击“注册”按钮。成功后会提示：

```text
注册成功，等待管理员审批
```

此时账号状态为 **pending**（待审批）。

### 1.3 等待管理员审批

- **无法立即登录**，需要管理员在后台审批。
- 审批通过后，状态变为 **active**，即可登录。
- 审批一般由 **服主（owner）** 或 **管理员（admin）** 操作。

**催促审批**：联系管理员（在冲突提示页会显示管理员的 QQ/邮箱）。

### 1.4 登录

打开：

```text
https://banserver.zuckertech.cn/login
```

输入凭据：

| 字段 | 可填             |
| ---- | ---------------- |
| 账号 | 用户名 或 QQ 号  |
| 密码 | 注册时设置的密码 |

登录后跳转到 `/dashboard`（仪表盘）。

**登录态保持**：access_token 默认 24 小时，refresh_token 7 天，到期自动刷新。

### 1.5 添加自己的服务器

侧边栏 →「**我的服务器**」→ 点右上角“**添加服务器**” → 输入服务器名称 → 提交。

> 添加服务器用于后续在网页端提交封禁。
> 同步脚本本身拉取的是全站生效封禁，但网页端管理封禁需要服务器归属。

管理服务器（重命名、删除）见 **第 13.6 节**。

### 1.6 准备脚本用 API 凭据

脚本配置区需要填写：

| 配置项         | 值                                              |
| -------------- | ----------------------------------------------- |
| `API_BASE`     | `https://banserver.zuckertech.cn`          |
| `API_USERNAME` | 你的 banserver 用户名                           |
| `API_PASSWORD` | 你的 banserver 密码                             |

说明：

- `API_USERNAME`：建议填注册用户名。
- `API_PASSWORD`：填注册密码。
- 安全建议：**不要用 admin 账号跑脚本**。如果管理员支持创建同步专用账号，优先使用专用只读账号。
- 若你修改过用户名/密码，以修改后的为准。

---

## 2. 快速接入总览

**最短路径：**

1. 打开 banserver 网页注册账号，等待管理员审批通过。
2. 登录网页，添加自己的服务器。
3. 记录脚本要用的 `API_USERNAME` / `API_PASSWORD`。
4. 在 PZ 服务器上创建目录并下载同步脚本（**Linux / Windows 均可**）。
5. 修改脚本顶部配置区：`API_BASE`、`API_USERNAME`、`API_PASSWORD`、RCON、PZ 数据库路径。路径请按实际系统替换，不要照抄示例路径。
6. 开启 PZ RCON，并确认数据库路径可读。
7. 手动运行脚本，确认能登录 API、连接 RCON、同步封禁。
8. 部署为系统服务：Linux 用 systemd；Windows 用任务计划程序/NSSM/WinSW 等。
9. 在网页添加一条测试封禁，等待 5 分钟，检查 PZ 数据库是否生效。
10. 观察 3~5 轮日志，确认 `待新增: 0 | 待移除: 0`。

**数据流向：**

- 服主/管理员 → 网页端添加/修改/撤销封禁 → banserver
- banserver → 脚本每 5 分钟拉取 → PZ 服务器（通过 RCON）

| 差异类型          | 含义                 | 脚本动作                                 |
| ----------------- | -------------------- | ---------------------------------------- |
| API 有、PZ 无     | banserver 新增了封禁 | 执行 `banid <SteamID>`                   |
| PZ 有、API 无     | banserver 上已解封   | 执行 `unbanid <SteamID>`（仅 full 模式） |
| 两边都有 / 都没有 | 已一致               | 不做任何操作                             |

**执行周期**：默认 5 分钟一次（`SYNC_INTERVAL = 300`）
**接口说明**：脚本调用 `GET /api/external/bans`，返回全站生效封禁，只包含 `steam_id` 和 `reason`。

---

## 3. 前置条件

### 3.1 banserver 侧

| 项         | 要求                                       |
| ---------- | ------------------------------------------ |
| 可访问地址 | 如 `https://banserver.zuckertech.cn`  |
| 有效账号   | 任意已审批通过的服主或管理员账号           |
| HTTPS 证书 | 必须被 PZ 服务器信任（Let's Encrypt 即可） |

**验证方法**（在 PZ 服务器上执行，Linux 示例）：

```bash
curl -s https://banserver.zuckertech.cn/health
# 期望：{"status":"ok","timestamp":"..."}
```

Windows PowerShell 等价：

```powershell
Invoke-RestMethod -Uri "https://banserver.zuckertech.cn/health"
# 期望返回 status: ok
```

### 3.2 PZ 服务器侧

以下检查命令以 Linux 为例；Windows 服务器同样可接入，路径通常为 `%UserProfile%\Zomboid\...`。

| 项             | 要求                                     | Linux 检查命令                              | Windows 检查方式 |
| -------------- | ---------------------------------------- | ------------------------------------------- | ---------------- |
| Python 3.9+    | 内置即可，无需 pip                       | `python3 --version`                         | `python --version` 或 `py --version` |
| RCON 已开启    | `.ini` 里有 `RCONPort` 和 `RCONPassword` | `grep -i rcon ~/Zomboid/Server/*.ini`       | `Select-String -Path "$env:USERPROFILE\Zomboid\Server\*.ini" -Pattern "RCON"` |
| RCON 端口可达  | `127.0.0.1:27015`                        | `nc -zv 127.0.0.1 27015`                    | `Test-NetConnection 127.0.0.1 -Port 27015` |
| 数据库可读     | `~/Zomboid/db/servertest.db`             | `ls -la ~/Zomboid/db/servertest.db`         | `Get-Item "$env:USERPROFILE\Zomboid\db\servertest.db"` |
| `sqlite3` 命令 | 可选（人工核查用）                       | `sqlite3 --version`                         | `sqlite3.exe --version`（若已安装） |

### 3.3 开启 RCON（如未开启）

Linux 编辑 `~/Zomboid/Server/servertest.ini`；Windows 编辑 `%UserProfile%\Zomboid\Server\servertest.ini`。

```ini
RCONPort=27015
RCONPassword=改成你的强密码（≥32 位随机字符）
```

**重启 PZ 服务器** 使配置生效。

### 3.4 实测环境参考

以下为 Linux 示例，Windows 请替换为实际路径。

| 项                | 值                                          |
| ----------------- | ------------------------------------------- |
| RCON 端口         | `27015`（示例，实际以 `.ini` 为准）         |
| 数据库路径        | `/home/debian/Zomboid/db/servertest.db`     |
| `bannedid` 表结构 | `(steamid TEXT NOT NULL, reason TEXT NULL)` |
| `banid` 命令      | ✅ 支持，返回 `System banned SteamID xxx()` |
| `unbanid` 命令    | ✅ 支持，返回 `SteamID xxx is now unbanned` |

---

## 4. 脚本版本选择：域名版 / IP 直连版

本接入方案提供两个版本，功能相同，差异在网络访问方式。脚本为 Python 脚本，**Linux 与 Windows 服务器均可运行**。

| 项             | 域名版（推荐用于普通网络）             | IP 直连版（推荐用于受限网络）  |
| -------------- | -------------------------------------- | ------------------------------ |
| 文件名         | `pz-bansync.py`                        | `pz-bansync-ip.py`             |
| API_BASE       | `https://banserver.zuckertech.cn` | `https://47.95.157.144`   |
| HTTPS 证书校验 | ✅ 严格校验（CA 验证 + 域名匹配）      | ❌ 跳过校验（`CERT_NONE`）     |
| 适用网络       | 可正常访问域名的网络                   | 对特定域名有阻断的网络         |
| 安全性         | 高                                     | 中（可被中间人攻击）           |
| 维护性         | 高（服务器 IP 变更无需改配置）         | 低（服务器 IP 变更需手动更新） |

### 4.1 域名版（`pz-bansync.py`）

- 使用标准 HTTPS 校验。
- 证书由 Let's Encrypt 签发，浏览器/脚本都信任。
- 服务器换 IP 时，只需更新 DNS，脚本无需改动。
- **默认推荐版本。**
- 下载：[pz-bansync.py（域名版）]()
- Windows 同样可用 PowerShell `Invoke-WebRequest` 下载后运行。

### 4.2 IP 直连版（`pz-bansync-ip.py`）

- 使用 IP 直连，绕过 DNS 解析。
- 关闭 HTTPS 证书校验：`ctx.check_hostname = False` + `ctx.verify_mode = ssl.CERT_NONE`。
- 服务器 IP 变更时需手动改配置。
- **只在域名访问失败的特定网络环境下使用。**
- 下载：[pz-bansync-ip.py（IP 直连版）]()
- Windows 同样可用。

### 4.3 如何判断用哪版

在 PZ 服务器上执行：

Linux：

```bash
# 用域名（若失败，说明存在 SNI 阻断）
curl -kI https://banserver.zuckertech.cn/health

# 用 IP（若成功，说明 IP 直连可行）
curl -kI https://47.95.157.144/health
```

Windows PowerShell：

```powershell
# 用域名
Invoke-WebRequest -Uri "https://banserver.zuckertech.cn/health" -Method Head

# 用 IP
Invoke-WebRequest -Uri "https://47.95.157.144/health" -Method Head
```

- **两个都通** → 用**域名版**
- **域名不通、IP 通** → 用 **IP 直连版**
- **两个都不通** → 是其他网络问题，需单独排查

### 4.4 两版差异对照

| 差异点         | 域名版                                      | IP 直连版                                  |
| -------------- | ------------------------------------------- | ------------------------------------------ |
| `API_BASE`     | `https://banserver.zuckertech.cn`      | `https://47.95.157.144`               |
| HTTPS 证书校验 | 严格校验（CA 验证 + 域名匹配）              | 跳过校验（`check_hostname=False`、`CERT_NONE`） |
| 适用网络       | 可正常访问域名的网络                        | 域名被阻断、但 IP 可直连的网络              |
| 维护方式       | 服务器换 IP 只需更新 DNS，脚本无需改动      | 服务器 IP 变更需手动更新配置                |

除上述网络访问相关差异外，两版功能与配置项完全一致。

### 4.5 长期建议

IP 直连版是临时方案，原因：

- 服务器 IP 一旦变更，所有使用 IP 直连版的服务器都要手动更新。
- 跳过证书校验存在中间人风险。
- 无法利用 DNS 负载均衡、CDN 等基础设施。

推荐长期方案：

1. 换一个未被阻断的域名。
2. 使用 SSH 隧道。
3. 联系网络管理员解除域名阻断。

---

## 5. 完整同步脚本

完整 Python 脚本不再直接内嵌在本文中，请根据第 4 节的网络判断结果下载对应版本：

| 版本           | 文件名            | 下载链接                                                                 | 适用场景                                      |
| -------------- | ----------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| 域名版（推荐） | `pz-bansync.py`   | [下载 pz-bansync.py（域名版）](https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync.py) | 可正常访问 `banserver.zuckertech.cn`     |
| IP 直连版      | `pz-bansync-ip.py` | [下载 pz-bansync-ip.py（IP 直连版）](https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync-ip.py) | 域名访问失败、但可直连 `47.95.157.144`   |

> **路径只是示例**：下文统一保存为 `/home/debian/pz-bansync/pz-bansync.py` 只是 Linux 示例路径。
> Windows 可保存为 `C:\pz-bansync\pz-bansync.py`，其他 Linux 用户也可改成 `/opt/pz-bansync/`、`/srv/pz-bansync/` 等。后续 systemd、日志、权限路径都要同步替换。

Linux 下载示例：

```bash
mkdir -p /home/debian/pz-bansync

# 域名版
curl -fsSL https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync.py -o /home/debian/pz-bansync/pz-bansync.py

# 或：IP 直连版
curl -fsSL https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync-ip.py -o /home/debian/pz-bansync/pz-bansync.py
```

Windows PowerShell 下载示例：

```powershell
New-Item -ItemType Directory -Force C:\pz-bansync

# 域名版
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync.py" -OutFile "C:\pz-bansync\pz-bansync.py"

# 或：IP 直连版
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync-ip.py" -OutFile "C:\pz-bansync\pz-bansync.py"
```

两版差异、证书校验和适用网络见 **第 4 节**。下载后按 **第 6 节** 修改脚本顶部配置区。

---

## 6. 配置说明

修改脚本顶部 **配置区**。

> 下表路径均为示例，请按实际系统替换。
> Linux 常见：`/home/你的用户名/pz-bansync/pz-bansync.py`、`/home/你的用户名/Zomboid/db/servertest.db`
> Windows 常见：`C:\pz-bansync\pz-bansync.py`、`C:\Users\你的用户名\Zomboid\db\servertest.db`

| 变量            | 说明                                   | 示例                                     |
| --------------- | -------------------------------------- | ---------------------------------------- |
| `API_BASE`      | banserver HTTPS 地址，**末尾不带斜杠** | `https://banserver.zuckertech.cn`   |
| `API_USERNAME`  | banserver 登录用户名                   | `sync_bot`                               |
| `API_PASSWORD`  | 对应密码                               | —                                        |
| `RCON_HOST`     | PZ 的 RCON 地址，本机填 `127.0.0.1`    | `127.0.0.1`                              |
| `RCON_PORT`     | 与 `.ini` 里 `RCONPort` 一致           | `27015`                                  |
| `RCON_PASS`     | 与 `.ini` 里 `RCONPassword` 一致       | —                                        |
| `PZ_DB`         | PZ 的 SQLite 绝对路径                  | Linux：`/home/debian/Zomboid/db/servertest.db`；Windows：`C:\Users\debian\Zomboid\db\servertest.db` |
| `SYNC_INTERVAL` | 同步间隔（秒）                         | `300`                                    |
| `SYNC_MODE`     | 同步模式                               | `full` 或 `add_only`                     |
| `LOG_FILE`      | 日志文件路径                           | Linux：`/home/debian/pz-bansync/pz-bansync.log`；Windows：`C:\pz-bansync\pz-bansync.log` |

---

## 7. 同步模式

脚本支持两种同步模式，通过配置区 `SYNC_MODE` 切换。

### 7.1 `full` —— 完全同步（默认）

- **行为**：新增 + 移除都同步。
- **结果**：PZ 的封禁列表与 banserver **完全一致**。
- **适用**：banserver 是唯一权威源，PZ 完全从属。

**示例：**

| 场景 | banserver | PZ 当前  | 执行后 PZ |
| ---- | --------- | -------- | --------- |
| 新增 | `[A, B]`  | `[B, C]` | `[A, B]`  |
| 解封 | `[A]`     | `[A, B]` | `[A]`     |

### 7.2 `add_only` —— 只增不减

- **行为**：只把 banserver 的新封禁加到 PZ，**不解封**。
- **结果**：PZ 封禁列表只会增加，不会减少。
- **适用**：
  - PZ 上已有大量服主手动封禁的历史记录。
  - 首次接入、测试阶段。
  - PZ 是主服，banserver 只是补充来源。

**示例：**

| 场景 | banserver | PZ 当前  | 执行后 PZ        |
| ---- | --------- | -------- | ---------------- |
| 新增 | `[A, B]`  | `[B, C]` | `[A, B, C]`      |
| 解封 | `[A]`     | `[A, B]` | `[A, B]`（不动） |

### 7.3 模式选择建议

| 你的场景                        | 推荐模式                       |
| ------------------------------- | ------------------------------ |
| banserver 中心管控，PZ 被动接收 | `full`                         |
| PZ 有历史封禁，不想被清         | 先 `add_only`，稳定后切 `full` |
| 担心脚本误删                    | `add_only`                     |
| 多人协作，要保持一致            | `full`                         |

---

## 8. 部署与启动

> 本章 Linux 与 Windows 均可接入。
> `/home/debian/pz-bansync` 只是 Linux 示例路径；Windows 示例为 `C:\pz-bansync`。
> systemd 仅适用于 Linux；Windows 请使用任务计划程序、NSSM、WinSW 等方式。

### 8.1 创建目录

Linux 示例：

```bash
mkdir -p /home/debian/pz-bansync
cd /home/debian/pz-bansync
```

Windows PowerShell 示例：

```powershell
New-Item -ItemType Directory -Force C:\pz-bansync
Set-Location C:\pz-bansync
```

> 再次强调：`/home/debian/pz-bansync` 和 `C:\pz-bansync` 都只是示例，可替换成你的真实目录。

### 8.2 下载并保存脚本

按第 5 节选择版本，并统一保存为 `pz-bansync.py`。

Linux 示例：

```bash
cd /home/debian/pz-bansync

# 域名版
curl -fsSL https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync.py -o pz-bansync.py

# 或：IP 直连版
curl -fsSL https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync-ip.py -o pz-bansync.py
```

Windows PowerShell 示例：

```powershell
Set-Location C:\pz-bansync

# 域名版
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync.py" -OutFile "pz-bansync.py"

# 或：IP 直连版
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Zucker-jex/BanServer_scripts/main/pz-bansync-ip.py" -OutFile "pz-bansync.py"
```

如果手动下载，也请将文件重命名为 `pz-bansync.py`，这样后续服务配置无需改动。

### 8.3 填写配置

按第 6 节表格修改脚本顶部配置区。注意 Windows 路径建议使用绝对路径，例如 `C:\Users\你的用户名\Zomboid\db\servertest.db`。

### 8.4 赋权

Linux 示例：

```bash
chmod +x /home/debian/pz-bansync/pz-bansync.py
```

Windows 通常不需要 `chmod`。建议用文件系统权限限制目录访问，例如只允许运行服务的账户读写 `C:\pz-bansync`。

### 8.5 手动测试运行

Linux：

```bash
cd /home/debian/pz-bansync
python3 pz-bansync.py
```

Windows PowerShell / CMD：

```powershell
cd C:\pz-bansync
python pz-bansync.py
# 或
py pz-bansync.py
```

**预期输出：**

```text
2026-09-25 17:26:00 [INFO] ============================================================
2026-09-25 17:26:00 [INFO] pz-bansync 启动
2026-09-25 17:26:00 [INFO]   API:      https://banserver.zuckertech.cn
2026-09-25 17:26:00 [INFO]   RCON:     127.0.0.1:27015
2026-09-25 17:26:00 [INFO]   DB:       /home/debian/Zomboid/db/servertest.db
2026-09-25 17:26:00 [INFO]   间隔:     300 秒
2026-09-25 17:26:00 [INFO]   同步模式: full（完全同步）
2026-09-25 17:26:00 [INFO] ============================================================
2026-09-25 17:26:01 [INFO] RCON connected
2026-09-25 17:26:01 [INFO] --------------------------------------------------
2026-09-25 17:26:01 [INFO] API active bans: 1
2026-09-25 17:26:01 [INFO] PZ current bans: 0
2026-09-25 17:26:01 [INFO] 待新增: 1 | 待移除: 0
2026-09-25 17:26:01 [INFO] [+] ban 76561198000000000 -> 'System banned SteamID 76561198000000000()'
```

看到 `RCON connected` + `同步模式` 打印正确，即为正常。按 `Ctrl+C` 停止。

### 8.6 Linux：部署为 systemd 服务

> 本节仅适用于 Linux。以下 `/home/debian/pz-bansync`、`User=debian` 均为示例，请替换为实际路径和用户名。

创建 service 文件：

```bash
sudo tee /etc/systemd/system/pz-bansync.service >/dev/null <<'EOF'
[Unit]
Description=PZ BanServer Sync
After=network.target

[Service]
Type=simple
User=debian
WorkingDirectory=/home/debian/pz-bansync
ExecStart=/usr/bin/python3 /home/debian/pz-bansync/pz-bansync.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

⚠️ **`User=debian` 改成 PZ 服务器的实际用户名**。
⚠️ **`/home/debian/pz-bansync` 只是示例路径**，请改成你的真实路径。
⚠️ `ExecStart` 中的 `/usr/bin/python3` 也可能因发行版不同而不同，可用 `which python3` 查看。

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pz-bansync
sudo systemctl status pz-bansync
```

### 8.7 Windows：部署为常驻服务 / 计划任务

Windows 没有 systemd，可使用以下任一方式。以下 `C:\pz-bansync`、`C:\Python311\python.exe` 均为示例，请按实际安装路径替换。

**方式 A：NSSM 注册为 Windows 服务**

1. 下载并安装 NSSM。
2. 以管理员身份打开 PowerShell/CMD：

```powershell
nssm install pz-bansync "C:\Python311\python.exe" "C:\pz-bansync\pz-bansync.py"
nssm set pz-bansync AppDirectory "C:\pz-bansync"
nssm set pz-bansync AppStdout "C:\pz-bansync\pz-bansync.out.log"
nssm set pz-bansync AppStderr "C:\pz-bansync\pz-bansync.err.log"
nssm start pz-bansync
```

查看状态：

```powershell
nssm status pz-bansync
```

**方式 B：任务计划程序**

以管理员身份执行：

```powershell
schtasks /Create /TN "pz-bansync" /TR "python C:\pz-bansync\pz-bansync.py" /SC ONSTART /RU SYSTEM /RL HIGHEST
schtasks /Run /TN "pz-bansync"
```

> 注意：`python` 需要能被系统 PATH 找到；如果找不到，请把 `/TR` 里的 `python` 改成完整路径，例如 `C:\Python311\python.exe`。

### 8.8 常用命令

| 操作     | Linux 命令                                             | Windows 示例 |
| -------- | ------------------------------------------------------ | ------------ |
| 查看状态 | `sudo systemctl status pz-bansync`                     | `nssm status pz-bansync` 或 `schtasks /Query /TN "pz-bansync"` |
| 实时日志 | `sudo journalctl -u pz-bansync -f`                     | `Get-Content C:\pz-bansync\pz-bansync.log -Wait` |
| 文件日志 | `tail -f /home/debian/pz-bansync/pz-bansync.log`       | `Get-Content C:\pz-bansync\pz-bansync.log -Wait` |
| 重启     | `sudo systemctl restart pz-bansync`                    | `nssm restart pz-bansync` 或 `schtasks /End` + `/Run` |
| 停止     | `sudo systemctl stop pz-bansync`                       | `nssm stop pz-bansync` 或 `schtasks /End /TN "pz-bansync"` |
| 关闭自启 | `sudo systemctl disable pz-bansync`                    | `nssm remove pz-bansync confirm` 或删除计划任务 |

---

## 9. 验证同步效果

### 9.1 添加封禁测试

1. 打开 banserver 网页（如 `https://banserver.zuckertech.cn`）。
2. 登录 → 添加封禁 → SteamID 填 `76561198000000001`。
3. 提交。

### 9.2 触发同步

等待 5 分钟，或立即重启脚本：

Linux：

```bash
sudo systemctl restart pz-bansync
```

Windows：

```powershell
nssm restart pz-bansync
# 或重新运行任务
schtasks /End /TN "pz-bansync"
schtasks /Run /TN "pz-bansync"
```

### 9.3 验证 PZ 端生效

Linux 示例：

```bash
sqlite3 /home/debian/Zomboid/db/servertest.db "SELECT * FROM bannedid;"
```

Windows 示例：

```powershell
sqlite3.exe "C:\Users\debian\Zomboid\db\servertest.db" "SELECT * FROM bannedid;"
```

预期看到：

```text
76561198000000001|<封禁原因>
```

### 9.4 解封测试（仅 full 模式）

1. banserver 网页撤销该封禁。
2. 等待 5 分钟 / 重启脚本。
3. 数据库里该条消失。

### 9.5 观察多轮日志

Linux：

```bash
sudo journalctl -u pz-bansync -f
```

Windows：

```powershell
Get-Content C:\pz-bansync\pz-bansync.log -Wait
```

连续观察几轮，确认每轮都是 `待新增: 0 | 待移除: 0`，说明两边已完全一致。

---

## 10. 日志解读

| 日志                                             | 含义                        | 处理                       |
| ------------------------------------------------ | --------------------------- | -------------------------- |
| `RCON connected`                                 | RCON 认证成功               | 正常                       |
| `[+] ban xxx -> 'System banned...'`              | 新封禁成功                  | 正常                       |
| `[-] unban xxx -> 'SteamID xxx is now unbanned'` | 解封成功                    | 正常                       |
| `（add_only 模式：N 条待移除记录已忽略）`        | add_only 模式跳过移除       | 正常                       |
| `API 登录失败`                                   | 账号密码错 / 网络不通       | 检查 `API_*`               |
| `RCON 连接失败`                                  | RCON 未开 / 端口错 / 密码错 | 检查 `.ini` 和 `RCON_PASS` |
| `读 PZ 数据库失败`                               | 路径错 / 权限不足           | 检查 `PZ_DB`               |
| `待新增: N \| 待移除: M`                         | 同步前差异统计              | 0/0 表示一致               |
| `SYNC_MODE 值非法`                               | 配置写错                    | 改成 `full` 或 `add_only`  |

---

## 11. 常见问题

### Q1：`API 登录失败: HTTP Error 401`

- banserver 账号或密码错。
- 检查 `API_USERNAME` / `API_PASSWORD`。
- 确认账号已审批通过。

### Q2：`RCON 连接失败: [Errno 111] Connection refused`

- PZ 没开 RCON：检查 `~/Zomboid/Server/*.ini` 里 `RCONPort` / `RCONPassword`。
- **改完 .ini 必须重启 PZ。**
- Windows 路径：`%UserProfile%\Zomboid\Server\*.ini`。

### Q3：`RCON 认证失败`

- `RCON_PASS` 与 `.ini` 里 `RCONPassword` 不一致。
- 复制粘贴时注意多余空格。

### Q4：`读 PZ 数据库失败`

- 检查 `PZ_DB` 路径：
  - Linux：`ls -la /home/debian/Zomboid/db/servertest.db`
  - Windows：`Get-Item "C:\Users\debian\Zomboid\db\servertest.db"`
- 权限检查：
  - Linux：`sudo -u debian cat /home/debian/Zomboid/db/servertest.db > /dev/null`
  - Windows：确认运行脚本的账户对数据库文件有读取权限。

### Q5：`banid` 返回 `Unknown command`

- PZ 服务端未重载。重启 PZ 后重试。
- 检查是否误发了带斜杠的命令：脚本里应是 `banid xxx` 而不是 `/banid xxx`。

### Q6：`API active bans: 0` 但 banserver 上确实有封禁

- 检查脚本调用的接口是否为 `/api/external/bans`。
- 旧接口 `/api/bans` 对普通服主只返回“自己提交的”，看不到别人的。
- 新接口 `/api/external/bans` 返回全站所有生效封禁。

### Q7：同步不及时

- 默认 5 分钟一轮。
- 想更快：`SYNC_INTERVAL = 60`，重启服务。

### Q8：PZ 里出现意外的封禁

- 可能是**其他服主**手动通过 RCON 加的。
- `full` 模式下，脚本会在下一轮把它解掉（banserver 里没有）。
- `add_only` 模式下不会被解掉，会一直保留。

### Q9：PZ 重启后同步停止

- Linux systemd 服务设了 `Restart=always`，会自动重连。
- Windows 使用 NSSM 服务或任务计划时，也应配置自动启动/失败重启。
- 检查服务状态：
  - Linux：`sudo systemctl status pz-bansync`
  - Windows：`nssm status pz-bansync`

### Q10：脚本执行用户对数据库无写权限

`pz_update_reason` 会失败，但**封禁仍然生效**（RCON 已执行）。日志会打印：

```text
写 reason 失败 (76561198...): attempt to write a readonly database
```

解决：让脚本运行用户对 `~/Zomboid/db/` 或 `%UserProfile%\Zomboid\db\` 有写权限。

### Q11：`SYNC_MODE 值非法` 警告

配置写成了别的东西，脚本会回退到 `full`。改成 `"full"` 或 `"add_only"`（**带引号**）。

---

## 12. 故障排查

### 12.1 分层排查思路

```text
网络 → HTTPS → 接口 → RCON → SQLite → 脚本逻辑
```

### 12.2 逐层验证

**① 网络层**

Linux：

```bash
curl -s https://banserver.zuckertech.cn/health
# 期望 {"status":"ok",...}
```

Windows：

```powershell
Invoke-RestMethod -Uri "https://banserver.zuckertech.cn/health"
```

**② 接口层（手动测试导出接口）**

Linux：

```bash
TOKEN=$(curl -s -X POST https://banserver.zuckertech.cn/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"你的账号","password":"你的密码"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s "https://banserver.zuckertech.cn/api/external/bans?limit=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Windows PowerShell 可用 `Invoke-RestMethod` 分两步获取 token 并请求。

**③ RCON 层**

Linux：

```bash
nc -zv 127.0.0.1 27015
# 期望 succeeded
```

Windows：

```powershell
Test-NetConnection 127.0.0.1 -Port 27015
```

**④ 数据库层**

Linux：

```bash
sqlite3 /home/debian/Zomboid/db/servertest.db "SELECT COUNT(*) FROM bannedid;"
# 期望返回数字
```

Windows：

```powershell
sqlite3.exe "C:\Users\debian\Zomboid\db\servertest.db" "SELECT COUNT(*) FROM bannedid;"
```

**⑤ 脚本层**

Linux：

```bash
cd /home/debian/pz-bansync
python3 pz-bansync.py
# 看启动日志和第一轮同步结果
```

Windows：

```powershell
cd C:\pz-bansync
python pz-bansync.py
```

### 12.3 日志采集

出问题时收集以下信息：

Linux：

```bash
# 服务状态
sudo systemctl status pz-bansync

# 最近 100 行日志
sudo journalctl -u pz-bansync -n 100

# 文件日志
tail -100 /home/debian/pz-bansync/pz-bansync.log

# PZ 数据库现状
sqlite3 /home/debian/Zomboid/db/servertest.db "SELECT * FROM bannedid;"

# banserver 侧数据
curl -s https://banserver.zuckertech.cn/api/public/bans | head -c 500
```

Windows：

```powershell
nssm status pz-bansync
Get-Content C:\pz-bansync\pz-bansync.log -Tail 100
sqlite3.exe "C:\Users\debian\Zomboid\db\servertest.db" "SELECT * FROM bannedid;"
Invoke-RestMethod -Uri "https://banserver.zuckertech.cn/api/public/bans" | ConvertTo-Json -Depth 5
```

---

## 13. 网页端完整使用教程（登录后功能）

> 注册、登录、添加服务器等接入前操作见 **第 1 节**。本节介绍登录后的完整功能。

### 13.1 界面总览

登录后左侧菜单：

#### 普通用户可见

| 菜单       | 路径             | 功能                      |
| ---------- | ---------------- | ------------------------- |
| 仪表盘     | `/dashboard`     | 统计概览、最近动态        |
| 我的封禁   | `/bans`          | 管理自己提交的封禁记录    |
| 所有封禁   | `/all-bans`      | 查看全站生效封禁          |
| 添加封禁   | `/bans/create`   | 提交新的封禁              |
| 介入申请   | `/interventions` | 查看/提交管理员介入申请   |
| 我的服务器 | `/servers`       | 管理自己名下的服务器      |
| 个人设置   | `/profile`       | 修改密码、修改用户名/邮箱 |

#### 管理员/服主可见（额外）

| 菜单       | 路径                   | 功能                          |
| ---------- | ---------------------- | ----------------------------- |
| 服主管理   | `/admin/users`         | 审批用户、禁用/启用、重置密码 |
| 服务器管理 | `/admin/servers`       | 查看所有服务器、删除并迁移    |
| 介入处理   | `/admin/interventions` | 处理别人的介入申请            |
| 联系方式   | `/admin/contacts`      | 维护公开显示的管理员联系方式  |
| 所有封禁   | `/admin/bans`          | 查看全站所有封禁记录          |
| 编辑公告   | `/admin/announcements` | 发布 / 管理公告               |

### 13.2 添加封禁

#### 步骤 1：进入添加页

侧边栏 → 「**添加封禁**」，或访问 `/bans/create`。

#### 步骤 2：填写信息

| 字段       | 必填 | 说明                              |
| ---------- | ---- | --------------------------------- |
| SteamID64  | ✅   | 17 位数字，如 `76561198000000000` |
| 游戏用户名 | ✅   | 被封禁玩家的游戏内昵称            |
| 封禁原因   | ✅   | 简短描述（如“作弊”、“恶意破坏”）  |
| 封禁时间   | ✅   | 默认当前时间                      |
| 解封时间   | 可选 | 留空 = 永久封禁                   |
| 所属服务器 | ✅   | 从下拉列表选择自己的服务器        |

#### 步骤 3：提交

点“提交”按钮。

#### 步骤 4：处理冲突

**如果该 SteamID 已被封禁**，会出现红色提示：

| 提示                              | 含义           | 操作                           |
| --------------------------------- | -------------- | ------------------------------ |
| `你已提交过该 SteamID 的封禁记录` | 自己的重复封禁 | 点“编辑现有记录”修改           |
| `该 SteamID 已被其他服主封禁`     | 别人封过了     | 点“申请管理员介入”（如需申诉） |

### 13.3 我的封禁（管理已提交记录）

#### 查看列表

侧边栏 → 「**我的封禁**」，显示自己提交的所有记录。

| 列         | 说明                     |
| ---------- | ------------------------ |
| 游戏用户名 | 被封玩家的昵称           |
| SteamID    | 17 位 ID                 |
| 原因       | 封禁理由                 |
| 服务器     | 提交时选的服务器         |
| 状态       | 生效中 / 已过期 / 已解封 |
| 录入时间   | 提交时间                 |
| 解封时间   | 到期时间（颜色表示状态） |

#### 状态颜色说明

| 显示                 | 含义               |
| -------------------- | ------------------ |
| 🟡 黄色 + 时间       | 未过期（临时封禁） |
| 🔴 红色 + 时间       | 已过期             |
| 🔴 红色 + “永久封禁” | 无解封时间         |

#### 操作按钮

| 图标    | 功能         | 说明                            |
| ------- | ------------ | ------------------------------- |
| ✏️ 编辑 | 修改封禁信息 | 可改用户名、原因、封禁/解封时间 |
| ❌ 解封 | 撤销封禁     | 需填写解封原因                  |
| 👁️ 详情 | 查看完整信息 | —                               |

### 13.4 所有封禁

#### 查看全站生效封禁

侧边栏 → 「**所有封禁**」（`/all-bans`）

| 特性     | 说明                        |
| -------- | --------------------------- |
| 数据范围 | 全站所有**生效中**的封禁    |
| 显示字段 | 仅 SteamID 与原因           |
| 隐私保护 | 不显示提交人、服务器等信息  |
| 搜索     | 支持 SteamID 或原因模糊搜索 |
| 分页     | 每页 50 条，后端分页        |

#### 搜索行为

- 输入关键词后 **300ms 防抖**，自动请求后端。
- 搜索会重置到第 1 页。
- 支持模糊匹配 SteamID 片段或原因片段。

### 13.5 介入申请

#### 什么时候用

当**其他服主**已经封了某个玩家，你认为该封禁有问题（误封、恶意封禁等），可以**申请管理员介入**。

#### 提交流程

**入口 1：从创建封禁冲突页跳转**

1. 在“添加封禁”时检测到冲突。
2. 点“申请管理员介入”链接。
3. 自动跳转 `/interventions`，弹窗自动打开，**关联封禁 ID 已填好**。
4. 补充申请理由 → 提交。

**入口 2：手动创建**

1. 侧边栏 → 「**介入申请**」。
2. 点右上角“**新建申请**”。
3. 填写：
   - 关联封禁 ID（冲突详情的 ID）
   - SteamID
   - 申请理由
4. 提交。

#### 查看申请状态

| 状态      | 含义                       |
| --------- | -------------------------- |
| 🟡 待审批 | 等待管理员处理             |
| 🟢 已解决 | 管理员认可申诉，封禁被撤销 |
| 🔴 已拒绝 | 管理员驳回申诉             |

### 13.6 我的服务器管理

> 添加服务器见 **第 1.5 节**。

| 操作   | 方法               |
| ------ | ------------------ |
| 重命名 | 点卡片上的 ✏️ 图标 |
| 删除   | 点卡片上的 🗑️ 图标 |

⚠️ **删除服务器前注意**：该服务器下的封禁记录会失去关联，建议先处理。

### 13.7 个人设置

侧边栏 → 「**个人设置**」（`/profile`）

#### 账号信息

| 字段   | 是否可改 | 说明                           |
| ------ | -------- | ------------------------------ |
| 用户名 | ✅ 可改  | 改完自动登出，需用新用户名登录 |
| QQ 号  | ❌ 只读  | 需联系管理员修改               |
| 邮箱   | ✅ 可改  | 可清空，非空必须唯一           |
| 角色   | ❌ 只读  | 服主 / 管理员                  |
| 状态   | ❌ 只读  | 正常 / 待审批 / 已禁用         |

#### 修改用户名

1. 点用户名旁的“修改”。
2. 输入新用户名（3~30 字符，字母/数字/下划线/中文）。
3. 提交 → 3 秒后自动登出 → 用新用户名重新登录。

#### 修改邮箱

1. 点邮箱旁的“修改”。
2. 输入新邮箱（留空表示清空）。
3. 提交。

**规则：**

- 邮箱非空时必须符合标准格式。
- 邮箱非空时必须全站唯一。
- 修改邮箱**不会**强制登出。

#### 修改密码

1. 输入**当前密码**。
2. 输入**新密码**（8~128 字符）。
3. 再次输入新密码。
4. 提交。

⚠️ **本系统无自助找回密码功能**，忘记密码需联系管理员重置。

### 13.8 管理员功能

#### 13.8.1 用户管理（`/admin/users`）

- 审批新用户（通过 / 拒绝）
- 禁用 / 启用账号
- 重置密码
- 修改 QQ 号
- 删除服主（带数据迁移）

#### 13.8.2 服务器管理（`/admin/servers`）

- 查看所有服务器及封禁数量
- 删除服务器（可迁移封禁到其他服务器）
- 按名称搜索

#### 13.8.3 介入处理（`/admin/interventions`）

- 处理“待审批”的申请
- 标记解决 → 撤销原封禁
- 拒绝 → 封禁继续生效

#### 13.8.4 联系方式（`/admin/contacts`）

- 维护公开显示的管理员联系方式
- 至少保留一个主联系方式

#### 13.8.5 所有封禁（`/admin/bans`）

- 查看全站所有封禁
- 支持搜索、状态筛选

#### 13.8.6 编辑公告（`/admin/announcements`）

- 发布 / 编辑 / 删除公告
- 活跃公告最多 5 条，总数最多 10 条
- 支持启用 / 隐藏

---

## 14. 安全建议

| 项         | 建议                                        |
| ---------- | ------------------------------------------- |
| API 账号   | 单独建只读账号，**不要用 admin**            |
| RCON 密码  | ≥32 位随机字符，不与其他密码重复            |
| RCON 端口  | 只监听 `127.0.0.1` 或内网，**不对公网开放** |
| HTTPS 证书 | 用 Let's Encrypt 等公共 CA，不用自签名      |
| 日志脱敏   | 不打印密码；`pz-bansync.log` 目录不要公开   |
| 脚本权限   | Linux 用 `chmod 600`，防止其他用户读取配置；Windows 用 ACL 限制访问 |

**Linux 加固示例：**

```bash
# 脚本只允许属主读写
chmod 700 /home/debian/pz-bansync/pz-bansync.py
chmod 700 /home/debian/pz-bansync/pz-bansync.log
chmod 700 /home/debian/pz-bansync
```

**Windows 加固示例：**

```powershell
icacls C:\pz-bansync /inheritance:r /grant:r "%USERNAME%":(OI)(CI)F
```

> 上述 `/home/debian/pz-bansync` 和 `C:\pz-bansync` 都只是示例路径，请替换为实际目录。

---

## 15. 卸载

### 15.1 Linux 卸载

```bash
sudo systemctl stop pz-bansync
sudo systemctl disable pz-bansync
sudo rm /etc/systemd/system/pz-bansync.service
sudo systemctl daemon-reload
sudo rm -rf /home/debian/pz-bansync
```

### 15.2 Windows 卸载

如果使用 NSSM：

```powershell
nssm stop pz-bansync
nssm remove pz-bansync confirm
Remove-Item -Recurse -Force C:\pz-bansync
```

如果使用任务计划：

```powershell
schtasks /End /TN "pz-bansync"
schtasks /Delete /TN "pz-bansync" /F
Remove-Item -Recurse -Force C:\pz-bansync
```

> 卸载后 PZ 的封禁数据**不会**被清除，需要手动清理。

Linux：

```bash
sqlite3 /home/debian/Zomboid/db/servertest.db "DELETE FROM bannedid;"
```

Windows：

```powershell
sqlite3.exe "C:\Users\debian\Zomboid\db\servertest.db" "DELETE FROM bannedid;"
```

---

## 16. 附录

### 16.1 工作原理

```text
┌──────────────┐      HTTPS        ┌─────────────────┐   RCON    ┌──────────────┐
│  banserver   │ ←─── 拉取封禁 ─── │  pz-bansync.py  │ ───────→ │  PZ 服务器    │
│  (中心黑名单) │      每5分钟       │  (本机脚本)      │  banid   │ (RCON:27015) │
└──────────────┘                   └─────────────────┘  unbanid └──────────────┘
        ▲                                  │
        │                                  └── 读取 SQLite（bannedid 表）确认差异
        │
   网页端（服主/管理员操作）
   https://banserver.zuckertech.cn
```

**数据流向：**

- **服主/管理员** → 网页端添加/修改/撤销封禁 → **banserver**
- **banserver** → 脚本每 5 分钟拉取 → **PZ 服务器**（通过 RCON）

### 16.2 核心文件清单

> 下表均为示例路径。Linux 与 Windows 均可接入，请按实际系统替换。

| 文件      | Linux 示例位置                               | Windows 示例位置                               | 作用         |
| --------- | -------------------------------------------- | ---------------------------------------------- | ------------ |
| 脚本      | `/home/debian/pz-bansync/pz-bansync.py`      | `C:\pz-bansync\pz-bansync.py`                  | 主程序       |
| 日志      | `/home/debian/pz-bansync/pz-bansync.log`     | `C:\pz-bansync\pz-bansync.log`                 | 运行日志     |
| 服务      | `/etc/systemd/system/pz-bansync.service`     | NSSM 服务 / 任务计划                           | 常驻运行定义 |
| PZ 数据库 | `/home/debian/Zomboid/db/servertest.db`      | `C:\Users\debian\Zomboid\db\servertest.db`     | 被同步目标   |
| PZ 配置   | `/home/debian/Zomboid/Server/servertest.ini` | `C:\Users\debian\Zomboid\Server\servertest.ini` | RCON 来源    |

### 16.3 相关 API（banserver）

| 接口                                       | 方法 | 认证   | 说明                                     |
| ------------------------------------------ | ---- | ------ | ---------------------------------------- |
| `/health`                                  | GET  | 无     | 健康检查                                 |
| `/api/auth/login`                          | POST | 无     | 登录获取 token                           |
| `/api/external/bans?offset=0&limit=100000` | GET  | 需登录 | 获取全站生效封禁（仅 steam_id + reason） |
| `/api/public/bans`                         | GET  | 无     | 公开封禁列表（不含 SteamID）             |
| `/api/public/bans/check`                   | GET  | 无     | 按 SteamID 查询                          |

### 16.4 相关 RCON 命令（PZ）

| 命令                | 说明         |
| ------------------- | ------------ |
| `players`           | 列出在线玩家 |
| `banid <SteamID>`   | 封禁 SteamID |
| `unbanid <SteamID>` | 解封 SteamID |
| `kick <用户名>`     | 踢出玩家     |
| `save`              | 保存游戏     |

### 16.5 部署前检查清单

- [ ] banserver 网页可访问、HTTPS 证书有效
- [ ] 已注册账号并被审批通过
- [ ] 已添加至少一台服务器
- [ ] 已添加至少一条测试封禁
- [ ] PZ RCON 已开启并监听对应端口
- [ ] PZ 数据库路径正确且脚本可读
- [ ] 已确认 `/home/debian/pz-bansync/`、`C:\pz-bansync\` 等只是示例，并替换为实际路径
- [ ] 脚本 `SYNC_MODE` 已按场景选择
- [ ] Linux 已部署 systemd；Windows 已部署 NSSM/任务计划等常驻方式
- [ ] 观察 3~5 轮日志无异常

---

## 17. 使用流程全景图

```text
┌─────────────────────────────────────────────────────────────┐
│                    服主日常操作流程                          │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   注册账号               添加服务器              添加封禁
   /register             /servers              /bans/create
        │                     │                     │
        ▼                     ▼                     ▼
   等待审批              填服务器名             填 SteamID 等
        │                     │                     │
        ▼                     ▼                     ▼
   管理员通过             提交成功             提交 → 检测冲突
        │                                           │
        ▼                                           ▼
   登录 /login                               ┌──────┴──────┐
        │                                   无冲突      有冲突
        ▼                                      │          │
   进入仪表盘                                   ▼          ▼
   /dashboard                              添加成功    处理冲突
                                                        │
                                          ┌─────────────┼─────────────┐
                                          ▼             ▼             ▼
                                      自己的记录    别人的记录    放弃提交
                                          │             │
                                          ▼             ▼
                                       编辑         申请介入
                                       /bans/:id    /interventions
                                       /edit            │
                                                        ▼
                                                   管理员处理
                                                   /admin/interventions
                                                        │
                                            ┌───────────┴───────────┐
                                            ▼                       ▼
                                           解决                    拒绝
                                        (撤销封禁)               (保持封禁)

┌─────────────────────────────────────────────────────────────┐
│              后台自动同步流程（无需人工干预）                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    pz-bansync.py 每 5 分钟
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        API 拉取        读 PZ 数据库       计算差异
   /api/external/bans     bannedid        to_ban/to_unban
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    ┌─────────┴─────────┐
                    ▼                   ▼
              to_ban 非空          to_unban 非空
                    │                   │
                    ▼                   ▼
              RCON banid          RCON unbanid
                                    (仅 full 模式)
```
