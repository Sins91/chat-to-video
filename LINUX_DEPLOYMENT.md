# Chat-to-Video 全新 Linux 服务器部署指南

本文说明如何在一台全新的 Linux 服务器上，以 Docker Compose 部署当前仓库的 Web、API、Worker、MySQL、Redis 和 MinIO。流程以 Ubuntu 24.04 LTS、单机、单域名/双域名、Docker Compose V2 为示例。

> [!IMPORTANT]
> 当前项目处于 **Engineering Preview** 阶段，适合内网、测试和受控演示，不应直接作为公网生产系统开放。仓库目前尚未完成身份认证、资源级授权、生产密钥管理、完整可观测性和灾备；租户/项目命名空间仍固定为 `tenant/demo/project/demo`，模型和视频生成还会产生真实费用。

## 1. 部署结果与拓扑

推荐在单机上保持以下边界：

```text
Internet
   │  HTTPS 443
   ▼
Nginx（宿主机）
   ├── app.example.com   → 127.0.0.1:4000 → Next.js Web → NestJS API
   └── media.example.com → 127.0.0.1:9000 → MinIO S3 API

Docker Compose 内部网络
   ├── Web
   ├── API
   ├── Worker（FFmpeg/FFprobe/Sharp）
   ├── MySQL（业务事实）
   ├── Redis AOF（BullMQ、工作流快照与事件）
   └── MinIO（素材、中间产物和成片）
```

公网只开放 SSH、HTTP 和 HTTPS。MySQL、Redis、API、MinIO Console 不应直接暴露到公网。Web 通过服务端 BFF 访问 API；浏览器使用 API 签发的 MinIO 预签名 URL 直传和下载，因此 `S3_ENDPOINT` 必须是浏览器可访问的 HTTPS 地址。

## 2. 上线前必须确认

### 2.1 当前仓库状态门禁

部署固定的 Git tag 或 commit，不要直接部署会继续变化的分支。执行：

```bash
git status --short
git rev-parse HEAD
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local build database-migrate api worker web
```

只有配置解析和全部镜像构建成功后才能继续。

> [!WARNING]
> 截至本文编写时，`infra/docker/Dockerfile` 的依赖阶段未复制 `packages/tools/package.json`，API 构建阶段也未复制 `packages/tools` 及其依赖的 `packages/media`。但 `apps/api/package.json` 已依赖 `@chat-to-video/tools`，因此当前版本很可能无法通过上述镜像构建门禁。部署前应先在代码库中修复并走正常评审；不要在服务器上临时手改后跳过版本管理。

### 2.2 生产就绪门禁

若目标是正式公网生产环境，还必须在上线前补齐并验证：

- 用户身份认证、租户和项目级授权；
- 密钥托管与轮换，且日志不输出 Token、签名 URL 或敏感内容；
- APIMart 工具调用、结构化输出、超时、限流、重试、用量与错误语义的真实账户验收；
- 费用上限、并发上限、内容安全和滥用防护；
- MySQL、Redis AOF、MinIO 的异机备份及恢复演练；
- 日志、指标、告警、磁盘容量和 Worker 资源监控；
- 发布、数据库迁移兼容性和回滚方案。

未满足这些条件时，按“受控验证环境”管理：限制访问来源，不对不受信用户开放。

## 3. 服务器与域名准备

建议起步规格：

- Ubuntu 24.04 LTS x86_64；
- 4 核 CPU、16 GiB 内存、100 GiB 以上 SSD；
- Worker 的 CPU、内存和临时磁盘按并发及素材大小继续扩容；
- 两个解析到服务器公网 IP 的域名，例如 `app.example.com` 和 `media.example.com`；
- 云安全组只放行 TCP `22`、`80`、`443`，SSH 最好再限制来源 IP。

视频和中间产物会快速消耗空间。正式使用前应根据保留周期评估容量，并为 Docker 数据目录、MySQL 和 MinIO 分配独立磁盘或独立挂载点。

## 4. 初始化 Linux

