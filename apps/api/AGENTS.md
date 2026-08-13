# API Agent Rules

本文件适用于 `apps/api/**`，作为仓库根目录 `AGENTS.md` 的补充。发生冲突时，以更具体且更严格的安全、运行时和资产约束为准。

## Mastra Agent 与 Workflow 实现约束

- `apps/api` 内新增或修改 Agent、Agent Tool/Skill 接入、结构化输出、流式响应适配、Workflow 步骤、暂停/恢复或运行状态管理时，必须优先使用并扩展项目已安装版本的 Mastra 公开 API、原语和现有运行时适配层，不得为方便另建与 Mastra 并行的 Agent/Workflow 编排实现，也不得直接引入同类框架。
- 开始实现前必须先检查已安装 Mastra 版本的内嵌文档、类型定义和项目现有封装，确认现有能力与限制；不得仅凭过时经验判断 Mastra 无法满足需求。
- 只有确认 Mastra 现有公开框架能力无法满足相关需求时，才可以考虑自定义旁路、替代实现或新增同类框架。采取该方案前必须暂停实现，向用户说明具体能力缺口、已核查的 Mastra 方案、拟采用方案及其对架构边界和迁移的影响，并取得用户明确确认；未经确认不得实施。
- 使用 Mastra 不改变既有职责边界：模型调用仍位于 `ModelGateway` 之后，媒体与其他资源密集型任务仍通过 BullMQ 交给 Worker，MySQL 仍是业务事实来源，跨 workspace 协议不得暴露 Mastra 运行时类型，并继续禁止公开 Mastra 原生路由、Studio 或 MCP。

## Mastra Skill 与非 TypeScript 运行时资产

- `src/agent-extensions/skills/**/SKILL.md` 是 NestJS API 的运行时资产，不是仅供开发参考的文档。
- Nest SWC 可能把 JavaScript 输出到 `dist/src/**`，同时把 assets 复制到 `dist/**`。不得假设 `import.meta.dirname/skills` 在源码、开发和生产运行模式下始终存在。
- 修改 Skill 路径、`nest-cli.json`、SWC 配置、输出目录、容器复制规则或启动脚本时，必须同时检查：
  1. 源码执行目录；
  2. Nest 开发模式输出目录；
  3. 生产构建输出目录；
  4. 每个白名单 Skill 的 `SKILL.md` 是否可访问。
- Skill 根目录只能通过显式、有限的候选路径解析。不得改成递归目录扫描、动态 Skill 注册、运行时上传或任意文件系统访问。
- 不得删除 `resolveAgentSkillRoot` 对 Nest SWC 分离输出目录的兼容路径，除非构建配置已经保证编译代码与 Skill 资产同目录，并且同步更新回归测试。
- 新增非 TypeScript 运行时资产时，必须同步更新 `nest-cli.json`、容器/部署复制配置和对应的资产边界测试。
- Skill 资产缺失时必须在启动阶段明确失败；不得静默关闭 Skills、回退为无工具 Agent，或等到用户请求时才暴露缺失。

## 验证要求

- 至少维护源码同目录和 Nest SWC `dist/src` 与 `dist` 分离目录两种路径解析测试。
- 修改相关代码后执行 API workspace 的 `typecheck` 和 `lint`。测试、构建和应用启动仍遵守根目录 `AGENTS.md` 的授权要求。
- 若获得构建授权，必须检查编译入口和全部白名单 `SKILL.md` 的最终产物路径，不能只断言 `nest-cli.json` 中存在 assets 配置。
