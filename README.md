# Chat-to-Video

基于 Next.js、NestJS、Mastra、AI SDK、BullMQ、Drizzle、FFmpeg 和 MinIO 的对话式视频生成平台。

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

Mastra Agent 与可暂停工作流只位于 `apps/api` 内部；媒体任务仍由独立 BullMQ Worker 执行。

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

AI SDK 的 API 变化频繁。使用以下命令搜索当前锁定版本随包发布的文档，避免依赖过期示例：

```powershell
pnpm sdk:docs:ai -- "ToolLoopAgent"
```

搜索结果会显示实际安装版本以及匹配文档的文件、行号和内容。

## LLM 纯文本聊天 Agent

API 通过内部 `ModelGateway`、Mastra Agent 和 `@ai-sdk/openai-compatible` 调用 OpenAI 兼容的文本模型。当前 `LLM_PROVIDER` 默认是 `apimart`，聊天、分镜和创作 Agent 使用 `APIMART_CHAT_MODEL`；DeepSeek 直连入口及其环境变量继续保留，仅在显式设置 `LLM_PROVIDER=deepseek` 时启用。APIMart 的账户余额和视频生成链路不受该开关影响。纯文本聊天不调用 BullMQ 或 Worker，也不保存会话。Web 仅保留创作中心，根路径会跳转到 `/studio`；`/studio/agent` 子页面通过 `/api/chat` BFF 消费该接口。页面只保留对话输入：普通内容进入聊天 Agent，只有“生成/制作视频”“把内容做成短片”等明确执行意图才创建视频工作流；咨询、脚本、文案、创意和分镜讨论继续作为普通聊天。

如需验证聊天 Agent，复制 `.env.example` 为根目录 `.env.local`，填写 `APIMART_API_KEY`，并按账号实际可用模型调整 `APIMART_CHAT_MODEL`。聊天总超时由 `APIMART_TIMEOUT_MS` 或 `DEEPSEEK_TIMEOUT_MS` 控制，默认值为 `600000` 毫秒（10 分钟）；分镜超时继续由独立变量控制。只有需要启用保留的 DeepSeek 直连入口时，才设置 `LLM_PROVIDER=deepseek` 并填写 `DEEPSEEK_API_KEY`。API 在开发和生产启动时默认读取该文件；由操作系统或部署平台注入的环境变量优先。可使用以下命令同时启动 API 和 Web：

对话页右上角通过 NestJS API 查询 APIMart 账户级余额；Web 只能读取经过共享 Schema 校验的余额快照，不会接触 `APIMART_API_KEY`。余额查询使用同一服务端密钥，无需新增环境变量。

```powershell
Copy-Item .env.example .env.local # 首次运行时执行，然后填写 APIMART_API_KEY
pnpm dev:chat
```

该命令会先构建 API 所依赖的 `contracts`、`database` 和 `storage` 共享包，再并行运行 API 与 Web，避免开发进程加载过期的 `dist`；共享依赖构建失败时不会启动 watcher。按一次 `Ctrl+C` 即可停止。启动脚本优先使用进程环境变量，再读取仓库根目录 `.env.local`，最后才使用代码默认值；Web 显式使用 `WEB_PORT`，API 使用 `API_PORT`。按示例配置时浏览器访问 <http://localhost:4000/studio/agent>。`POST /chat-agent/messages` 的成功响应是 AI SDK UI Message SSE。

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

## 电影化视频生产工作流

`/studio/agent` 在对话内容明确表达视频生成意图后进入可恢复的电影化生产流程：用户输入框不单独展示时长控件；用户可在对话中明确指定 4–300 秒成片总时长，未指定时由 API 内部的无工具时长决策 Agent 根据最近对话上下文判断；`cinematic-director` 依次生成创作研究、创意方案、脚本、场景和素材规划，并把超出 Seedance 单次 15 秒上限的内容拆成连续镜头。在分镜审核点，用户还可逐镜头设置最终成片秒数；不符合供应商档位的时长会向上圆整到 Seedance 支持的 4–15 秒整数档，页面同时展示成片时长与模型生成档位并要求再次确认，Worker 生成后按成片时长裁切。用户在各审核点确认或提出修改后，API 才会生成剪辑决策并把视频任务写入 `render-jobs`。独立 Worker 沿用逐场景生成、对象存储缓存和 FFmpeg 拼接方案完成长视频。Web 通过 SSE 恢复进度并在右栏播放结果；对话区底部根据持久化步骤事件展示完整进度条和当前中文提示，覆盖需求理解、各创作审核阶段、逐镜头生成、合成与保存，旧事件则从工作流快照回退恢复。普通聊天仅在等待首个流式响应时显示临时“理解需求”提示，不写入聊天历史。每个渲染周期从视频任务入队起最多运行 12 小时；API 同时写入独立的 `cleanup-jobs` 延迟看门狗，到期后原子标记任务和工作流失败、发布 `job.failed`，并清理已生成的场景片段及最终对象。

