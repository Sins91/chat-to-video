# Config Agent Rules

本文件适用于 `packages/config/**`，补充 `packages/AGENTS.md` 与仓库根目录的总体架构原则。

- 本包只保存跨 workspace 通用的 TypeScript、ESLint 和工程配置，不放业务常量、供应商模型名、队列行为、密钥或应用专属环境变量。
- 配置变更必须评估 Web 的 Bundler 解析与服务端 ESM/NodeNext 差异，不得把 Node-only 配置或运行时依赖泄露到浏览器构建。
- 保持 `strict` 和 `noUncheckedIndexedAccess` 基线；不得通过全局关闭规则来解决单个 workspace 的局部问题。
- 修改共享配置时检查所有消费者的继承关系与兼容性，并将应用专属例外保留在对应 workspace。
