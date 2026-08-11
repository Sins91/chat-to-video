# API Agent Rules

本文件适用于 `apps/api/**`，作为仓库根目录 `AGENTS.md` 的补充。发生冲突时，以更具体且更严格的安全、运行时和资产约束为准。

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
