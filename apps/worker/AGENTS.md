# Worker Agent Rules

本文件适用于 `apps/worker/**`，补充 `apps/AGENTS.md` 与仓库根目录的总体架构原则。

## Worker 职责与队列边界

- Worker 只承载 BullMQ 异步任务、Agent 后台长任务和媒体计算，不暴露面向浏览器的在线 API。
- 队列按资源特征隔离为 `agent-jobs`、`image-jobs`、`media-probe-jobs`、`render-jobs` 和 `cleanup-jobs`。新增或合并队列时必须显式保留各自的并发、超时、重试、资源标签、失败处理和幂等策略。
- 队列载荷从 `unknown` 开始，以 `@chat-to-video/contracts` 的共享 Schema 解析；只接受 ID、对象键和已验证配置，不接受 Base64、大文件、任意文件系统路径或 Provider 密钥。
- 每个任务必须有稳定幂等键，并遵守 `queued -> running -> succeeded | failed | cancelled` 状态机。重试、超时与取消不得重复生成产物、覆盖已生效终态或重复计费。
- Worker 只通过 `@chat-to-video/database` 持久化任务事实，通过 `@chat-to-video/storage` 访问对象，通过 `@chat-to-video/media` 执行媒体操作；不得散落原始数据库连接、S3 SDK 调用或 Shell 命令。
- Worker 完成或失败时先以条件事务写入 MySQL 事实和可补发事件，再由 API/Director continuation 消费；Worker 不直接恢复 Mastra run，也不自行宣告工作流完成。

## 媒体与外部服务安全

- 上传素材和 Provider 结果须校验大小、真实 MIME、扩展名及媒体探测结果；供应商临时 URL 的内容先复制到私有对象存储，数据库只保存对象键和元数据。
- FFmpeg、FFprobe 和其他进程必须经 `@chat-to-video/media` 的受控可执行路径与参数数组调用，禁止把用户或模型文本拼入 Shell 命令。
- 媒体任务限制输入大小、时长、分辨率、执行时间和并发数；每个任务使用独立临时目录，并在成功、失败和取消后可靠清理。
- Sharp 用于静态图层预处理，FFmpeg 用于视频滤镜和逐帧合成；不得在业务处理器中复制两者的安全封装。
- 捕获必要的进程诊断和进度，但限制日志长度并脱敏密钥、Token、Cookie、签名 URL 和敏感内容。
- 单元测试使用小型确定性媒体 fixture，并验证元数据、关键帧或哈希等稳定属性，避免只断言文件存在；外部 Provider、Redis、数据库、存储和媒体进程使用接口替身。
