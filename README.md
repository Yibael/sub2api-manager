# Sub2api Manager

基于 sub2bar 功能设计的移动端优先、只读 sub2api 监控 PWA。使用 React、shadcn/ui、TanStack Router / Query / Form，以及 Bun + Elysia。

## 运行

```sh
bun install
cp .env.example .env
```

在 `.env` 中填写：

- `SUB2API_URL`：sub2api 地址，支持子路径。默认要求 HTTPS。
- `SUB2API_ADMIN_KEY`：上游 Admin API Key，仅服务端读取。
- `APP_PASSWORD`：此监控应用的独立访问密码，至少 16 个字符。
- `APP_ORIGIN`：浏览器实际访问的完整来源；开发默认 `http://localhost:5173`，生产必须 HTTPS。域名和端口需要完全匹配。
- `SUB2API_TIMEZONE`：与 sub2api 今日统计一致的 IANA 时区，例如 `Asia/Shanghai`。

```sh
bun run dev
```

使用 `http://localhost:5173`。开发 API 默认监听 `127.0.0.1:3001`，由 Vite 同源代理。

未配置 sub2api 时显示连接设置页面。配置完成后需先登录，再从账号目录选择关注的账号、填写订阅配置。应用不会预填账号、消费或订阅金额。

如默认端口已占用：

```sh
DEV_PORT=5188 PORT=3008 APP_ORIGIN=http://localhost:5188 bun run dev
```

## 核心行为

- 概览、账号管理、账号详情、消费统计和设置；手机底部导航、桌面侧栏、浅色 / 深色模式。
- Pin 与排序、OAuth 订阅配置、今日标准用量、额度窗口与 API Key 本地限额。
- 概览展示今日消费、周期消费、当前并发、今日标准用量；7日额度估算仅在 OpenAI OAuth 账号中展示。消费支持指定时区、排除 Admin、金额隐藏；成本按周期配置。
- 浏览器只请求应用后端，后端携带 Admin Key 查询 sub2api。
- **共享缓存**：5 秒间隔内，设备 B 直接复用设备 A 的查询结果，不显示缓存命中提示。
- **并发去重**：相同账号同时查询只执行一次；重叠账号列表按账号复用。
- **没有后端轮询**：缓存到期只等待下一次请求。关闭所有设备后，不会启动后续刷新。正在进行的一轮请求有超时上限。
- 普通手动刷新同样遵守缓存间隔；额度查询不使用 `force=true`。
- 间隔按账号和数据范围执行；不同账号、不同日期范围或时区可各自查询，并非整个实例每 5 秒只能发一个 HTTP 请求。上游同时最多执行 4 个请求。
- 消费总计和 Admin 小计按实际查询参数共享缓存，切换 Admin 开关不会重复读取同一总计。429 遵守 `Retry-After`，冷却期间整个上游连接不再启动请求。
- 失败保留同范围旧值并显示失败；没有历史结果显示未知。跨日、跨周期不会复用不匹配的统计。
- 刷新间隔保存到 `DATA_DIR/intervals.json`，其他配置按实例保存在设备，可导入导出。

## 生产部署

```sh
bun run build
APP_ORIGIN=https://manager.example.com bun run start
```

生产由 Elysia 同时提供 `dist` 静态资源、SPA 路由回退和 `/api`。在前面配置 HTTPS 反向代理；代理到 `127.0.0.1:3001`，保持路径与请求 `Origin`。不要将管理员密钥放入任何 `VITE_` 环境变量。

Docker Compose：

```sh
cp .env.docker.example .env.docker
chmod 600 .env.docker
# 编辑 .env.docker，填写真实连接、访问密码和 HTTPS 来源
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up -d --build --wait --wait-timeout 120
```

镜像采用多阶段构建，服务端打包后无需运行时 `node_modules`；容器使用非 root 用户和只读根文件系统。共享刷新设置保存到 `/app/data` 命名卷。宿主端口默认只绑定 `127.0.0.1:3001`，通过现有 HTTPS 反向代理对外提供访问。

健康检查只读取容器内配置接口，不触发 sub2api 查询。详细环境变量、HTTPS 接入、更新和跨架构构建见 [docs/docker.md](docs/docker.md)。

当前使用单进程缓存与内存会话，部署一个应用进程；进程重启后需要重新登录，数据在下一次请求时重建。多副本共享缓存、跨设备偏好同步和后台推送不在本版范围。

## PWA

生产构建生成 Manifest 和 Service Worker。iPhone 上在 Safari 打开 HTTPS 地址，通过分享菜单添加到主屏幕。应用已包含安全区、独立窗口模式、触控布局和更新提示。

仅预缓存静态应用资源，`/api` 响应不会进入 Service Worker 缓存。当前会话断网时保留内存数据；离线冷启动仅展示应用外壳和连接错误，不读取持久化账号快照。

## 验证

```sh
bun run test
bun run typecheck
bun run lint
bun run build
```

Vitest 覆盖 20 客户端并发、跨登录会话共享、手动刷新、目录分页、批量重叠、跨日不突破间隔、消费原始数据复用、闲置不查询、失败退避、429 冷却、队列取消、时区及短月续费边界、统计口径、认证和响应裁剪等行为。界面通过 computer use 检查，无 Playwright 测试依赖。

固定上游响应仅保留在 `tests/fixtures`，用于自动化测试；应用服务、前端构建和生产容器不包含这套数据源。

接口实现参考本地 sub2bar 的接口核查和模型；尚未使用用户真实实例验证部署版本。iOS 真机安装、键盘与系统恢复行为仍需在实际 HTTPS 部署后验收，桌面手机视口检查不能替代真机测试。

更多设计约定见 [docs/architecture.md](docs/architecture.md)。
请求与缓存检查记录见 [docs/server-request-audit.md](docs/server-request-audit.md)。
