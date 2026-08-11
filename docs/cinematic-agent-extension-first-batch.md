# Cinematic Agent 扩展首批迁移计划

> 状态：首批代码已实现（2026-08-11）。实际可用性仍以源码、迁移、配置和部署环境为准；测试与构建尚未在本次变更中运行，APIMart 真实 Tool Calling 冒烟门禁仍待执行，未通过前不得以默认开启状态部署。
>
> 本文描述 OpenMontage Agent 扩展能力在本项目中的首批迁移边界。判断实际实现状态时，仍以源码、测试和运行配置为准。

## 1. 目标与来源

首批迁移在现有 `cinematic-production` 固定工作流内，为 Chat Agent 和 `cinematic-director` 增加按需加载的 Skills、受控只读 Tools、能力发现和执行审计。现有工作流阶段、人工审阅、MySQL 事实状态、BullMQ 队列和 Worker 媒体执行边界保持不变。

迁移内容来源于 OpenMontage，固定基线提交为：

```text
f55180874718faaf40e81efcef0eebefab7ce38b
```

迁移采用“保留创作方法、重写运行时集成”的方式：可适用的导演和审阅说明迁移为 Mastra filesystem skills；OpenMontage 的 Python 工具发现和执行机制不进入本项目。

## 2. 架构边界

首批实现必须遵循以下边界：

- Mastra 仅运行在 NestJS API 内，不公开 Mastra 原生路由、Studio、MCP 或远程运行时。
- 所有模型调用继续经过内部 `ModelGateway`，Agent 不直接感知 APIMart 的密钥、模型 URL 或供应商协议。
- MySQL 继续作为业务事实来源；Redis 只承载 Mastra 快照、Streams、BullMQ、锁和短期状态。
- Agent Tools 首批全部为只读查询或确定性校验，不生成媒体、不写业务状态、不入队、不产生外部付费调用。
- `render-jobs` 和 Worker 继续承担视频生成、FFmpeg、Sharp 等耗时或有副作用的媒体任务。
- 跨 Web、API、Worker 的数据仍通过 `@chat-to-video/contracts` 定义和校验，不暴露 Mastra 内部类型。
- 不增加通用 Pipeline/Manifest 解释器、管理员控制面或运行时扩展上传能力。

## 3. 首批 Skills

Skills 使用 Mastra 原生 filesystem skill 机制，作为 API 构建资产随产物发布。每次 Agent 调用仅加载显式白名单允许的技能。

| Skill ID | 可见范围 | 作用 | OpenMontage 候选来源 |
| --- | --- | --- | --- |
| `cinematic-research` | `cinematic-director` / research | 将用户目标、参考信息和约束整理为可验证研究结论 | `skills/pipelines/cinematic/research-director.md` |
| `cinematic-proposal` | `cinematic-director` / proposal | 形成创意方向、叙事结构、视觉策略和风险说明 | `skills/pipelines/cinematic/proposal-director.md` |
| `cinematic-script` | `cinematic-director` / script | 编写与已批准提案一致、可继续拆镜的脚本 | `skills/pipelines/cinematic/script-director.md` |
| `cinematic-scene-plan` | `cinematic-director` / `scene_plan` | 将脚本拆分为受模型时长和素材约束限制的场景计划 | `skills/pipelines/cinematic/scene-director.md` |
| `cinematic-assets` | `cinematic-director` / assets | 建立素材需求和来源清单，不直接获取或生成素材 | `skills/pipelines/cinematic/asset-director.md` |
| `cinematic-edit` | `cinematic-director` / edit | 形成可由确定性媒体层消费的剪辑决策 | `skills/pipelines/cinematic/edit-director.md` |
| `cinematic-reviewer` | `cinematic-director` / 全阶段 | 在同一次生成内执行阶段检查清单 | `skills/meta/reviewer.md` |
| `cinematic-capabilities` | Chat Agent | 说明当前 cinematic 流程、已配置能力和限制 | 上述阶段技能的精简整合，不复制执行逻辑 |

移植时必须删除或改写以下内容：

- OpenMontage 本地目录、项目文件、Backlot 和 Python 命令引用。
- 当前项目不存在的供应商、渲染器、compose/publish 阶段和自动执行承诺。
- 允许模型绕过 Mastra 工作流、人工审批、`ModelGateway` 或 BullMQ 的说明。
- 将未经校验的模型文本直接作为对象键、命令参数或持久化数据的做法。

