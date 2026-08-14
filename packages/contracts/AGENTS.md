# Contracts Agent Rules

本文件适用于 `packages/contracts/**`，补充 `packages/AGENTS.md` 与仓库根目录的总体架构原则。

- 本包是 Web、API 与 Worker 跨边界 Zod Schema、DTO、队列载荷、SSE 事件和管线定义协议的唯一事实源；不得承载业务执行、数据库访问、Mastra、AI SDK 或供应商运行时。
- 协议先定义 Zod Schema，再以 `z.infer` 推导并导出 TypeScript 类型；不得手写与 Schema 近似的接口或联合类型。
- 所有跨边界 Schema 和类型必须从 `src/index.ts` 公共入口导出；消费者不得深路径导入。
- 队列载荷只允许 ID、对象键和已验证配置，不允许 Base64、大文件、密钥、完整文件系统路径或 Mastra 运行时对象。
- SSE 事件至少包含 `eventId`、`requestId`、`type`、`timestamp` 和 `data`；事件类型、游标和快照协议须保持可恢复语义。
- 管线 ID、阶段顺序、标签、别名以及可暂停、可重启等元数据只声明一次，并让所有消费者从同一注册表派生；不得新增应用专属的平行枚举或解析表。
- 对已有协议优先保持向后兼容。破坏性变更必须说明迁移策略、版本影响和回滚方式，并同步更新全部生产者、消费者及测试。
- 协议测试至少覆盖合法输入、边界输入和拒绝路径；通用管线协议还须包含阶段集合或顺序不同的第二管线夹具。
