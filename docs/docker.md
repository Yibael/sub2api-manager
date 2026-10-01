# Docker 与 Compose 部署

## 文件

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 多阶段构建前端与服务端，最终镜像只包含 Bun 和应用产物 |
| `.dockerignore` | 排除环境文件、本地数据、Git、依赖目录及旧构建产物 |
| `docker-compose.example.yaml` | Compose 部署模板，包含单实例应用、持久化卷、回环端口及运行配置 |
| `docker-compose.yaml` | 从模板复制的实际部署配置，已被 Git 忽略 |
| `.env.example` | 本地开发与容器部署共用的环境变量模板 |
| `scripts/healthcheck.ts` | 检查容器内应用响应及配置是否已加载，不请求 sub2api |

需要 Docker Engine、BuildKit 和 Docker Compose v2。镜像使用与 `package.json` 一致的 Bun 1.3.9；版本固定在 Dockerfile 中，升级时同步修改 `packageManager` 和 Dockerfile，无需用户配置。构建使用锁文件，凭据仅在运行时传入。

## 首次启动

在项目根目录执行：

```sh
cp .env.example .env
chmod 600 .env
cp docker-compose.example.yaml docker-compose.yaml
```

已有 `.env` 时直接编辑，不要重新复制覆盖。本地开发和 Docker 共用这一份文件；Compose 自动读取项目根目录的 `.env`。

Compose 使用 `docker-compose.yaml`，可按部署环境修改；已有文件时不要覆盖。仓库只跟踪 `docker-compose.example.yaml` 模板，本地 Compose 配置不会提交到 Git，也不会进入镜像构建上下文。从旧版本迁移时，将原有 `compose.yaml` 重命名为 `docker-compose.yaml`，保留自定义配置。

本地开发可仅在启动时覆盖访问地址：

```sh
APP_ORIGIN=http://localhost:5173 bun run dev
```

编辑 `.env`：

| 变量 | 配置 |
| --- | --- |
| `APP_ORIGIN` | 浏览器使用的完整 HTTPS 来源，例如 `https://manager.example.com`；不带路径或末尾斜杠 |
| `SUB2API_URL` | 真实 sub2api 地址，支持子路径，默认要求 HTTPS |
| `SUB2API_ADMIN_KEY` | sub2api Admin API Key |
| `APP_PASSWORD` | 应用独立访问密码，至少 16 个字符 |
| `SUB2API_TIMEZONE` | 与上游今日统计一致的时区，默认 `Asia/Shanghai` |
| `PORT` | 本地 API 端口或 Docker 宿主机回环端口，默认 `3001`；容器内部固定使用 `3001` |
| `INSTANCE_NAME` | 工作空间名称 |
| `ALLOW_HTTP_UPSTREAM` | 上游使用 HTTP 时显式设为 `true`，不会改变浏览器入口的 HTTPS 要求 |

密码或密钥保留模板中的双引号，美元符号写成 `\$`，例如实际密码中的 `abc$def` 在文件中写作 `"abc\$def"`。这一写法同时兼容 Bun 和 Compose，也避免 `#` 被当作注释。不要把密钥写进 Dockerfile、构建参数或 `VITE_` 变量。

```sh
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 120
docker compose ps
```

必填变量为空时 Compose 会拒绝启动；密码长度、HTTPS 和时区由应用启动检查。`config --quiet` 只校验，不输出展开后的凭据。

## HTTPS 入口

默认只将应用发布到宿主机 `127.0.0.1:3001`，由宿主机上的 HTTPS 反向代理对外提供访问。容器内监听 `0.0.0.0:3001`。应用本身不签发证书，`APP_ORIGIN` 不会自动配置 TLS。

例如已有 Caddy 时，添加以下站点，并将域名 DNS 指向部署服务器：

```caddyfile
manager.example.com {
    reverse_proxy 127.0.0.1:3001
}
```

将 `APP_ORIGIN` 设置为同一域名的 HTTPS 来源。反向代理需要保持请求路径及 `Origin`，不应缓存 `/api` 响应。配置生效后，通过 HTTPS 地址登录应用；iPhone 可以从 Safari 添加到主屏幕。

如果反向代理也在容器内，需要将两个服务加入同一个 Docker 网络，并代理到 `app:3001`；代理容器中的 `127.0.0.1` 不指向应用容器。此时可在部署环境的 Compose 覆盖文件中配置共享网络，通常无需发布应用的宿主端口。

Passkey 使用同一个 HTTPS 入口和 `APP_ORIGIN`，无需额外端口或代理路径。域名变更会影响已有 Passkey，使用保留的访问密码登录后重新添加。

如果 sub2api 也在容器内，`SUB2API_URL` 应填写可从应用容器访问的服务地址；不要把 `localhost` 当作宿主机或另一个容器。使用内部 HTTP 地址时同时设置 `ALLOW_HTTP_UPSTREAM=true`。

## 镜像与持久化