首次运行前复制 `.env.example` 为 `.env.local` 并填写 `APIMART_API_KEY`。使用 Docker Compose 启动时，`database-migrate` 一次性服务会在 MySQL 健康后应用尚未执行的 Drizzle 迁移；只有迁移成功后 API 和 Worker 才会启动。

不使用 Docker Compose 时，需显式执行数据库迁移：

```powershell
pnpm --filter @chat-to-video/database db:migrate
```

如需为历史侧栏添加简要演示数据，可在迁移完成后执行以下幂等种子命令。它会为“今天、昨天、过去 7 天、更早”各写入一条简单的一问一答，不创建视频工作流；重复执行会更新同一组固定记录：

```powershell
pnpm db:seed:history
```

## 对话历史

`/studio/agent` 使用 URL 中的 `conversationId` 恢复会话。普通聊天消息、视频创作提示和历次分镜均持久化到 MySQL；同一会话可以依次创建多个视频工作流，详情和 SSE 跟随最近一次工作流，但在已有工作流仍处于分镜、排队或生成状态时不会并发创建。历史栏删除为软删除，不会取消仍在执行的任务，也不会删除 MinIO 中的媒体产物。首次消息会自动创建会话，空白“新对话”不会提前写入数据库。

新增环境部署必须应用 `packages/database/migrations` 中的全部增量迁移；`0003_conversation_video_workflows.sql` 会将会话与视频工作流从一对一调整为一对多。当前 Demo 仍由 API 固定使用 `tenant/demo/project/demo`，客户端不能指定租户或项目。

Docker Compose 已包含 MySQL、数据库迁移、Redis、MinIO、API、Worker 和 Web。详细协议、状态机、配置和 Demo 安全边界见 [`docs/两步式视频工作流.md`](docs/两步式视频工作流.md)。

## Cinematic Agent 扩展

API 内的 `chat-default` 与 `cinematic-director` 已接入首批 Mastra Skills 和四个白名单只读 Tools：`get_agent_capabilities`、`get_video_model_constraints`、`get_cinematic_context`、`estimate_cinematic_cost`。两个 Agent 均先加载适配自 OpenMontage 的 `cinematic-governance` 全局治理 Skill；`cinematic-director` 再按当前 `scene_plan` 等阶段加载对应 Skill 与 reviewer。媒体计算和付费视频生成仍只通过现有 `cinematic-production` 工作流、BullMQ 与 `render-jobs` 执行；治理边界详见 [`docs/cinematic-agent-governance.md`](./docs/cinematic-agent-governance.md)。

Cinematic 素材阶段现已采用双审批：第一次确认素材规划后，API 按能力注册表将 Seedream 图片、Sharp 标题卡、视频镜头和 FlowMusic 音乐分别交给 `image-jobs`、`render-jobs` 与 `agent-jobs`；Worker 将对象键、适配器和任务状态持久化到 MySQL。全部素材完成后进入第二次人工审批，批准后创建新的 Mastra continuation run 生成剪辑方案并入队最终合成。最终 FFmpeg 合成只消费已批准对象键，并对音乐执行循环、增益与淡入淡出处理。

APIMart 真实 Tool Calling 冒烟门禁尚未在本次变更中执行；验证 Chat Completions、工具循环、结构化输出、流式转换、取消/超时/限流/usage 语义前，不得以默认开启状态部署。

服务端通过 `LLM_TOOL_CALLING_ENABLED=true|false` 控制 Skills/Tools 可见性。Agent 每次请求最多执行 8 步，Tool 串行调用；请求作用域来自服务端 `RequestContext`，执行结果写入审计表并复用现有 `agent.step` SSE。关闭开关时 Agent 不获得这些 Skills/Tools；网关不支持 Tool Calling 时返回明确错误，不静默降级。

来源、改编范围和 AGPLv3 处理见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。实现计划见 [首批迁移计划](./docs/cinematic-agent-extension-first-batch.md)，候选能力见 [后续路线](./docs/cinematic-agent-extension-roadmap.md)。

## License

本项目采用 [GNU Affero General Public License v3.0](./LICENSE)。第三方归属见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
