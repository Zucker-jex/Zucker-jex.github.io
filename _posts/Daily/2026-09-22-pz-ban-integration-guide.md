---
title: Project Zomboid Server Shared Ban Integration Guide
key: pzbanserver
tags: ["Daily"]
aside:
  toc: true
---

# PZ 服务器联 Ban 接入说明书 <!--more-->

**版本**：v1.3

**更新**：2026-09-22

**适用**：僵尸毁灭工程（Project Zomboid）专用服务器

**目标**：让 PZ 服务器的封禁列表自动与中心 Ban 服器（banserver）保持同步，并提供完整的网页端管理界面

---

## 目录

1. [工作原理](#1-工作原理)
2. [同步模式](#2-同步模式)
3. [前置条件](#3-前置条件)
4. [接入步骤](#4-接入步骤)
5. [部署为 systemd 服务](#5-部署为-systemd-服务)
6. [验证同步效果](#6-验证同步效果)
7. [日志解读](#7-日志解读)
8. [同步模式切换](#8-同步模式切换)
9. [常见问题](#9-常见问题)
10. [故障排查](#10-故障排查)
11. [安全建议](#11-安全建议)
12. [卸载](#12-卸载)
13. [网页端注册与使用教程](#13-网页端注册与使用教程)
14. [附录](#14-附录)

---

## 1. 工作原理

```
┌──────────────┐      HTTPS        ┌─────────────────┐   RCON    ┌──────────────┐
│  banserver   │ ←─── 拉取封禁 ─── │  pz-bansync.py  │ ───────→ │  PZ 服务器    │
│  (中心黑名单) │      每5分钟       │  (本机脚本)      │  banid   │ (RCON:27015) │
└──────────────┘                   └─────────────────┘  unbanid └──────────────┘
        ▲                                  │
        │                                  └── 读取 SQLite（bannedid 表）确认差异
        │
   网页端（服主/管理员操作）
   https://banserver.zuckertech.cn:8088
```

**数据流向**：

- **服主/管理员** → 网页端添加/修改/撤销封禁 → **banserver**
- **banserver** → 脚本每 5 分钟拉取 → **PZ 服务器**（通过 RCON）

| 差异类型          | 含义                 | 脚本动作                                 |
| ----------------- | -------------------- | ---------------------------------------- |
| API 有、PZ 无     | banserver 新增了封禁 | 执行 `banid <SteamID>`                   |
| PZ 有、API 无     | banserver 上已解封   | 执行 `unbanid <SteamID>`（仅 full 模式） |
| 两边都有 / 都没有 | 已一致               | 不做任何操作                             |

**执行周期**：默认 5 分钟一次（`SYNC_INTERVAL = 300`）

---

## 2. 同步模式

脚本支持两种同步模式，通过配置区 `SYNC_MODE` 切换：

### 2.1 `full` —— 完全同步（默认）

- **行为**：新增 + 移除都同步
- **结果**：PZ 的封禁列表与 banserver **完全一致**
- **适用**：banserver 是唯一权威源，PZ 完全从属

**示例**：

| 场景 | banserver | PZ 当前  | 执行后 PZ |
| ---- | --------- | -------- | --------- |
| 新增 | `[A, B]`  | `[B, C]` | `[A, B]`  |
| 解封 | `[A]`     | `[A, B]` | `[A]`     |

### 2.2 `add_only` —— 只增不减

- **行为**：只把 banserver 的新封禁加到 PZ，**不解封**
- **结果**：PZ 封禁列表只会增加，不会减少
- **适用**：
  - PZ 上已有大量服主手动封禁的历史记录
  - 首次接入、测试阶段
  - PZ 是主服，banserver 只是补充来源

**示例**：

| 场景 | banserver | PZ 当前  | 执行后 PZ        |
| ---- | --------- | -------- | ---------------- |
| 新增 | `[A, B]`  | `[B, C]` | `[A, B, C]`      |
| 解封 | `[A]`     | `[A, B]` | `[A, B]`（不动） |

### 2.3 模式选择建议

| 你的场景                        | 推荐模式                       |
| ------------------------------- | ------------------------------ |
| banserver 中心管控，PZ 被动接收 | `full`                         |
| PZ 有历史封禁，不想被清         | 先 `add_only`，稳定后切 `full` |
| 担心脚本误删                    | `add_only`                     |
| 多人协作，要保持一致            | `full`                         |

---

## 3. 前置条件

### 3.1 banserver 侧

| 项         | 要求                                       |
| ---------- | ------------------------------------------ |
| 可访问地址 | 如 `https://banserver.zuckertech.cn:8088`  |
| 有效账号   | 建议单独建只读账号，不要用 admin           |
| HTTPS 证书 | 必须被 PZ 服务器信任（Let's Encrypt 即可） |

**验证方法**（在 PZ 服务器上执行）：

```bash
curl -s https://banserver.zuckertech.cn:8088/health
# 期望：{"status":"ok","timestamp":"..."}
```

### 3.2 PZ 服务器侧

| 项             | 要求                                     | 检查命令                              |
| -------------- | ---------------------------------------- | ------------------------------------- |
| Python 3.9+    | 内置即可，无需 pip                       | `python3 --version`                   |
| RCON 已开启    | `.ini` 里有 `RCONPort` 和 `RCONPassword` | `grep -i rcon ~/Zomboid/Server/*.ini` |
| RCON 端口可达  | `127.0.0.1:27015`                        | `nc -zv 127.0.0.1 27015`              |
| 数据库可读     | `~/Zomboid/db/servertest.db`             | `ls -la ~/Zomboid/db/servertest.db`   |
| `sqlite3` 命令 | 可选（人工核查用）                       | `sqlite3 --version`                   |

### 3.3 开启 RCON（如未开启）

编辑 `~/Zomboid/Server/servertest.ini`：

```ini
RCONPort=27015
RCONPassword=改成你的强密码（≥32 位随机字符）
```

**重启 PZ 服务器** 使配置生效。

### 3.4 实测环境参考

本次验证使用的环境：

| 项                | 值                                          |
| ----------------- | ------------------------------------------- |
| RCON 端口         | `27015`                                     |
| 数据库路径        | `/home/debian/Zomboid/db/servertest.db`     |
| `bannedid` 表结构 | `(steamid TEXT NOT NULL, reason TEXT NULL)` |
| `banid` 命令      | ✅ 支持，返回 `System banned SteamID xxx()` |
| `unbanid` 命令    | ✅ 支持，返回 `SteamID xxx is now unbanned` |

---

## 4. 接入步骤

### 4.1 创建目录

```bash
mkdir -p /home/debian/pz-bansync
cd /home/debian/pz-bansync
```

### 4.2 保存脚本

将 `pz-bansync.py` 保存到 `/home/debian/pz-bansync/pz-bansync.py`：

```bash
nano /home/debian/pz-bansync/pz-bansync.py
# 粘贴完整脚本内容 → Ctrl+O 保存 → Ctrl+X 退出
```

**脚本完整内容**（v1.2，含模式选择）：

```python
#!/usr/bin/env python3
"""
pz-bansync —— PZ 服务器封禁列表与 banserver API 同步
在 PZ 服务器本机运行
"""
import json
import logging
import socket
import sqlite3
import ssl
import struct
import sys
import time
import urllib.request
from pathlib import Path

# ==================== 配置区 ====================
API_BASE     = "https://banserver.zuckertech.cn:8088"   # ban联服器 API 地址
API_USERNAME = "your_api_username"                      # ban联服器 API 用户名
API_PASSWORD = "your_api_password"                      # ban联服器 API 密码

RCON_HOST = "127.0.0.1"
RCON_PORT = 27015
RCON_PASS = "your_rcon_password"                      # RCON 密码

PZ_DB = "/home/debian/Zomboid/db/servertest.db"       # PZ 服务器数据库路径

SYNC_INTERVAL = 300                                   # 同步间隔（秒）
LOG_FILE = Path("/home/debian/pz-bansync/pz-bansync.log")

# ============ 同步模式 ============
#   "full"     —— 完全同步：两边完全一致
#   "add_only" —— 只增不减：只加封禁，不解封
SYNC_MODE = "full"
# ==================================================

log = logging.getLogger("pz-bansync")


# ---------------- RCON 客户端 ----------------
class RconClient:
    SERVERDATA_AUTH            = 3
    SERVERDATA_AUTH_RESPONSE   = 2
    SERVERDATA_EXECCOMMAND     = 2
    SERVERDATA_RESPONSE_VALUE  = 0

    def __init__(self, host, port, password):
        self.host, self.port, self.password = host, port, password
        self.sock = None
        self.req_id = 0

    def _next_id(self):
        self.req_id += 1
        return self.req_id

    def _send(self, pkt_id, pkt_type, body):
        body_b = body.encode("utf-8")
        payload = struct.pack("<ii", pkt_id, pkt_type) + body_b + b"\x00\x00"
        self.sock.sendall(struct.pack("<i", len(payload)) + payload)

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("RCON 连接被关闭")
            buf += chunk
        return buf

    def _recv_packet(self):
        ln = struct.unpack("<i", self._recv_exact(4))[0]
        data = self._recv_exact(ln)
        pid, ptype = struct.unpack("<ii", data[:8])
        body = data[8:-2].decode("utf-8", errors="replace")
        return pid, ptype, body

    def _drain(self, timeout=0.3):
        self.sock.settimeout(timeout)
        try:
            while True:
                try:
                    d = self.sock.recv(8192)
                    if not d:
                        break
                except socket.timeout:
                    break
        finally:
            self.sock.settimeout(5)

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        pkt_id = self._next_id()
        self._send(pkt_id, self.SERVERDATA_AUTH, self.password)
        pid, ptype, body = self._recv_packet()
        if pid == -1:
            raise PermissionError("RCON 认证失败")
        self._drain(0.3)

    def command(self, cmd):
        self._drain(0.3)
        pkt_id = self._next_id()
        self._send(pkt_id, self.SERVERDATA_EXECCOMMAND, cmd)

        responses = []
        self.sock.settimeout(5)
        try:
            _, _, body = self._recv_packet()
            responses.append(body)
        except socket.timeout:
            return ""
        finally:
            self.sock.settimeout(5)

        self.sock.settimeout(0.5)
        try:
            while True:
                try:
                    _, _, body = self._recv_packet()
                    responses.append(body)
                except socket.timeout:
                    break
        except Exception:
            pass
        finally:
            self.sock.settimeout(5)

        return "\n".join(responses)

    def close(self):
        if self.sock:
            try: self.sock.close()
            except Exception: pass


# ---------------- HTTP ----------------
def _post_json(url, data, timeout=15):
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="POST")
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get_json(url, headers=None, timeout=20):
    req = urllib.request.Request(url, headers=headers or {})
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_login():
    return _post_json(
        f"{API_BASE}/api/auth/login",
        {"identifier": API_USERNAME, "password": API_PASSWORD},
    )["access_token"]


def api_fetch_active_bans(token):
    r = _get_json(
        f"{API_BASE}/api/bans?offset=0&limit=100000&status=active",
        headers={"Authorization": f"Bearer {token}"})
    out = {}
    for b in r.get("data", []):
        sid = (b.get("steam_id") or "").strip()
        if sid and b.get("status") == "active":
            out[sid] = b.get("reason") or ""
    return out


# ---------------- PZ 数据库 ----------------
def pz_read_banned_ids(db_path):
    p = Path(db_path)
    if not p.exists():
        log.warning(f"PZ 数据库不存在: {db_path}")
        return None
    try:
        conn = sqlite3.connect(f"file:{p}?mode=ro&immutable=1", uri=True, timeout=5)
        try:
            cur = conn.cursor()
            cur.execute("SELECT steamid FROM bannedid")
            return {str(r[0]).strip() for r in cur.fetchall() if r and r[0]}
        finally:
            conn.close()
    except Exception as e:
        log.warning(f"读 PZ 数据库失败: {e}")
        return None


def pz_update_reason(db_path, steam_id, reason):
    if not reason:
        return
    try:
        conn = sqlite3.connect(db_path, timeout=10)
        try:
            cur = conn.cursor()
            cur.execute("UPDATE bannedid SET reason = ? WHERE steamid = ?", (reason, steam_id))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        log.warning(f"写 reason 失败 ({steam_id}): {e}")


# ---------------- 同步 ----------------
def sync_once(rcon, token):
    log.info("-" * 50)

    api_bans = api_fetch_active_bans(token)
    api_set = set(api_bans.keys())
    log.info(f"API active bans: {len(api_set)}")

    pz_set = pz_read_banned_ids(PZ_DB)
    if pz_set is None:
        log.error("读 PZ 数据库失败，跳过本轮")
        return
    log.info(f"PZ current bans: {len(pz_set)}")

    to_ban = api_set - pz_set
    to_unban = pz_set - api_set

    if SYNC_MODE == "add_only":
        log.info(f"待新增: {len(to_ban)} | 待移除: {len(to_unban)}（add_only 模式，跳过移除）")
    else:
        log.info(f"待新增: {len(to_ban)} | 待移除: {len(to_unban)}")

    for sid in sorted(to_ban):
        try:
            resp = rcon.command(f"banid {sid}")
            log.info(f"[+] ban {sid} -> {resp.strip()!r}")
            pz_update_reason(PZ_DB, sid, api_bans.get(sid, ""))
        except Exception as e:
            log.error(f"ban {sid} 失败: {e}")

    if SYNC_MODE == "full":
        for sid in sorted(to_unban):
            try:
                resp = rcon.command(f"unbanid {sid}")
                log.info(f"[-] unban {sid} -> {resp.strip()!r}")
            except Exception as e:
                log.error(f"unban {sid} 失败: {e}")
    elif to_unban:
        log.info(f"（add_only 模式：{len(to_unban)} 条待移除记录已忽略）")


def main():
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

    fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
    fh.setFormatter(fmt)
    root.addHandler(fh)

    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)

    global SYNC_MODE
    SYNC_MODE = SYNC_MODE.strip().lower()
    if SYNC_MODE not in ("full", "add_only"):
        log.error(f"SYNC_MODE 值非法: {SYNC_MODE!r}，已回退为 'full'")
        SYNC_MODE = "full"

    log.info("=" * 60)
    log.info("pz-bansync 启动")
    log.info("  API:      %s", API_BASE)
    log.info("  RCON:     %s:%d", RCON_HOST, RCON_PORT)
    log.info("  DB:       %s", PZ_DB)
    log.info("  间隔:     %d 秒", SYNC_INTERVAL)
    log.info("  同步模式: %s", "full（完全同步）" if SYNC_MODE == "full" else "add_only（只增不减）")
    log.info("=" * 60)

    while True:
        try:
            token = api_login()
        except Exception as e:
            log.error(f"API 登录失败: {e}")
            time.sleep(SYNC_INTERVAL)
            continue

        rcon = RconClient(RCON_HOST, RCON_PORT, RCON_PASS)
        try:
            rcon.connect()
            log.info("RCON connected")
        except Exception as e:
            log.error(f"RCON 连接失败: {e}")
            time.sleep(SYNC_INTERVAL)
            continue

        try:
            sync_once(rcon, token)
        except Exception:
            log.exception("同步异常")
        finally:
            rcon.close()

        time.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    main()
```

### 4.3 填写配置

修改脚本顶部 **配置区**：

| 变量            | 说明                                   | 示例                                     |
| --------------- | -------------------------------------- | ---------------------------------------- |
| `API_BASE`      | banserver HTTPS 地址，**末尾不带斜杠** | `https://banserver.zuckertech.cn:8088`   |
| `API_USERNAME`  | banserver 登录用户名                   | `sync_bot`                               |
| `API_PASSWORD`  | 对应密码                               | —                                        |
| `RCON_HOST`     | PZ 的 RCON 地址，本机填 `127.0.0.1`    | `127.0.0.1`                              |
| `RCON_PORT`     | 与 `.ini` 里 `RCONPort` 一致           | `27015`                                  |
| `RCON_PASS`     | 与 `.ini` 里 `RCONPassword` 一致       | —                                        |
| `PZ_DB`         | PZ 的 SQLite 绝对路径                  | `/home/debian/Zomboid/db/servertest.db`  |
| `SYNC_INTERVAL` | 同步间隔（秒）                         | `300`                                    |
| `SYNC_MODE`     | 同步模式                               | `full` 或 `add_only`                     |
| `LOG_FILE`      | 日志文件路径                           | `/home/debian/pz-bansync/pz-bansync.log` |

### 4.4 赋权

```bash
chmod +x /home/debian/pz-bansync/pz-bansync.py
```

### 4.5 手动测试运行

```bash
cd /home/debian/pz-bansync
python3 pz-bansync.py
```

**预期输出**：

```
2026-09-22 22:00:00 [INFO] ============================================================
2026-09-22 22:00:00 [INFO] pz-bansync 启动
2026-09-22 22:00:00 [INFO]   API:      https://banserver.zuckertech.cn:8088
2026-09-22 22:00:00 [INFO]   RCON:     127.0.0.1:27015
2026-09-22 22:00:00 [INFO]   DB:       /home/debian/Zomboid/db/servertest.db
2026-09-22 22:00:00 [INFO]   间隔:     300 秒
2026-09-22 22:00:00 [INFO]   同步模式: full（完全同步）
2026-09-22 22:00:00 [INFO] ============================================================
2026-09-22 22:00:01 [INFO] RCON connected
2026-09-22 22:00:01 [INFO] --------------------------------------------------
2026-09-22 22:00:02 [INFO] API active bans: 1
2026-09-22 22:00:02 [INFO] PZ current bans: 0
2026-09-22 22:00:02 [INFO] 待新增: 1 | 待移除: 0
2026-09-22 22:00:02 [INFO] [+] ban 76561198000000000 -> 'System banned SteamID 76561198000000000()'
```

看到 `RCON connected` + `同步模式` 打印正确，即为正常。按 `Ctrl+C` 停止。

---

## 5. 部署为 systemd 服务

### 5.1 创建 service 文件

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

### 5.2 启用

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pz-bansync
sudo systemctl status pz-bansync
```

### 5.3 常用命令

| 操作     | 命令                                             |
| -------- | ------------------------------------------------ |
| 查看状态 | `sudo systemctl status pz-bansync`               |
| 实时日志 | `sudo journalctl -u pz-bansync -f`               |
| 文件日志 | `tail -f /home/debian/pz-bansync/pz-bansync.log` |
| 重启     | `sudo systemctl restart pz-bansync`              |
| 停止     | `sudo systemctl stop pz-bansync`                 |
| 关闭自启 | `sudo systemctl disable pz-bansync`              |

---

## 6. 验证同步效果

### 6.1 添加封禁测试

1. 打开 banserver 网页（如 `https://banserver.zuckertech.cn:8088`）
2. 登录 → 添加封禁 → SteamID 填 `76561198000000001`
3. 提交

### 6.2 触发同步

等待 5 分钟，或立即重启脚本：

```bash
sudo systemctl restart pz-bansync
```

### 6.3 验证 PZ 端生效

```bash
sqlite3 /home/debian/Zomboid/db/servertest.db "SELECT * FROM bannedid;"
```

预期看到：

```
76561198000000001|<封禁原因>
```

### 6.4 解封测试（仅 full 模式）

1. banserver 网页撤销该封禁
2. 等待 5 分钟 / 重启脚本
3. 数据库里该条消失

### 6.5 观察多轮日志

```bash
sudo journalctl -u pz-bansync -f
```

连续观察几轮，确认每轮都是 `待新增: 0 | 待移除: 0`，说明两边已完全一致。

---

## 7. 日志解读

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

## 8. 同步模式切换

### 8.1 从 `add_only` 切到 `full`

```bash
nano /home/debian/pz-bansync/pz-bansync.py
# 改 SYNC_MODE = "full"
sudo systemctl restart pz-bansync
```

⚠️ **切换瞬间注意**：如果 PZ 上有大量 banserver 里没有的封禁，切到 `full` 后会被**一次全部解封**。切换前先确认：

```bash
# 对比两边差异
sqlite3 /home/debian/Zomboid/db/servertest.db "SELECT COUNT(*) FROM bannedid;"
# 和 banserver 的 active 数量对比
```

### 8.2 从 `full` 切到 `add_only`

```bash
nano /home/debian/pz-bansync/pz-bansync.py
# 改 SYNC_MODE = "add_only"
sudo systemctl restart pz-bansync
```

- **不回滚**已删除的记录
- 从此刻起不再自动解封

### 8.3 校验模式是否生效

重启后看日志：

```
2026-09-22 ... [INFO]   同步模式: full（完全同步）
```

或：

```
2026-09-22 ... [INFO]   同步模式: add_only（只增不减）
```

---

## 9. 常见问题

### Q1：`API 登录失败: HTTP Error 401`

- banserver 账号或密码错
- 检查 `API_USERNAME` / `API_PASSWORD`

### Q2：`RCON 连接失败: [Errno 111] Connection refused`

- PZ 没开 RCON：检查 `~/Zomboid/Server/*.ini` 里 `RCONPort` / `RCONPassword`
- **改完 .ini 必须重启 PZ**

### Q3：`RCON 认证失败`

- `RCON_PASS` 与 `.ini` 里 `RCONPassword` 不一致
- 复制粘贴时注意多余空格

### Q4：`读 PZ 数据库失败`

- 检查 `PZ_DB` 路径：`ls -la /home/debian/Zomboid/db/servertest.db`
- 权限检查：`sudo -u debian cat /home/debian/Zomboid/db/servertest.db > /dev/null`

### Q5：`banid` 返回 `Unknown command`

- PZ 服务端未重载。重启 PZ 后重试
- 检查是否误发了带斜杠的命令：脚本里应是 `banid xxx` 而不是 `/banid xxx`

### Q6：同步不及时

- 默认 5 分钟一轮
- 想更快：`SYNC_INTERVAL = 60`，重启服务

### Q7：PZ 里出现意外的封禁

- 可能是**其他服主**手动通过 RCON 加的
- `full` 模式下，脚本会在下一轮把它解掉（banserver 里没有）
- `add_only` 模式下不会被解掉，会一直保留

### Q8：PZ 重启后同步停止

- systemd 服务设了 `Restart=always`，会自动重连
- 检查 `sudo systemctl status pz-bansync`

### Q9：脚本执行用户对数据库无写权限

`pz_update_reason` 会失败，但**封禁仍然生效**（RCON 已执行）。日志会打印：

```
写 reason 失败 (76561198...): attempt to write a readonly database
```

解决：让脚本运行用户对 `~/Zomboid/db/` 有写权限：

```bash
# 查看数据库属主
ls -la /home/debian/Zomboid/db/servertest.db
# 一般是 PZ 运行用户 debian 拥有
# 如果 systemd 服务 User= 和属主不同，改成一致
```

### Q10：`SYNC_MODE 值非法` 警告

配置写成了别的东西，脚本会回退到 `full`。改成 `"full"` 或 `"add_only"`（**带引号**）。

---

## 10. 故障排查

### 10.1 分层排查思路

```
网络 → HTTPS → RCON → SQLite → 脚本逻辑
```

### 10.2 逐层验证

**① 网络层**

```bash
curl -s https://banserver.zuckertech.cn:8088/health
# 期望 {"status":"ok",...}
```

**② RCON 层**

```bash
nc -zv 127.0.0.1 27015
# 期望 succeeded
```

**③ 数据库层**

```bash
sqlite3 /home/debian/Zomboid/db/servertest.db "SELECT COUNT(*) FROM bannedid;"
# 期望返回数字
```

**④ 脚本层**

```bash
cd /home/debian/pz-bansync
python3 pz-bansync.py
# 看启动日志和第一轮同步结果
```

### 10.3 手动触发封禁测试

不需要改 banserver，直接测 RCON：

```python
python3 - <<'PY'
import socket, struct
s = socket.create_connection(("127.0.0.1", 27015), timeout=5)
def send(pid, ptype, body):
    payload = struct.pack("<ii", pid, ptype) + body.encode() + b"\x00\x00"
    s.sendall(struct.pack("<i", len(payload)) + payload)
send(1, 3, "你的RCON密码")
s.recv(4096)  # auth
s.recv(4096)  # extra
send(2, 2, "players")
print(s.recv(4096))
PY
```

### 10.4 日志采集

出问题时收集以下信息：

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
curl -s https://banserver.zuckertech.cn:8088/api/public/bans | head -c 500
```

---

## 11. 安全建议

| 项         | 建议                                        |
| ---------- | ------------------------------------------- |
| API 账号   | 单独建只读账号，**不要用 admin**            |
| RCON 密码  | ≥32 位随机字符，不与其他密码重复            |
| RCON 端口  | 只监听 `127.0.0.1` 或内网，**不对公网开放** |
| HTTPS 证书 | 用 Let's Encrypt 等公共 CA，不用自签名      |
| 日志脱敏   | 不打印密码；`pz-bansync.log` 目录不要公开   |
| 脚本权限   | `chmod 600`，防止其他用户读取配置           |

**加固示例**：

```bash
# 脚本只允许属主读写
chmod 700 /home/debian/pz-bansync/pz-bansync.py
chmod 700 /home/debian/pz-bansync/pz-bansync.log
chmod 700 /home/debian/pz-bansync
```

---

## 12. 卸载

```bash
sudo systemctl stop pz-bansync
sudo systemctl disable pz-bansync
sudo rm /etc/systemd/system/pz-bansync.service
sudo systemctl daemon-reload
sudo rm -rf /home/debian/pz-bansync
```

卸载后 PZ 的封禁数据**不会**被清除，需要手动清理：

```bash
sqlite3 /home/debian/Zomboid/db/servertest.db "DELETE FROM bannedid;"
```

---

## 13. 网页端注册与使用教程

### 13.1 网页入口

| 项       | 值                                              |
| -------- | ----------------------------------------------- |
| 访问地址 | `https://banserver.zuckertech.cn:8088`          |
| 登录页   | `https://banserver.zuckertech.cn:8088/login`    |
| 注册页   | `https://banserver.zuckertech.cn:8088/register` |
| 协议     | HTTPS（Let's Encrypt 证书）                     |

⚠️ **首次访问**：浏览器地址栏应显示 🔒 锁标；如提示证书风险，检查 DNS 是否指向正确 IP。

### 13.2 注册新账号

#### 步骤 1：打开注册页

浏览器访问：

```
https://banserver.zuckertech.cn:8088/register
```

或从登录页底部点击"**注册**"链接。

#### 步骤 2：填写注册信息

| 字段     | 要求        | 说明                         |
| -------- | ----------- | ---------------------------- |
| 用户名   | 3~30 字符   | 支持字母、数字、下划线、中文 |
| 密码     | 8~128 字符  | 建议混合大小写 + 数字 + 符号 |
| 确认密码 | 同上        | 二次输入                     |
| QQ 号    | 5~12 位数字 | 用于联系和身份核验           |
| 邮箱     | 可选        | 便于密码重置（若开启）       |

> **用户名命名建议**：用 Steam 昵称或服务器名，方便其他服主识别。

#### 步骤 3：提交注册

点击"注册"按钮。成功后会提示：

```
注册成功，等待管理员审批
```

此时账号状态为 **pending**（待审批）。

#### 步骤 4：等待审批

- **无法立即登录**，需要管理员在后台审批
- 审批通过后，状态变为 **active**，即可登录
- 审批一般由 **服主（owner）** 或 **管理员（admin）** 操作

**催促审批**：联系管理员（在冲突提示页会显示管理员的 QQ/邮箱）。

### 13.3 登录

#### 步骤 1：打开登录页

```
https://banserver.zuckertech.cn:8088/login
```

#### 步骤 2：输入凭据

| 字段 | 可填             |
| ---- | ---------------- |
| 账号 | 用户名 或 QQ 号  |
| 密码 | 注册时设置的密码 |

#### 步骤 3：登录成功

登录后跳转到 `/dashboard`（仪表盘）。

**登录态保持**：access_token 默认 24 小时，refresh_token 7 天，到期自动刷新。

### 13.4 界面总览

登录后左侧菜单：

#### 普通用户可见

| 菜单       | 路径             | 功能                    |
| ---------- | ---------------- | ----------------------- |
| 仪表盘     | `/dashboard`     | 统计概览、最近动态      |
| 我的封禁   | `/bans`          | 管理自己提交的封禁记录  |
| 添加封禁   | `/bans/create`   | 提交新的封禁            |
| 介入申请   | `/interventions` | 查看/提交管理员介入申请 |
| 我的服务器 | `/servers`       | 管理自己名下的服务器    |
| 个人设置   | `/profile`       | 修改密码、查看账号信息  |

#### 管理员/服主可见（额外）

| 菜单     | 路径                   | 功能                          |
| -------- | ---------------------- | ----------------------------- |
| 服主管理 | `/admin/users`         | 审批用户、禁用/启用、重置密码 |
| 介入处理 | `/admin/interventions` | 处理别人的介入申请            |
| 联系方式 | `/admin/contacts`      | 维护公开显示的管理员联系方式  |
| 所有封禁 | `/admin/bans`          | 查看全站所有封禁记录          |

### 13.5 添加封禁

#### 步骤 1：进入添加页

侧边栏 → 「**添加封禁**」，或访问 `/bans/create`。

#### 步骤 2：填写信息

| 字段       | 必填 | 说明                              |
| ---------- | ---- | --------------------------------- |
| SteamID64  | ✅   | 17 位数字，如 `76561198000000000` |
| 游戏用户名 | ✅   | 被封禁玩家的游戏内昵称            |
| 封禁原因   | ✅   | 简短描述（如"作弊"、"恶意破坏"）  |
| 封禁时间   | ✅   | 默认当前时间                      |
| 解封时间   | 可选 | 留空 = 永久封禁                   |
| 所属服务器 | ✅   | 从下拉列表选择自己的服务器        |

#### 步骤 3：提交

点"提交"按钮。

#### 步骤 4：处理冲突

**如果该 SteamID 已被封禁**，会出现红色提示：

| 提示                              | 含义           | 操作                           |
| --------------------------------- | -------------- | ------------------------------ |
| `你已提交过该 SteamID 的封禁记录` | 自己的重复封禁 | 点"编辑现有记录"修改           |
| `该 SteamID 已被其他服主封禁`     | 别人封过了     | 点"申请管理员介入"（如需申诉） |

**冲突处理流程**：

```
提交 → 检测到冲突 → 提示已存在的封禁
                    ↓
        ┌───────────┴───────────┐
    自己的记录                别人的记录
        ↓                       ↓
    跳转编辑                 申请管理员介入
```

### 13.6 我的封禁（管理已提交记录）

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
| 🔴 红色 + "永久封禁" | 无解封时间         |

#### 操作按钮

| 图标    | 功能         | 说明                            |
| ------- | ------------ | ------------------------------- |
| ✏️ 编辑 | 修改封禁信息 | 可改用户名、原因、封禁/解封时间 |
| ❌ 解封 | 撤销封禁     | 需填写解封原因                  |
| 👁️ 详情 | 查看完整信息 | —                               |

#### 编辑封禁

点"✏️"进入编辑页 `/bans/:id/edit`：

- **游戏用户名**：必填
- **封禁原因**：必填
- **封禁时间**：`datetime-local` 格式
- **解封时间**：留空 = 永久；修改为过去时间 = 立即过期

提交后立即生效。

#### 解封

点"❌"，弹出输入框填写解封原因 → 确认。状态变为 **revoked**。

### 13.7 介入申请

#### 什么时候用

当**其他服主**已经封了某个玩家，你认为该封禁有问题（误封、恶意封禁等），可以**申请管理员介入**。

#### 提交流程

**入口 1：从创建封禁冲突页跳转**

1. 在"添加封禁"时检测到冲突
2. 点"申请管理员介入"链接
3. 自动跳转 `/interventions`，弹窗自动打开，**关联封禁 ID 已填好**
4. 补充申请理由 → 提交

**入口 2：手动创建**

1. 侧边栏 → 「**介入申请**」
2. 点右上角"**新建申请**"
3. 填写：
   - 关联封禁 ID（冲突详情的 ID）
   - SteamID
   - 申请理由
4. 提交

#### 查看申请状态

| 状态      | 含义                       |
| --------- | -------------------------- |
| 🟡 待审批 | 等待管理员处理             |
| 🟢 已解决 | 管理员认可申诉，封禁被撤销 |
| 🔴 已拒绝 | 管理员驳回申诉             |

点"👁️"图标可查看申请详情。

### 13.8 我的服务器

#### 添加服务器

1. 侧边栏 → 「**我的服务器**」
2. 点右上角"**添加服务器**"
3. 输入服务器名称
4. 提交

#### 管理服务器

| 操作   | 方法               |
| ------ | ------------------ |
| 重命名 | 点卡片上的 ✏️ 图标 |
| 删除   | 点卡片上的 🗑️ 图标 |

⚠️ **删除服务器前注意**：该服务器下的封禁记录会失去关联，建议先处理。

#### 服务器与封禁的关系

- 每个封禁记录归属某个服务器
- 玩家申诉时会看到服务器信息
- 一个账号可以有多个服务器

### 13.9 个人设置

侧边栏 → 「**个人设置**」（`/profile`）

#### 账号信息（只读）

| 字段     | 说明                   |
| -------- | ---------------------- |
| 用户名   | 注册时的用户名         |
| QQ 号    | 用于联系               |
| 邮箱     | —                      |
| 角色     | 服主 / 管理员          |
| 状态     | 正常 / 待审批 / 已禁用 |
| 注册时间 | —                      |
| 最后登录 | —                      |

#### 修改密码

1. 输入**当前密码**
2. 输入**新密码**（8~128 字符）
3. 再次输入新密码
4. 提交

⚠️ **本系统无自助找回密码功能**，忘记密码需联系管理员重置。

### 13.10 管理员功能（服主/管理员可见）

#### 13.10.1 用户管理（`/admin/users`）

**审批新用户**：

1. 侧边栏 → 「**服主管理**」
2. 找到状态为"待审批"的用户
3. 点"**通过**"或"**拒绝**"

**其他操作**：

| 操作     | 说明                           |
| -------- | ------------------------------ |
| 禁用     | 临时冻结账号（用户不能登录）   |
| 启用     | 恢复账号                       |
| 重置密码 | 管理员可强制改密码，需告知用户 |

#### 13.10.2 介入处理（`/admin/interventions`）

**处理流程**：

1. 侧边栏 → 「**介入处理**」
2. 查看"待审批"的申请
3. 点"查看详情"了解完整信息
4. 决策：
   - **标记解决**：认可申诉 → 撤销原封禁
   - **拒绝**：驳回申诉 → 封禁继续生效

**查看冲突详情**：点申请行中的"**查看冲突详情**"，可查看原封禁的完整信息 + 与被封玩家沟通的渠道。

#### 13.10.3 联系方式（`/admin/contacts`）

维护管理员公开联系方式，用于玩家申诉时联系。

**添加联系方式**：

1. 侧边栏 → 「**联系方式**」
2. 点"**添加联系方式**"
3. 选择类型（QQ / 邮箱 / 其他）
4. 填内容
5. 勾选"**设为主要联系方式**"（冲突弹窗中优先显示）
6. 提交

⚠️ **至少保留一个主联系方式**，否则玩家申诉时看不到联系方式。

#### 13.10.4 所有封禁（`/admin/bans`）

- 查看全站所有服主提交的封禁记录
- 支持按用户名、原因、SteamID 搜索
- 支持按状态筛选（生效中 / 已过期 / 已解封）

### 13.11 常见操作速查

| 我要做什么   | 路径                   |
| ------------ | ---------------------- |
| 注册账号     | `/register`            |
| 登录         | `/login`               |
| 添加封禁     | `/bans/create`         |
| 查看我的封禁 | `/bans`                |
| 编辑封禁     | `/bans/:id/edit`       |
| 申请介入     | `/interventions`       |
| 添加服务器   | `/servers`             |
| 改密码       | `/profile`             |
| 审批用户     | `/admin/users`         |
| 处理介入     | `/admin/interventions` |
| 维护联系方式 | `/admin/contacts`      |
| 查看所有封禁 | `/admin/bans`          |

### 13.12 网页端常见问题

#### Q1：注册后无法登录

- 账号状态还是 **pending**，需等待管理员审批
- 联系管理员加速审批

#### Q2：忘记密码

- 系统**无自助找回**
- 联系管理员，让其重置密码

#### Q3：提示"权限不足"（forbidden: insufficient role）

- 你的账号是普通用户，访问了 `/admin/*` 路径
- 只有 owner / admin 角色才能访问管理功能

#### Q4：添加封禁时提示"该 SteamID 已被其他服主封禁"

- 说明其他服主先提交了
- 如需推翻 → 点"申请管理员介入"
- 如认为是误封 → 同上

#### Q5：解封时间填过去时间会怎样

- 立即过期，下一轮 scheduler（默认 5 分钟）后状态变为 `expired`
- 公开列表里会消失

#### Q6：SteamID 校验失败

- 必须 17 位纯数字
- 检查是否为 SteamID3 或自定义 URL，需转换：
  - https://steamid.io/
  - https://steamidfinder.com/

#### Q7：页面显示"账号已禁用"

- 账号被管理员禁用
- 联系管理员恢复

#### Q8：刷新后需要重新登录

- access_token 过期（默认 24h），刷新页面时会自动用 refresh_token 换新的
- 如频繁掉登录，检查浏览器是否禁用 cookie/localStorage

### 13.13 网页端安全建议

| 项       | 建议                                                      |
| -------- | --------------------------------------------------------- |
| 密码     | ≥12 位，混合大小写 + 数字 + 符号，勿与其他站点重复        |
| 账号共享 | 禁止多人共用一个账号，操作无法追溯                        |
| 登录设备 | 尽量在受信任设备登录，公共电脑用完退出                    |
| 浏览器   | 用现代浏览器（Chrome / Firefox / Edge 最新版）            |
| 书签     | 收藏 `https://banserver.zuckertech.cn:8088`，警惕钓鱼域名 |

---

## 14. 附录

### 14.1 核心文件清单

| 文件      | 位置                                         | 作用         |
| --------- | -------------------------------------------- | ------------ |
| 脚本      | `/home/debian/pz-bansync/pz-bansync.py`      | 主程序       |
| 日志      | `/home/debian/pz-bansync/pz-bansync.log`     | 运行日志     |
| 服务      | `/etc/systemd/system/pz-bansync.service`     | systemd 定义 |
| PZ 数据库 | `/home/debian/Zomboid/db/servertest.db`      | 被同步目标   |
| PZ 配置   | `/home/debian/Zomboid/Server/servertest.ini` | RCON 来源    |

### 14.2 相关 API（banserver）

| 接口                                   | 方法 | 说明                         |
| -------------------------------------- | ---- | ---------------------------- |
| `/health`                              | GET  | 健康检查                     |
| `/api/auth/login`                      | POST | 登录获取 token               |
| `/api/bans?status=active&limit=100000` | GET  | 获取所有 active 封禁         |
| `/api/public/bans`                     | GET  | 公开封禁列表（不含 SteamID） |

### 14.3 相关 RCON 命令（PZ）

| 命令                | 说明         |
| ------------------- | ------------ |
| `players`           | 列出在线玩家 |
| `banid <SteamID>`   | 封禁 SteamID |
| `unbanid <SteamID>` | 解封 SteamID |
| `kick <用户名>`     | 踢出玩家     |
| `save`              | 保存游戏     |

### 14.4 版本记录

| 版本 | 日期       | 变化                           |
| ---- | ---------- | ------------------------------ |
| v1.3 | 2026-09-23 | 更改BanServer地址              |
| v1.2 | 2026-09-22 | 增加"网页端注册与使用教程"章节 |
| v1.1 | 2026-09-22 | 增加 `SYNC_MODE` 同步模式      |
| v1.0 | 2026-09-22 | 初版，单向同步                 |

### 14.5 部署前检查清单

- [ ] banserver 网页可访问、HTTPS 证书有效
- [ ] 已注册账号并被审批通过
- [ ] 已添加至少一台服务器
- [ ] 已添加至少一条测试封禁
- [ ] PZ RCON 已开启并监听 27015
- [ ] PZ 数据库路径正确且脚本可读
- [ ] 脚本 `SYNC_MODE` 已按场景选择
- [ ] systemd 服务已部署并 `enable`
- [ ] 观察 3~5 轮日志无异常

---

## 使用流程全景图

```
┌─────────────────────────────────────────────────────────────┐
│                    服主日常操作流程                            │
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
        │                                     无冲突      有冲突
        ▼                                       │          │
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
                                        (撤销封禁)             (保持封禁)

┌─────────────────────────────────────────────────────────────┐
│              后台自动同步流程（无需人工干预）                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    pz-bansync.py 每 5 分钟
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        API 拉取        读 PZ 数据库       计算差异
        封禁列表          bannedid          to_ban/to_unban
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

---

**文档结束**

**接入完成后**：banserver 上的封禁记录将在 5 分钟内自动同步到 PZ 服务器。首次部署建议用 `add_only` 模式观察 1~2 天，确认无误后再切换到 `full`。