`cinematic-reviewer` 不创建单独 Reviewer Agent，也不触发第二次模型调用。Agent 在同一次生成中依据检查清单自检，服务端仍以共享 Zod Schema 和确定性业务规则作为最终边界。

## 4. 首批只读 Tools

所有 Tool 输入和输出使用严格 Zod Schema，拒绝额外字段。Tool 只能从服务端 RequestContext 获取租户、项目、会话或工作流作用域，不能信任模型传入这些标识。

### 4.1 `get_agent_capabilities`

用途：让 Chat Agent 和 `cinematic-director` 查询当前真实可用的能力，而不是根据提示词猜测。

输入：

```ts
{
  capability?: string;
}
```

输出：

```ts
{
  capabilities: Array<{
    id: string;
    description: string;
    status: "available" | "disabled" | "unconfigured";
    provider: string | null;
    risk: "read_only" | "mutating" | "paid";
    relatedSkillIds: string[];
  }>;
}
```

输出不得包含密钥、内部连接信息、签名 URL、供应商响应原文或运行时安装入口。

### 4.2 `get_video_model_constraints`

用途：查询共享 contracts 和服务端配置中已经支持的视频模型约束。

输入：

```ts
{
  model?: VideoModel;
}
```

输出至少包含模型标识、允许时长、最大时长、支持状态和当前渲染器约束。模型枚举和时长规则必须从共享 Schema 或同一事实来源派生，不能在 Tool 中复制另一套常量。

### 4.3 `get_cinematic_context`

用途：让 `cinematic-director` 在生成前确认持久化的当前阶段和已批准上游产物。

输入为空的严格对象：

```ts
{}
```

`workflowId`、租户和项目必须从服务端 RequestContext 获取。输出只包含当前阶段、已批准产物的受限摘要、版本和必要引用，不返回未批准草稿、完整敏感输入或跨项目数据。

该 Tool 只向 `cinematic-director` 开放；Chat Agent 和 Storyboard Agent 不可见。

### 4.4 `estimate_cinematic_cost`

用途：对受支持的视频模型和场景时长执行可追溯的批次成本估算。

输入：

```ts
{
  model: VideoModel;
  durationsSeconds: number[];
}
```

输出：

```ts
{
  status: "estimated" | "unavailable";
  amountUsd: number | null;
  pricingSource: string | null;
  pricingVersion: string | null;
  reason: "pricing_not_configured" | null;
}
```

只有与当前模型精确匹配、经过人工审核并带来源版本的价格才可用于估算。没有可信价格时必须返回 `pricing_not_configured`，不得让模型猜测或套用其他模型价格。

## 5. Agent 可见范围

| Agent | Skills | Tools | 保持不变的行为 |
| --- | --- | --- | --- |
| Chat Agent | `cinematic-capabilities` | 能力、模型约束、成本估算 | 继续使用现有 AI SDK UI Message Stream 和取消信号 |
| `cinematic-director` | 当前阶段 Skill + `cinematic-reviewer` | 能力、模型约束、cinematic 上下文、成本估算 | 继续按阶段返回共享结构化产物 |
| Storyboard Agent | 无新增 Skill | 无新增 Tool | 保持当前结构化输出和有限修复逻辑 |

Skills 和 Tools 使用代码白名单动态解析，不提供数据库 CRUD、管理 API、管理页面或目录扫描式自动注册。

## 6. RequestContext 与运行规则

服务端为每次 Agent 调用创建并校验内部 RequestContext：

```ts
{
  requestId: string;
  agentId: "chat-default" | "cinematic-director" | "storyboard-agent";
  conversationId?: string;
  workflowId?: string;
  stage?: CinematicStage;
  tenantId: string;
  projectId: string;
}
```

运行规则：

- 客户端和模型不能直接构造或覆盖 RequestContext。
- Chat Agent 和 `cinematic-director` 每次运行最多执行 8 个模型步骤。
- Agent、processor 和底层模型的隐式重试均保持为零。
- 现有结构化输出校验失败后最多进行一次显式修复；首批 Tools 为只读，因此修复不得重复媒体生成、队列写入或计费。
- 新增 `LLM_TOOL_CALLING_ENABLED` 配置，默认值为 `true`。关闭时不向 Agent 提供 Skills 和 Tools，用作紧急回滚。
- 如果当前 APIMart Chat Completions、配置模型或流式转换不支持工具循环，返回可诊断的 `AGENT_TOOL_CALLING_UNSUPPORTED`，不静默执行无工具降级。

## 7. 审计、SSE 与幂等