以下命令以具备 `sudo` 权限的部署用户执行：

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl git nginx openssl
sudo timedatectl set-timezone Asia/Shanghai
```

按 [Docker 官方 Ubuntu 安装文档](https://docs.docker.com/engine/install/ubuntu/) 配置 Docker 官方 apt 仓库，然后安装：

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

可选地允许部署用户使用 Docker：

```bash
sudo usermod -aG docker "$USER"
```

重新登录后生效。`docker` 组等同于较高的主机权限，只应授予受信运维用户。

## 5. 获取代码

推荐把应用放在 `/opt/chat-to-video`：

```bash
sudo install -d -o "$USER" -g "$USER" /opt/chat-to-video
git clone <YOUR_REPOSITORY_URL> /opt/chat-to-video
cd /opt/chat-to-video
git fetch --tags
git checkout <RELEASE_TAG_OR_COMMIT>
git status --short
git rev-parse HEAD
```

服务器无需额外安装 Node.js、pnpm、FFmpeg 或 FFprobe；当前多阶段镜像固定 Node.js 26.7.0 和 pnpm 11.20.0，Worker 镜像安装 FFmpeg 与 Noto CJK 字体。

## 6. 创建服务器环境变量

复制模板并限制权限：

```bash
cd /opt/chat-to-video
cp .env.example .env.local
chmod 600 .env.local
```

生成 URI 安全的随机值。每条命令分别保存输出，再填入 `.env.local`，不要把真实值提交到 Git：

```bash
openssl rand -hex 24
openssl rand -hex 32
openssl rand -hex 32
```

至少核对以下配置。示例值必须全部替换：

```dotenv
NODE_ENV=production

WEB_PORT=4000
API_PORT=4101

MYSQL_PORT=4002
MYSQL_DATABASE=chat_to_video
MYSQL_USER=chat_to_video
MYSQL_PASSWORD=<HEX_DATABASE_PASSWORD>
MYSQL_ROOT_PASSWORD=<HEX_DATABASE_ROOT_PASSWORD>

REDIS_PORT=4003

S3_PORT=9000
S3_CONSOLE_PORT=9001
S3_REGION=us-east-1
S3_ACCESS_KEY=chat_to_video
S3_SECRET_KEY=<HEX_MINIO_SECRET>
S3_BUCKET=chat-to-video
S3_FORCE_PATH_STYLE=true

LLM_PROVIDER=apimart
LLM_TOOL_CALLING_ENABLED=true
CINEMATIC_SINGLE_PASS_STAGES=
CINEMATIC_CREATION_ENABLED=true

APIMART_BASE_URL=https://api.apimart.ai/v1
APIMART_API_KEY=<REAL_APIMART_API_KEY>
APIMART_CHAT_MODEL=gpt-5-mini
APIMART_TIMEOUT_MS=600000
APIMART_STORYBOARD_TIMEOUT_MS=120000
APIMART_VIDEO_MODEL=doubao-seedance-2.0
APIMART_VIDEO_DURATION_SECONDS=10
APIMART_REFERENCE_INPUTS_VERIFIED=false
APIMART_VIDEO_POLL_INTERVAL_MS=5000
APIMART_VIDEO_RESULT_HOSTS=apimart.ai,getapib.org
APIMART_VIDEO_TASK_TIMEOUT_MS=900000
```

注意：

- 使用十六进制密码可避免 `DATABASE_URL` 中的 URI 特殊字符转义问题；
- API 在选择 APIMart 时仍会强制要求 `APIMART_API_KEY`、`APIMART_BASE_URL` 和 `APIMART_CHAT_MODEL`；
- Worker 还强制要求 APIMart 视频配置、数据库、Redis、S3 和 `FFMPEG_PATH`，现有 Compose 已注入其余连接值；
- `APIMART_REFERENCE_INPUTS_VERIFIED` 只有在引用图输入集成合同验收通过后才能改为 `true`；
- `.env.local` 同时被 Compose 用于变量插值，并被 Worker 的 `env_file` 引用，文件名不能随意省略。

## 7. 添加单机部署覆盖文件

现有 `compose.yaml` 面向本地体验，会把 MySQL、Redis、API、Web 和 MinIO 端口发布到所有网卡。服务器上新增 `compose.production.yaml`，只绑定到回环地址，并让 API 使用公网 MinIO 域名签发 URL：

```yaml
services:
  mysql:
    ports: !override
      - "127.0.0.1:${MYSQL_PORT:-4002}:${MYSQL_PORT:-4002}"

  redis:
    ports: !override
      - "127.0.0.1:${REDIS_PORT:-4003}:${REDIS_PORT:-4003}"

  minio:
    ports: !override
      - "127.0.0.1:${S3_PORT:-9000}:9000"
      - "127.0.0.1:${S3_CONSOLE_PORT:-9001}:9001"

  api:
    environment:
      S3_ENDPOINT: "https://${MEDIA_DOMAIN}"
    ports: !override
      - "127.0.0.1:${API_PORT:-4101}:${API_PORT:-4101}"

  web:
    ports: !override
      - "127.0.0.1:${WEB_PORT:-4000}:${WEB_PORT:-4000}"
