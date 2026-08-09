# Chat-to-Video

基于 Next.js、NestJS、Vercel AI SDK、BullMQ、Drizzle、FFmpeg 和 MinIO 的对话式视频生成平台。

## 工程结构

```text
apps/
  web/       Next.js 前端
  api/       NestJS 在线 API
  worker/    BullMQ 异步媒体与 Agent Worker
packages/
  contracts/ 跨应用 Zod 协议与 DTO
  database/  Drizzle Schema、查询和迁移
  storage/   S3/MinIO 存储适配
  media/     FFmpeg、FFprobe、Sharp 媒体能力
  config/    共享工程配置
infra/
  docker/    本地基础设施编排
  ffmpeg/    FFmpeg 镜像和预设
tests/
  e2e/       跨服务端到端测试
docs/        架构与项目文档
```

当前提交只建立工程骨架和依赖清单，不包含依赖安装产物。

## 包管理器

本项目只允许使用 pnpm，不支持 npm 或 yarn。根目录与所有 workspace 均配置了安装前校验；使用其他包管理器安装会直接失败。

```powershell
corepack enable
pnpm install
```

国内网络环境可使用带镜像自动选择和官方源兜底的安装命令：

```powershell
pnpm deps:install:cn
```

镜像优先级、参数传递方式和限制见 [`docs/国内镜像源.md`](docs/国内镜像源.md)。

## Docker Compose

在仓库根目录构建并启动 MySQL、Redis、API 与 Web：

```powershell
docker compose up --build
```

启动完成后可访问：

- Web：<http://localhost:4000>
- API 健康检查：<http://localhost:4001/health>
- MySQL：`localhost:4002`
- Redis：`localhost:4003`

宿主机端口可通过 `.env` 中的 `WEB_PORT`、`API_PORT`、`MYSQL_PORT` 和 `REDIS_PORT` 覆盖。容器内部端口固定为 Web `3000`、API `3001`、MySQL `3306`、Redis `6379`。MySQL 与 Redis 数据分别保存在 Compose 命名卷 `mysql_data` 和 `redis_data` 中。停止并移除容器：

```powershell
docker compose down
```