- 构建阶段安装完整依赖并进行类型检查、前端构建和服务端打包。
- 运行阶段不复制 `node_modules`、测试数据或源码目录，使用非 root 的 `bun` 用户。
- 根文件系统只读，`/tmp` 使用临时内存文件系统，`/app/data` 为可写命名卷。
- 默认卷 `sub2api-manager_app-data` 保存 `workspace.json`，包含共享配置、稳定工作空间 ID 和 Passkey 公钥凭证；旧 `intervals.json` 仅用于首次迁移和旧接口兼容。更改 Compose 项目名会使用不同卷。不要对需要保留的部署执行 `down --volumes`。
- 关注账号、订阅成本、续费日、货币符号、统计口径和刷新间隔在服务端保存；主题与金额隐藏留在各设备浏览器。
- 更新前备份数据卷中的 `workspace.json`。配置导出不包含 Passkey；恢复该文件才能保留完整工作空间和凭证。更换 Admin Key 不改变工作空间 ID。
- 登录会话、共享缓存和冷却状态保存在进程内存中，重建容器后需要重新登录。使用一个应用实例，不要通过多副本绕开共享限流。
- 每 30 秒的健康检查仅调用容器自己的 `/api/config`，不访问 sub2api，不改变“没有客户端请求就不刷新上游”的行为。健康状态表示应用可响应且已加载连接配置，不代表上游 Key 已验证。
- 容器因退出而停止时由 `unless-stopped` 重启；Docker 将状态标为 `unhealthy` 本身不会自动重启容器。

## 更新与排查

此次页面锁定认证为不兼容更新。部署后需要加载新前端并重新登录；已有 PWA 更新并重载，仍停留在旧版时关闭该站点所有页面和 PWA 后重新打开。共享业务配置与已有 Passkey 公钥继续使用原数据卷。

如果仍看到旧版名称，先用无痕窗口确认新页面能否登录。iPhone 上可在“设置 → App → Safari 浏览器 → 高级 → 网站数据”删除对应站点条目；主屏幕 PWA 的 Cookie 和存储与 Safari 独立，仍停留旧版时删除该主屏幕 App，再从已加载新版的 Safari 页面通过分享菜单重新添加。网站数据或 App 删除会清除本机缓存、登录状态和本地设置，先导出尚未迁移的旧配置；已保存到服务器的共享配置不受影响。不要为了更新应用删除服务器数据卷。参考 [Apple 的清理步骤](https://support.apple.com/zh-cn/105082) 和 [主屏幕 Web App 存储说明](https://developer.apple.com/videos/play/wwdc2023/10120/)。

本次 Passkey 与服务端配置同步无需修改 Dockerfile、Compose 网络或 Caddy 反代，也无需新增环境变量。已有外部 `proxy` 网络的部署保留共享网络及应用的服务别名，继续代理到容器的 `3001` 端口。确认 `APP_ORIGIN` 等于浏览器实际使用的 HTTPS 来源，并沿用原项目名和 `/app/data` 数据卷；镜像重建会按 `bun.lock` 安装新增依赖。

更新代码后重新构建并启动：

如 `docker-compose.example.yaml` 有变更，先按需合并到本地 `docker-compose.yaml`，保留部署环境的自定义配置。

```sh
docker compose up -d --build --wait --wait-timeout 120
docker compose logs --tail=100 app
```

修改 `.env` 后使用 `up -d` 重新创建服务，单独 `restart` 不会应用新的环境变量。

```sh
docker compose up -d --wait --wait-timeout 120
```

停止应用但保留数据卷：

```sh
docker compose down
```

首次构建需要访问镜像和包仓库。若拉取或安装失败，检查部署机的网络和 Docker 代理配置。`bun.lock` 固定了依赖及其下载地址，单纯更改 npm 默认 registry 不一定替换锁文件中的地址。

## 构建方式

Compose 使用 `build: .`，默认读取项目根目录的 Dockerfile，并自动为构建结果命名。日常部署只需 `docker compose up -d --build`，不需要手动设置镜像名或 Bun 版本。需要发布到镜像仓库时，再为相应发布流程添加镜像标签。

默认生成当前 Docker 引擎架构的镜像；跨架构构建需要引擎提供对应的构建器或模拟支持。

## 验证记录

此前已在 `linux/arm64` 上实际构建镜像，并使用独立 Compose 项目验证：健康检查、登录鉴权、静态资源、SPA 路由、PWA 清单、只读根文件系统、非 root 用户、设置写入及容器重建后的数据保留。当时 58 项 Vitest 测试、类型检查和 Lint 通过。验收只使用占位连接参数，没有访问真实 sub2api；`linux/amd64` 构建和实际 HTTPS 入口未在本次验收中运行。

统一配置后另行验证了默认 `.env` 读取、`build: .` 自动命名镜像、宿主机与容器端口区分，以及包含美元符号的密码在 Bun 与 Compose 中保持一致并可正常登录。

本次 Passkey、配置同步与页面锁定改动通过 84 项 Vitest 测试、类型检查、Lint、前端生产构建和服务端打包；使用隔离测试数据检查内置浏览器交互与 Bun 打包服务的启动、登录、Passkey 验证和持久化恢复。

另使用现有 Dockerfile 在 `linux/arm64` 构建镜像，并在禁用网络、非 root、只读根文件系统的隔离容器中验证密码登录、Cookie 与页面验证令牌绑定、真实 ES256 Passkey 注册与认证、页面锁定、过期锁定请求隔离、健康检查及重建后配置与 Passkey 保留。使用独立数据卷及测试凭据；未连接真实上游，实际 HTTPS 入口、`linux/amd64` 和系统生物识别注册仍需在部署环境验收。