```

并在 `.env.local` 增加：

```dotenv
MEDIA_DOMAIN=media.example.com
```

Compose 的 `!override` 标签需要较新的 Compose V2。用下列命令确认最终结果中没有 `0.0.0.0` 端口绑定，也不要把展开后的配置保存或上传，因为其中含密钥：

```bash
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml config --quiet
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml config
```

## 8. 配置 Nginx 与 HTTPS

为 `app.example.com` 创建站点配置。SSE 需要关闭代理缓冲并提高读取超时：

```nginx
server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

为 `media.example.com` 创建 MinIO S3 API 代理。上传由浏览器直接执行，必须允许业务所需的最大文件大小并关闭请求缓冲：

```nginx
server {
    listen 80;
    server_name media.example.com;

    client_max_body_size 2g;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }
}
```

启用配置前先检查：

```bash
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

使用受信 ACME 客户端为两个域名申请证书，并配置 HTTP 自动跳转 HTTPS。可参考 [Nginx 官方代理文档](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。证书生效后再次确认 `.env.local` 的 `MEDIA_DOMAIN` 与证书域名完全一致。

浏览器从 `app.example.com` 直传到 `media.example.com` 属于跨域请求，因此还必须在 MinIO 初始化后设置 bucket CORS；具体命令见下一节。

## 9. 构建并启动

先执行不会产生第三方模型费用的静态门禁：

```bash
cd /opt/chat-to-video
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml config --quiet
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml build database-migrate api worker web
```

构建成功后启动基础设施：

```bash
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml up -d mysql redis minio minio-init
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml ps
```

为 bucket 设置只允许真实 Web 域名的 CORS 规则：

```bash
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml \
  run --rm --entrypoint /bin/sh minio-init -c '
    mc alias set local http://minio:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" &&
    mc cors set "local/$S3_BUCKET" -
  ' <<'XML'
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://app.example.com</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
XML
```

把域名替换为真实 Web 域名，并按 [MinIO 官方 CORS 文档](https://docs.min.io/aistor/administration/cors-configuration/) 验证生效。不要使用允许任意来源、任意方法的生产配置。

确认三项基础设施健康后，执行一次数据库迁移：

```bash
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml run --rm database-migrate
```

迁移会修改数据库。每次发布前都应先备份，并阅读本次新增迁移；不要在生产环境使用 ORM 自动同步。

最后启动应用：

```bash
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml up -d api worker web
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml ps
```

Compose 的单机生产用法与覆盖文件模式可参考 [Docker 官方说明](https://docs.docker.com/compose/how-tos/production/)。

## 10. 验收

### 10.1 不产生模型费用的检查

```bash
curl --fail --silent http://127.0.0.1:4101/health
curl --fail --head http://127.0.0.1:4000/
curl --fail --silent http://127.0.0.1:9000/minio/health/live
curl --fail --silent https://app.example.com/
curl --fail --silent https://media.example.com/minio/health/live
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml ps
```

API 健康检查应返回：

```json
{"status":"ok"}
```

再检查最近日志，避免输出完整配置或预签名 URL：

```bash
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml logs --tail=200 api worker web database-migrate
```

### 10.2 业务检查

1. 打开 `https://app.example.com/studio/agent`；
2. 创建普通对话，确认 Web 到 API 的代理正常；
3. 上传一个小型测试图片，确认预签名 URL、HTTPS、MinIO CORS 和对象存在性检查正常；
4. 确认 Worker 已在 Redis 发布能力快照，队列消费者无启动错误；
5. 最后才执行会调用模型或生成视频的付费链路，并预先确认 APIMart 余额和成本上限。

不要把“容器 healthy”当作完整业务验收。API `/health` 当前只返回进程存活状态，不会深度检查 MySQL、Redis、MinIO、Worker 或 APIMart。

