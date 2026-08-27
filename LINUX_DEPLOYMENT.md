# Chat-to-Video Linux 生产部署指南

本文说明如何在与阿里云 OSS Bucket 同地域的 ECS 上，以 Docker Compose 部署 Web、API、Worker、MySQL 和 Redis。生产对象存储使用预先创建的私有 OSS Bucket；本地开发仍使用基础 `compose.yaml` 中的 MinIO。

## 1. 生产拓扑

```text
浏览器 → HTTPS 反向代理 → Next.js Web → NestJS API
                                      ├→ MySQL
                                      ├→ Redis / BullMQ
                                      └→ OSS（内网检查、公网 V4 签名）
                                              ↑
                                     Worker 走内网 Endpoint
```

API 通过 OSS 公网 Endpoint 签发浏览器可访问的 V4 上传/下载 URL，但对象检查和服务端读写使用内网 Endpoint。Worker 全部使用内网 Endpoint。生产覆盖文件会停用 MinIO 服务和 `minio-init` 依赖，不创建 MinIO 数据卷，也不会把 OSS 失败回退到 MinIO。

公网只开放 SSH、HTTP 和 HTTPS。MySQL、Redis、API 仅绑定回环地址。OSS Bucket 保持私有，浏览器只能使用短时效签名 URL。

## 2. 前置条件

- Ubuntu 24.04 LTS 或等价 Linux；
- Docker Engine 与 Docker Compose V2；
- 与目标 OSS Bucket 同地域的 ECS；
- 已备案并解析到服务器的 Web 域名；
- 已预先创建的私有 OSS Bucket；
- 已创建仅允许访问目标 Bucket 受控前缀的 RAM 用户 AccessKey；
- 可用的模型服务配置；
- MySQL、Redis 和 OSS 的备份与恢复方案。

固定部署 Git tag 或 commit，不要直接部署持续变化的分支。部署前在评审环境完成类型检查、Lint、测试与镜像构建。

## 3. 安装 Docker

按 Docker 官方仓库安装 Engine 与 Compose 插件，并确认：

```bash
docker version
docker compose version
```

生产命令统一使用两个 Compose 文件：

```bash
COMPOSE="docker compose --env-file .env.local -f compose.yaml -f compose.production.yaml"
```

`compose.production.yaml` 已受版本控制，不要在服务器上另写同名覆盖文件。

## 4. 创建 OSS Bucket

在与 ECS 相同的 OSS Region 创建全新 Bucket，例如 `oss-cn-hangzhou`。要求：

- ACL 为私有；
- 禁止公共读写；
- 不迁移或挂载本地 MinIO 数据；
- 按业务保留期启用版本控制、生命周期和备份；
- Bucket 名和 Region 与环境配置完全一致。

建议给应用专用 RAM 用户绑定仅覆盖目标 Bucket 命名空间的策略。当前演示命名空间为 `tenant/demo/project/demo/*`，示例策略如下；上线真实多租户前应改为真实授权边界：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:GetObject", "oss:PutObject", "oss:DeleteObject"],
      "Resource": ["acs:oss:*:*:<OSS_BUCKET>/tenant/demo/project/demo/*"]
    }
  ]
}
```

不要给 RAM 用户授予 `oss:*`。创建专用 AccessKey 后，通过部署环境或密钥管理服务注入 API 和 Worker；不要复用主账号 AccessKey，不要把真实凭证提交到 Git、构建参数、镜像、客户端代码或日志。

## 5. 配置 OSS CORS

在 OSS 控制台为 Bucket 配置 CORS：

- 来源：真实 Web Origin，例如 `https://app.example.com`，不得使用 `*`；
- 允许方法：`GET`、`PUT`、`HEAD`；
- 允许请求头：至少 `Content-Type`，以及浏览器实际发送的必要 OSS 签名头；
- 暴露响应头：按前端需要配置 `ETag`；
- 缓存时间：按变更频率设置有限值。

