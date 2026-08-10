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
  workflow/  Workflow SDK 长时编排骨架（首个可执行流程位于 API）
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

## SDK 版本匹配文档

AI SDK 与 Workflow SDK 的 API 变化频繁。使用以下命令搜索当前锁定版本随包发布的文档，避免依赖过期示例：

```powershell
pnpm sdk:docs:ai -- "ToolLoopAgent"
pnpm sdk:docs:workflow -- "createHook"
```

搜索结果会显示实际安装版本以及匹配文档的文件、行号和内容。Workflow 包的常规 `typecheck` 还会执行 SDK 类型契约检查，用于尽早发现依赖升级造成的 API 或类型推导变化。

## APIMart 纯文本聊天 Agent

API 通过内部 `ModelGateway` 和 `@ai-sdk/openai-compatible` 适配 APIMart 的 OpenAI 兼容 Chat Completions。当前 API 闭环只支持无工具的纯文本多轮聊天；不生成图片或视频，不调用 Workflow、BullMQ、Worker，也不保存会话。Web 仅保留创作中心，根路径会跳转到 `/studio`；`/studio/agent` 子页面保留聊天 Agent，并通过 `/api/chat` BFF 消费该接口。

如需验证聊天 Agent，复制 `.env.example` 为根目录 `.env.local`，填写 `APIMART_API_KEY`，并按 APIMart 账号实际可用模型调整 `APIMART_CHAT_MODEL`。API 在开发和生产启动时默认读取该文件；由操作系统或部署平台注入的环境变量优先。可使用以下命令同时启动 API 和 Web：

```powershell
Copy-Item .env.example .env.local # 首次运行时执行，然后填写 APIMART_API_KEY
pnpm dev:chat
```

该命令并行运行两个 workspace，按一次 `Ctrl+C` 即可停止。启动脚本优先使用进程环境变量，再读取仓库根目录 `.env.local`，最后才使用代码默认值；Web 显式使用 `WEB_PORT`，API 使用 `API_PORT`。按示例配置时浏览器访问 <http://localhost:4000/studio/agent>。`POST /chat-agent/messages` 的成功响应是 AI SDK UI Message SSE。

需要临时切换配置时，通过 `ENV_FILE` 指定仓库根目录下的其他 `.env` 文件；文件名必须以 `.env` 开头，指定的文件不存在时启动会直接失败：

```powershell
$env:ENV_FILE = ".env.test"
pnpm dev:chat
Remove-Item Env:ENV_FILE
```

单独执行各 workspace 的 `pnpm --filter <workspace> start` 时，会先运行该 workspace 的完整 `build`（包括所需共享包），再启动生产服务。Web 的 `dev` 或 `start` 仍使用 `WEB_PORT`。除 `/studio/agent` 外的创作中心页面使用本地 mock 数据；聊天 Agent 需要可访问的 API，未配置 `API_BASE_URL` 时默认连接 `http://localhost:4101`。

这是 APIMart 纯文本流式兼容性的最小验证，不代表工具调用、结构化输出、限流、重试、计费或生产部署已经完成验证。

## Docker Compose

在仓库根目录构建并启动 MySQL、Redis、MinIO、API、Worker 与 Web：

```powershell
docker compose --env-file .env.local up --build
```

Docker Compose 的 `--build` 会先完成 API、Worker、Web 及其共享包的镜像构建，再启动容器。

启动完成后可访问：

- Web：<http://localhost:4000>
- API 健康检查：<http://localhost:4101/health>
- MySQL：`localhost:4002`
- Redis：`localhost:4003`

Web、API、MySQL 和 Redis 的容器监听端口、宿主机映射端口、服务间连接地址及健康检查统一读取传给 Compose 的 `WEB_PORT`、`API_PORT`、`MYSQL_PORT` 和 `REDIS_PORT`。修改端口后不需要同步修改 Compose 内的其他地址。MySQL 与 Redis 数据分别保存在 Compose 命名卷 `mysql_data` 和 `redis_data` 中。停止并移除容器：

```powershell
docker compose down
```

## 两步式视频生成工作流

`/studio/agent` 现在使用可恢复的两步流程：Agent 先将创意整理为结构化的 10 秒分镜；用户确认或提出修改后，API 才会将视频任务写入 `render-jobs`。独立 Worker 调用 APIMart Seedance 2.0、轮询异步任务，并把成片复制到私有 MinIO Bucket。Web 通过 SSE 恢复进度并在右栏播放结果。

首次运行前复制 `.env.example` 为 `.env.local` 并填写 `APIMART_API_KEY`。使用 Docker Compose 启动时，`database-migrate` 一次性服务会在 MySQL 健康后应用尚未执行的 Drizzle 迁移；只有迁移成功后 API 和 Worker 才会启动。

不使用 Docker Compose 时，需显式执行数据库迁移：

```powershell
pnpm --filter @chat-to-video/database db:migrate
```

Docker Compose 已包含 MySQL、数据库迁移、Redis、MinIO、API、Worker 和 Web。详细协议、状态机、配置和 Demo 安全边界见 [`docs/两步式视频工作流.md`](docs/两步式视频工作流.md)。