## 11. 日常运维

常用命令：

```bash
cd /opt/chat-to-video
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml ps
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml logs -f --tail=200 api worker web
docker stats
df -h
```

停止应用但保留数据卷：

```bash
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml down
```

> [!CAUTION]
> 不要执行 `docker compose down -v`，它会删除 Compose 管理的 MySQL、Redis 和 MinIO 数据卷。也不要在未核实目标和备份的情况下运行 Docker 全局 prune。

建议至少监控：

- 主机 CPU、内存、磁盘、inode 和 Docker daemon；
- API 5xx、SSE 断连、请求延迟；
- BullMQ 等待、运行、失败和超时任务；
- Worker CPU/内存、FFmpeg 超时和临时目录；
- MySQL 连接、慢查询、容量；
- Redis AOF 状态、内存和持久化错误；
- MinIO 容量、对象错误和备份状态；
- APIMart 错误率、限流、用量和余额。

## 12. 备份、恢复与发布

### 12.1 备份原则

MySQL 是业务事实来源，MinIO 保存媒体对象，Redis 保存 BullMQ、Mastra 快照和短期事件；三者必须纳入备份。至少每日异机备份，并定期做真实恢复演练。

发布前：

1. 暂停新流量和新任务；
2. 等待正在执行的 Worker 任务结束，或按业务规则安全取消；
3. 备份 MySQL；
4. 备份 MinIO bucket；
5. 备份 Redis AOF/快照，并验证文件可恢复；
6. 记录当前 Git commit、镜像 ID 和迁移版本。

只备份 Docker volume 目录并不能天然保证跨 MySQL、Redis、MinIO 的一致时间点。生产环境应使用各组件支持的备份方式或托管服务快照，并把备份复制到另一台机器或对象存储账户。

### 12.2 发布更新

```bash
cd /opt/chat-to-video
git fetch --tags
git checkout <NEW_RELEASE_TAG_OR_COMMIT>
git status --short
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml config --quiet
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml build database-migrate api worker web
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml run --rm database-migrate
docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml up -d api worker web
```

随后完整执行第 10 节验收。不要使用 `git pull` 后无版本记录地直接重建。

### 12.3 回滚限制

应用镜像可以回到上一个已知 commit，但数据库迁移未承诺可逆，旧应用也不一定兼容新 schema。若迁移后验收失败，应按发布前验证过的恢复方案处理，而不是直接降级容器并假设兼容。

## 13. 故障排查顺序

1. `docker compose ... ps`：检查健康状态和退出码；
2. `docker compose ... logs --tail=200 <service>`：定位第一个失败服务；
3. `database-migrate` 失败：检查 MySQL 健康、凭据和迁移 SQL；
4. API 启动失败：检查 APIMart、MySQL、Redis、S3 必填变量；
5. Worker 启动失败：检查 APIMart 视频变量、Redis、S3、`/usr/bin/ffmpeg`；
6. 上传失败：检查预签名 URL 的域名、HTTPS、MinIO CORS、Nginx 大小限制和系统时钟；
7. SSE 中断：检查 Nginx `proxy_buffering off` 与 `proxy_read_timeout`；
8. 页面正常但任务不推进：检查 Worker 能力快照、BullMQ 队列和 Redis AOF；
9. 外部模型失败：检查供应商余额、限流、超时和允许的结果域名，不要在日志或工单中粘贴密钥。

## 14. 部署完成清单

- [ ] 使用固定 tag/commit，工作区无临时修改；
- [ ] Compose 配置解析和四个应用镜像构建通过；
- [ ] `.env.local` 权限为 `600`，所有默认密码已替换；
- [ ] 公网仅开放 `22/80/443`，其他服务只绑定回环地址；
- [ ] 两个域名 HTTPS 有效，MinIO 预签名 URL 使用公网域名；
- [ ] MySQL 迁移成功，Redis AOF 已启用，MinIO bucket 已创建；
- [ ] API、Web、MinIO 健康检查通过；
- [ ] 上传、对象检查、SSE 和 Worker 队列链路通过；
- [ ] 付费测试前已确认余额、成本上限和审批边界；
- [ ] 异机备份、恢复演练、监控和告警已落实；
- [ ] 若对公网开放，生产就绪门禁已全部完成。
