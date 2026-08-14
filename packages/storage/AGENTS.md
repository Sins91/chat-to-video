# Storage Agent Rules

本文件适用于 `packages/storage/**`，补充 `packages/AGENTS.md` 与仓库根目录的总体架构原则。

- 本包只暴露与供应商无关的 S3/MinIO 对象存储接口、对象键构造和预签名 URL 能力；业务代码不得耦合具体 SDK。
- 对象键必须由受控 ID 构造并遵循 `tenant/{tenantId}/project/{projectId}/{source|derived|render|temp}/...`，禁止接受客户端、模型或队列传入的任意完整路径。
- 对象访问必须保留租户、项目和资源范围校验所需信息。Bucket 默认私有，上传下载 URL 短时有效，不记录或持久化签名 URL。
- API 不通过本包代理大文件；Worker 以流或受控临时文件读取对象，任务载荷只传对象键和元数据。
- 删除和清理接口必须支持幂等、精确目标和生命周期策略；未经明确授权不得执行生产对象删除或宽泛前缀清理。
- 外部存储错误返回受控错误类型，日志不得包含密钥、Token、Cookie、签名查询参数或敏感对象内容。
