# Database Agent Rules

本文件适用于 `packages/database/**`，补充 `packages/AGENTS.md` 与仓库根目录的总体架构原则。

- 本包统一封装 Drizzle Schema、迁移和数据访问；应用不得绕过 repository/transaction API 散落原始连接和重复查询。
- MySQL 是用户、项目、会话、消息、工作流、Agent 动作、产物和任务状态的业务事实来源；Redis snapshot、Stream、缓存或锁不得取代可审计事实。
- 数据库结构变更必须同时更新 Drizzle Schema 和新增可审查迁移；不得手写修改已应用的历史迁移，生产环境不得使用 ORM 自动同步。
- 审批、Worker 完成、恢复触发器、Director cycle、动作 claim 和任务终态使用事务、条件更新、唯一约束或版本 CAS 原子处理；重试不得覆盖已生效终态或重复产生副作用。
- 时间线采用“可查询元数据 + JSON 快照 + 版本号”；更新使用版本字段或乐观锁，避免静默覆盖。
- 数据库只保存对象键、哈希、MIME、大小、时长等元数据，不保存媒体二进制、Base64、密钥或签名 URL。
- 管线通用 repository 必须从共享管线定义派生，不得维护 cinematic 专属阶段顺序、别名或分支；测试使用阶段集合或顺序不同的第二管线夹具证明扩展性。
- 迁移和 repository 测试覆盖升级路径、约束、并发/幂等条件与关键失败路径；未经用户明确授权不得执行真实迁移、重建数据库或种子写入。