计划新增 Drizzle 表 `agent_extension_executions`，通过新迁移创建，不修改历史迁移。至少记录：

- `requestId`、可选 `workflowId`/`conversationId`、Agent ID 和 cinematic 阶段。
- 扩展类型 `skill | tool`、扩展 ID、attempt 和 activity sequence。
- 由 `requestId + attempt + sequence` 形成的唯一调用键。
- `running | completed | failed` 状态、开始时间、完成时间和耗时。
- 可选估算费用、脱敏错误码和截断后的安全摘要。

审计记录不得保存完整提示词、完整产物、用户敏感内容、Token、Cookie、对象存储签名 URL 或工具原始结果。

Mastra 原生 `skill`、`skill_search` 和 `skill_read` 调用归类为 Skill 活动，其余注册工具归类为 Tool 活动。Cinematic 工作流继续复用现有 `agent.step.data.toolActivity` SSE 契约，不新增事件类型；确定性事件 ID 保持可重放和幂等。

## 8. APIMart 发布门禁

APIMart 官方资料记录了 OpenAI 兼容能力，以及 Responses API 的 function calling 支持：

- [APIMart Features](https://docs.apimart.ai/en/faqs/features)
- [APIMart Responses API](https://docs.apimart.ai/en/api-reference/texts/openai/responses)

本项目当前使用的 Chat Completions、配置模型和 AI SDK/Mastra 流式转换仍必须通过真实冒烟验证。上线默认开启工具能力前，至少验证：

- 流式 function calling 和工具结果回传。
- 工具执行后的结构化输出。
- 取消、超时、限流、错误码和 usage 语义。
- Tool call 数据经过现有 APIMart 响应转换后没有丢失。

未通过门禁时不得部署默认开启的工具能力，也不得伪装成工具已经执行。

## 9. OpenMontage 许可处理

首批计划直接改编 OpenMontage 的 AGPLv3 内容，因此实施迁移时需要同步完成：

- 仓库根目录增加 GNU AGPLv3 许可证。
- 增加第三方声明，记录 OpenMontage、固定提交、原文件路径和修改说明。
- 在移植的 Skill 文件中保留 SPDX 标识、来源提交和“已修改”说明。
- 在公开网络部署前提供符合 AGPLv3 要求的对应源码获取方式；当前计划不假定该入口已经存在。

这些项目均属于迁移实施内容，本文档本身不代表许可证文件、声明或源码入口已经完成。

## 10. 测试与验收

实施时需要维护以下测试，但除非获得明确授权，不运行测试、构建、应用或外部服务：

- Skill 构建资产、路径解析、阶段白名单和缺失资产失败行为。
- Tool 严格 Schema、额外字段拒绝、能力菜单脱敏和输出大小限制。
- RequestContext 防止模型指定租户、项目或其他 workflow ID。
- 模型约束由共享 contracts 派生，不出现重复事实源。
- 成本估算覆盖可信价格和 `pricing_not_configured` 两条路径。
- Chat 流式工具循环、取消和工具协议错误映射。
- `cinematic-director` 调用 Skill/Tool 后仍返回合法的阶段产物。
- Storyboard Agent 行为不变。
- 审计开始、成功、失败和重复事件幂等。
- 查询工具不会写产物、入队、调用媒体进程或产生外部费用。

首批验收条件：

1. Chat 和 `cinematic-director` 只能看到各自白名单内的 Skills 和 Tools。
2. `cinematic-director` 只能访问当前工作流及已批准的上游产物。
3. 任何未知价格均明确返回不可估算，而不是猜价。
4. 工具协议不兼容时产生明确错误，没有静默降级。
5. 现有 `cinematic-production` 阶段、人工审批和 `render-jobs` 入队行为没有改变。
6. 没有引入 Shell、任意文件访问、MCP、动态 Python 工具或管理员控制面。

## 11. 首批不包含的能力

- 图片、视频、配音、音乐或音效生成 Tool。
- Agent 直接执行 FFmpeg、FFprobe、Sharp 或 Worker 任务。
- 外部素材搜索、任意 URL 下载和动态供应商安装。
- HyperFrames、Remotion、HeyGen 或其他未纳入当前架构基线的运行时。
- compose、publish 新工作流阶段。
- Skill/Tool 管理 API、数据库 CRUD、管理页面或运行时上传。
- 通用 OpenMontage Pipeline/Manifest 解释器。

后续候选能力、依赖顺序和阶段门禁见：[Cinematic Agent 扩展后续路线](./cinematic-agent-extension-roadmap.md)。