上传签名包含 `Content-Type`，浏览器 PUT 时必须发送与申请签名时完全一致的值，否则 OSS 会拒绝签名。

## 6. 生产环境变量

复制模板并填写真实值：

```bash
cp .env.example .env.local
chmod 600 .env.local
```

对象存储至少配置：

```dotenv
NODE_ENV=production
STORAGE_PROVIDER=aliyun-oss
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=<私有 Bucket 名>
OSS_INTERNAL_ENDPOINT=https://oss-cn-hangzhou-internal.aliyuncs.com
OSS_PUBLIC_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com
OSS_ACCESS_KEY_ID=<专用 RAM 用户 AccessKey ID>
OSS_ACCESS_KEY_SECRET=<专用 RAM 用户 AccessKey Secret>
```

Endpoint 必须与 `OSS_REGION` 匹配。生产公网 Endpoint 必须使用 HTTPS；当前实现只接受标准 `aliyuncs.com` OSS Endpoint，不接受 CDN 或自定义 CNAME。

还需填写数据库、Redis、模型网关和内部认证配置。安全随机值可用：

```bash
openssl rand -hex 32
```

```dotenv
AUTH_ENABLED=true
INTERNAL_ACCESS_PASSWORD=<非空的共享密码，生产环境建议使用强密码>
AUTH_SESSION_SECRET=<至少32字符的随机值>
INTERNAL_API_TOKEN=<另一个至少32字符的随机值>
MYSQL_PASSWORD=<强随机密码>
MYSQL_ROOT_PASSWORD=<强随机密码>
APIMART_API_KEY=<服务端密钥>
```

密码、Token、OSS AccessKey 和签名 URL 不得进入 Git、客户端代码、日志或错误响应。若使用 `.env.local` 注入，必须保持 `chmod 600`，并确保文件不进入镜像构建上下文和备份归档。

## 7. 校验 Compose

在启动前检查最终配置：

```bash
$COMPOSE config --quiet
$COMPOSE config
```

确认：

- API 和 Worker 的 `STORAGE_PROVIDER` 为 `aliyun-oss`；
- 两者接收相同 OSS Region、Bucket、Endpoint 和 AccessKey 配置；
- API/Worker 不再依赖 `minio-init`；
- MinIO 服务带 `local-only` profile，不在生产默认服务集合中；
- MySQL、Redis、API、Web 只绑定 `127.0.0.1`；
- 展开的 Compose 配置只在受控终端检查，不保存、不上传且不写入日志。

## 8. 构建与启动

构建应用镜像：

```bash
$COMPOSE build database-migrate api worker web
```

先启动有状态基础设施，再执行迁移：

```bash
$COMPOSE up -d mysql redis
$COMPOSE run --rm database-migrate
```

确认迁移成功后启动应用：

```bash
$COMPOSE up -d api worker web
$COMPOSE ps
```

不要在生产命令中启用 `local-only` profile；该 profile 只为本地 MinIO 保留。

## 9. HTTPS 反向代理

只将 Web 域名反向代理到 `127.0.0.1:4000`。浏览器业务 API 经 Next.js BFF 转发；`127.0.0.1:4101` 不直接暴露公网。上传和下载由浏览器直接请求 OSS 公网 HTTPS Endpoint，因此无需为 OSS 在本机配置 Nginx 代理。

反向代理需保留流式响应语义，关闭 SSE 路径的代理缓冲，并设置合理的长连接超时。TLS 证书续期应纳入监控。

## 10. 无模型费用的存储验收

验收脚本只创建一个唯一 `temp` 对象，执行 V4 签名上传、Head、服务端读取、签名下载，并在 `finally` 中精确删除该对象。它不调用模型，但会真实写入和删除 OSS，因此必须在 RAM 用户权限、AccessKey 注入、Bucket 和 CORS 配置完成后人工运行：

