# Docker 与 Compose 部署

## 文件

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 多阶段构建前端与服务端，最终镜像只包含 Bun 和应用产物 |
| `.dockerignore` | 排除环境文件、本地数据、Git、依赖目录及旧构建产物 |
| `compose.yaml` | 单实例应用、持久化卷、回环端口及运行配置 |
| `.env.docker.example` | 容器部署专用环境变量模板 |
| `scripts/healthcheck.ts` | 检查容器内应用响应及配置是否已加载，不请求 sub2api |

需要 Docker Engine、BuildKit 和 Docker Compose v2。镜像使用与 `package.json` 一致的 Bun 1.3.9；升级时同步修改 `packageManager`、Dockerfile 和环境模板默认版本。构建使用锁文件，凭据仅在运行时传入。

## 首次启动

在项目根目录执行：

```sh
cp .env.docker.example .env.docker
chmod 600 .env.docker
```

编辑 `.env.docker`：

| 变量 | 配置 |
| --- | --- |
| `APP_ORIGIN` | 浏览器使用的完整 HTTPS 来源，例如 `https://manager.example.com`；不带路径或末尾斜杠 |
| `SUB2API_URL` | 真实 sub2api 地址，支持子路径，默认要求 HTTPS |
| `SUB2API_ADMIN_KEY` | sub2api Admin API Key |
| `APP_PASSWORD` | 应用独立访问密码，至少 16 个字符 |
| `SUB2API_TIMEZONE` | 与上游今日统计一致的时区，默认 `Asia/Shanghai` |
| `APP_PORT` | 宿主机回环端口，默认 `3001`；容器内部固定使用 `3001` |
| `INSTANCE_NAME` | 工作空间名称 |
| `ALLOW_HTTP_UPSTREAM` | 上游使用 HTTP 时显式设为 `true`，不会改变浏览器入口的 HTTPS 要求 |
| `SUB2API_MANAGER_IMAGE` | 本地构建的镜像名称与标签，默认 `sub2api-manager:local` |

密码或密钥包含 `$`、`#` 等字符时，保留模板中的单引号，避免 Compose 展开或截断。不要使用开发用的 `.env` 代替这个文件；不要把密钥写进 Dockerfile、构建参数或 `VITE_` 变量。

```sh
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up -d --build --wait --wait-timeout 120
docker compose --env-file .env.docker ps
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

如果 sub2api 也在容器内，`SUB2API_URL` 应填写可从应用容器访问的服务地址；不要把 `localhost` 当作宿主机或另一个容器。使用内部 HTTP 地址时同时设置 `ALLOW_HTTP_UPSTREAM=true`。

## 镜像与持久化

- 构建阶段安装完整依赖并进行类型检查、前端构建和服务端打包。
- 运行阶段不复制 `node_modules`、测试数据或源码目录，使用非 root 的 `bun` 用户。
- 根文件系统只读，`/tmp` 使用临时内存文件系统，`/app/data` 为可写命名卷。
- 默认卷 `sub2api-manager_app-data` 保存 `intervals.json`；更改 Compose 项目名会使用不同卷。不要对需要保留的部署执行 `down --volumes`。
- 关注账号、订阅设置和显示偏好仍保存在各设备浏览器中，不在容器卷里。
- 登录会话、共享缓存和冷却状态保存在进程内存中，重建容器后需要重新登录。使用一个应用实例，不要通过多副本绕开共享限流。
- 每 30 秒的健康检查仅调用容器自己的 `/api/config`，不访问 sub2api，不改变“没有客户端请求就不刷新上游”的行为。健康状态表示应用可响应且已加载连接配置，不代表上游 Key 已验证。
- 容器因退出而停止时由 `unless-stopped` 重启；Docker 将状态标为 `unhealthy` 本身不会自动重启容器。

## 更新与排查

更新代码后重新构建并启动：

```sh
docker compose --env-file .env.docker up -d --build --wait --wait-timeout 120
docker compose --env-file .env.docker logs --tail=100 app
```

修改 `.env.docker` 后使用 `up -d` 重新创建服务，单独 `restart` 不会应用新的环境变量。

```sh
docker compose --env-file .env.docker up -d --wait --wait-timeout 120
```

停止应用但保留数据卷：

```sh
docker compose --env-file .env.docker down
```

首次构建需要访问镜像和包仓库。若拉取或安装失败，检查部署机的网络和 Docker 代理配置。`bun.lock` 固定了依赖及其下载地址，单纯更改 npm 默认 registry 不一定替换锁文件中的地址。

## 单独构建与跨架构

```sh
docker build -t sub2api-manager:local .
```

默认生成当前 Docker 引擎架构的镜像。Apple Silicon 上构建用于 x86 服务器的镜像时，可指定：

```sh
docker build --platform linux/amd64 -t sub2api-manager:amd64 .
docker save -o /tmp/sub2api-manager-amd64.tar sub2api-manager:amd64
```

目标服务器加载镜像后，将 `.env.docker` 中的 `SUB2API_MANAGER_IMAGE` 设置为对应标签，并跳过重新构建：

```sh
docker load -i /path/to/sub2api-manager-amd64.tar
docker compose --env-file .env.docker up -d --no-build --wait --wait-timeout 120
```

目标机仍需 `compose.yaml` 和填写后的 `.env.docker`。实际多架构构建取决于 Docker 引擎提供的构建器与架构模拟支持。

## 本次验证

已在 `linux/arm64` 上实际构建镜像，并使用独立 Compose 项目验证：健康检查、登录鉴权、静态资源、SPA 路由、PWA 清单、只读根文件系统、非 root 用户、设置写入及容器重建后的数据保留。58 项 Vitest 测试、类型检查和 Lint 通过。验收只使用占位连接参数，没有访问真实 sub2api；`linux/amd64` 构建和实际 HTTPS 入口未在本次验收中运行。
