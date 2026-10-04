# Sub2api Manager

面向 sub2api 的轻量管理与监控面板，集中查看账号状态、额度与消费，并支持分组默认倍率调整。移动端优先，支持 PWA 安装与多设备配置同步。

[快速开始](#快速开始) · [本地开发](#本地开发) · [使用说明](#使用说明) · [文档](#文档)

## 功能

- **账号监控**：账号目录与详情、关注与排序、OAuth 额度窗口、API Key 本地限额；OpenAI OAuth 详情展示重置卡、Credits 与可邀请数量，支持查询最新数据。
- **资源管理**：账号与分组共用资源入口；分组支持搜索、平台筛选和默认倍率调整，写入 sub2api 前需二次确认。
- **消费统计**：今日与周期消费、订阅成本、用户消费榜及 K/M/B 单位的 Token 用量，支持本小时、今天、近 7 天和近 30 天范围。
- **统计偏好**：自定义时区与货币符号、排除 Admin 消费、隐藏金额。
- **多设备同步**：共享关注账号、订阅配置、刷新间隔与进入验证开关；主题和金额隐藏按设备保存。
- **登录与安全**：独立访问密码、Passkey 登录、可配置进入时验证；Admin Key 仅由服务端读取。
- **移动体验**：响应式布局、浅色 / 深色主题、添加到主屏幕与应用更新提示。

## 快速开始

需要可访问的 sub2api 实例及其 Admin API Key。以下命令在项目根目录执行。

### 1. 配置环境变量

```sh
cp .env.example .env
chmod 600 .env
```

已有 `.env` 时直接编辑，避免覆盖原配置。填写以下变量：

| 变量 | 说明 |
| --- | --- |
| `SUB2API_URL` | sub2api 地址，支持子路径，默认要求 HTTPS |
| `SUB2API_ADMIN_KEY` | 上游 Admin API Key，仅服务端使用 |
| `APP_PASSWORD` | 应用独立访问密码，至少 16 个字符 |
| `APP_ORIGIN` | 浏览器实际访问的来源，如 `https://manager.example.com`；域名和端口须完全匹配，不带路径或末尾斜杠 |
| `SUB2API_TIMEZONE` | IANA 时区，如 `Asia/Shanghai`，需与上游统计时区一致 |

可选配置：`INSTANCE_NAME` 设置工作空间名称，`PORT` 设置本地 API 或 Docker 宿主端口，`ALLOW_HTTP_UPSTREAM=true` 允许 HTTP 上游。完整说明见 [部署文档](docs/docker.md)。

密码和密钥保留模板中的双引号；包含 `$` 时写成 `\$`，兼容 Bun 与 Compose。不要将 Admin Key 放入 `VITE_` 环境变量。

### 2. 启动 Docker 服务

需要 Docker Engine、BuildKit 和 Docker Compose v2。

```sh
cp docker-compose.example.yaml docker-compose.yaml
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 120
```

已有 `docker-compose.yaml` 时保留现有配置，按需合并模板变更。

默认端口为 `127.0.0.1:3001`。配置 HTTPS 反向代理，将请求转发到该地址，并保持路径与请求 `Origin`；`APP_ORIGIN` 必须与实际 HTTPS 入口一致。通过该入口使用 `APP_PASSWORD` 登录。

HTTPS 接入、容器网络、更新与排查见 [Docker 部署指南](docs/docker.md)。

## 本地开发

使用 Bun 1.3.9。先按[环境变量说明](#1-配置环境变量)准备 `.env`，再执行：

```sh
bun install
APP_ORIGIN=http://localhost:5173 bun run dev
```

访问 `http://localhost:5173`。Vite 将 `/api` 请求代理到本地后端，默认地址为 `127.0.0.1:3001`。

端口冲突时可同时调整前端端口、后端端口与访问来源：

```sh
DEV_PORT=5188 PORT=3008 APP_ORIGIN=http://localhost:5188 bun run dev
```

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `bun run dev` | 同时启动前端与后端开发服务 |
| `bun run test` | 运行 Vitest 测试 |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run lint` | 代码检查 |
| `bun run build` | 类型检查并构建前端 |
| `bun run build:server` | 打包服务端 |
| `bun run start` | 启动生产服务，提供前端静态资源与 API |

直接使用 Bun 部署时，先执行 `bun run build`，再执行 `APP_ORIGIN=https://manager.example.com bun run start`，并配置 HTTPS 反向代理。

技术栈：React、TypeScript、Vite、shadcn/ui、TanStack Router / Query / Form、Bun 与 Elysia。

## 使用说明

1. 首次登录后，在账号目录中选择关注的账号，并填写订阅成本与续费日。
2. 在 **设置 → 登录与安全** 添加 Passkey。密码仍可用于登录；更换域名后需重新添加 Passkey。
3. 在 **设置** 中调整统计偏好与刷新间隔，或导入、导出配置。
4. 在 iPhone 上通过 Safari 打开 HTTPS 入口，使用分享菜单添加到主屏幕。

在 **设置 → 登录与安全** 调整“进入时验证”，默认开启：关闭、刷新页面或进入后台后，再次访问需要验证。关闭此开关后，当前设备的登录会话有效时，打开、刷新及从后台返回网页 / PWA 均直接进入；此设置同步到所有设备，各设备仍需分别登录。会话最长有效 7 天，退出登录、移除所用 Passkey 或服务端重启后需重新登录。PWA 仅缓存静态应用资源，不缓存 API 响应；离线冷启动不能读取账号数据。

自动刷新使用服务端共享缓存与请求去重。手动刷新跳过应用正常缓存间隔，仍遵守失败退避与上游限流；消费榜数据新鲜度受上游缓存限制。没有客户端请求时，后端不会继续刷新上游。

账号权益日常读取 sub2api 的账号快照；“重置卡与 Credits”和“邀请”分别提供刷新按钮，每次只调用对应的 sub2api 查询接口并保存快照，后续进入页面可直接读取。重置卡与 Credits 共用 quota 接口，可邀请数量独立查询；各组加载、错误与保存提示互不影响。三个字段分别展示查询时间，未知值或时间显示 `—`。重置卡展示到期时间，Credits 保留余额精度，查询失败保留已有值。需要 sub2api 提供 OpenAI 权益刷新接口。

OpenAI OAuth 母账号详情展示自动使用重置卡的开关及 5 小时、7 日触发阈值。可以在本应用中开启或关闭；确认时显示最新阈值，保存到 sub2api 后同步状态。未配置时默认关闭，两个阈值默认均为 100%；阈值调整使用 sub2api。

有应用更新时，设置导航显示更新标记，在 **设置** 或 **设置 → 应用与数据** 点击“更新并重载”。

## 数据与部署

应用采用单人工作空间，生产环境使用一个应用进程。会话与监控缓存在内存中，重启后需要重新登录。

共享配置与 Passkey 公钥凭证保存到 `DATA_DIR/workspace.json`。本地默认目录为 `.data`；Docker 使用挂载到 `/app/data` 的命名卷。更新前备份该文件，保留原数据卷。页面导出的配置不包含 Passkey。

旧版升级后需更新前端并重新登录。若首次登录出现本机配置迁移提示，建议在配置最完整的设备上完成迁移；已有服务器配置不会被旧设备自动覆盖。

## 文档

- [Docker 部署指南](docs/docker.md)：环境变量、HTTPS、持久化、更新与排查。
- [技术架构](docs/architecture.md)：页面设计、统计口径、缓存、认证与配置同步。
- [请求与缓存审计](docs/server-request-audit.md)：请求行为与验证记录。