```bash
STORAGE_CONNECTIVITY_CONFIRM=WRITE_AND_DELETE_TEMP_OBJECT pnpm test:storage:connectivity
```

真实 OSS 验收应在目标 ECS 或等价的受控部署环境执行。脚本不会输出签名 URL、凭证或对象内容；验收结束后确认临时对象已删除，并按组织策略轮换或托管 AccessKey。

随后人工验证：

1. `GET /health` 匿名返回成功；
2. 未登录页面跳转登录页，未登录 BFF 返回 `AUTH_REQUIRED`；
3. 登录后上传小型图片，浏览器 PUT 的 `Content-Type` 与签名一致；
4. API 能经内网 Endpoint 完成 Head，Worker 能读取并写回派生产物；
5. 浏览器下载 URL 使用 OSS 公网 HTTPS Endpoint；
6. Bucket 中没有遗留的 connectivity 临时对象。

## 11. 日常运维与备份

持续监控：

- MySQL 容量、慢查询、备份和恢复演练；
- Redis AOF、BullMQ 积压、Mastra 快照与内存；
- OSS 请求错误、容量、生命周期、版本控制和备份状态；
- OSS AccessKey 有效性、RAM 权限范围与系统时钟；
- API/Worker 错误率、任务失败率和磁盘空间。

MySQL 是业务事实来源，OSS 保存媒体对象，Redis 保存队列、Mastra 快照和短期事件。三者都要备份并定期做恢复演练。仅备份 Docker volume 不包含 OSS，也不能天然提供跨组件一致时间点。

升级流程：

```bash
git fetch --tags
git checkout <已评审的 tag 或 commit>
$COMPOSE config --quiet
$COMPOSE build database-migrate api worker web
$COMPOSE run --rm database-migrate
$COMPOSE up -d api worker web
```

停止应用但保留数据：

```bash
$COMPOSE down
```

不要执行 `docker compose down -v`，不要删除 OSS Bucket，也不要在未确认目标和备份时运行全局 prune。

## 12. 配置轮换

- 共享密码轮换只影响后续登录；
- `AUTH_SESSION_SECRET` 轮换会立即注销全部会话；
- `INTERNAL_API_TOKEN` 轮换需同步重启 Web 与 API；
- OSS AccessKey 轮换时先创建并验证新凭证，再同步更新 API/Worker 配置并滚动重启，确认稳定后禁用旧凭证；
- OSS Region、Bucket 或 Endpoint 不支持热切换、双写或自动回退，变更前必须制定独立迁移方案。

## 13. 故障排查

按顺序检查：

1. `$COMPOSE ps` 和 `$COMPOSE logs --tail=200 api worker web database-migrate`；
2. `STORAGE_PROVIDER` 是否为 `aliyun-oss`，变量是否完整；
3. Endpoint hostname 是否与 Region 一致，公网 Endpoint 是否 HTTPS；
4. `OSS_ACCESS_KEY_ID` 和 `OSS_ACCESS_KEY_SECRET` 是否成对注入且仍然有效；
5. RAM Policy 的 Bucket 和对象前缀是否正确；
6. 上传失败时检查 OSS CORS、浏览器 Origin、系统时钟和 `Content-Type`；
7. 服务端可读但浏览器不可用时检查公网 Endpoint，浏览器可上传但 Worker 不可读时检查内网 Endpoint与 RAM 权限。

应用错误会统一脱敏，不会返回供应商凭证、Endpoint 签名细节或原始 OSS 错误。诊断供应商问题应在受控运维环境查看脱敏后的服务日志与阿里云审计记录。

官方参考：

- [使用 Node.js SDK V4 签名 URL 上传对象](https://help.aliyun.com/en/oss/developer-reference/upload-objects-using-a-signed-url-generated-with-oss-sdk-for-node-js)
- [Node.js SDK 配置访问凭证](https://help.aliyun.com/en/oss/node-js-configure-access-credentials)
