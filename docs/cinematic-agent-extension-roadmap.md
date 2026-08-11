# Cinematic Agent 扩展后续路线

> 状态：候选路线，尚未实现。
>
> 本文记录首批迁移之后的可能演进顺序，不表示任何列出的 Skill、Tool、队列或工作流阶段已经可用。首批范围见：[Cinematic Agent 扩展首批迁移计划](./cinematic-agent-extension-first-batch.md)。

## 1. 路线基线

路线以当前固定 `cinematic-production` 工作流为基础，OpenMontage 参考内容固定到提交：

```text
f55180874718faaf40e81efcef0eebefab7ce38b
```

实际能力是否存在必须以本项目源码、测试、配置和基础设施为准。OpenMontage 文件只作为创作方法和能力设计参考，不代表其 Python 运行时或供应商可以直接使用。

## 2. 能力划分原则

### Skill

Skill 负责创作方法、判断框架、阶段检查清单和 Tool 使用说明。Skill 不是真实数据来源，不产生外部副作用，也不能覆盖服务端 Schema 和授权结果。

适合放入 Skill 的内容包括：视觉参考分析方法、镜头设计、提示词编写、连续性检查、剪辑节奏、音频设计和交付审阅。

### Tool

Tool 负责受控查询、确定性计算和严格校验。输入输出必须由 Zod 解析，资源作用域必须来自服务端 RequestContext。

优先开放只读 Tool。任何未来的 mutating 或 paid Tool 都必须具备明确审批、幂等键、审计、超时、失败状态和费用归属，且不能在模型重试时重复执行。

### Workflow / Worker

Workflow 负责有顺序、可暂停、可恢复的业务过程以及人工审批；Worker 负责耗时、付费或资源密集型媒体操作。

FFmpeg、FFprobe、Sharp、素材下载、媒体生成、对象存储写入和队列交接不得因为增加 Agent Tool 而移入同步 API 请求。

## 3. 阶段概览

| 阶段 | 目标 | 主要新增能力 | 前置条件 |
| --- | --- | --- | --- |
| P1 素材理解 | 让 Agent 基于已授权、已探测素材做真实规划 | 参考分析、素材目录、媒体元数据、场景覆盖校验 | 素材授权边界、媒体元数据事实源、`media-probe-jobs` 闭环 |
| P2 生成准备 | 生成可执行且符合模型约束的媒体请求计划 | 视频提示词、视觉连续性、模型比较、批量成本估算 | P1 通过、可信模型能力目录、版本化价格来源 |
| P3 编辑合成 | 将已批准素材转成确定性时间线和渲染输入 | 编辑、音频、合成指导，时间线校验和渲染预设 | P2 通过、安全媒体封装、幂等 `render-jobs` |
| P4 出片交付 | 校验成品并生成可追踪交付物 | 发布/交付审阅、导出规格、成品检查和清单 | P3 通过、正式 compose/publish 协议与授权模型 |

阶段必须按依赖顺序推进。后续阶段可以先编写设计和测试，但不能在前置事实来源、授权和队列闭环缺失时宣称能力已经上线。

## 4. P1：素材理解

### 目标

让 `cinematic-director` 在 assets 和 `scene_plan` 阶段理解项目内真实存在的素材及其技术属性，而不是只依赖用户描述或模型推测。

### 候选 Skills

| 候选 Skill | 目标形态 | OpenMontage 候选来源 | 前置依赖 |
| --- | --- | --- | --- |
| `visual-reference-analyst` | 输出构图、色调、镜头运动、节奏和可复用风格特征 | `skills/meta/video-reference-analyst.md`、`skills/creative/cinematic.md` | 参考素材已授权并有安全元数据 |
| `cinematic-asset-quality` | 说明素材质量、适配性和缺失项的审阅方法 | `skills/pipelines/cinematic/asset-director.md` | 资产清单和媒体探测结果可查询 |
| `cinematic-media-understanding` | 指导 Agent 正确解释视频探测和场景检测结果 | `skills/creative/video-understand-usage.md`、`skills/creative/scene-detect-usage.md` | 稳定、结构化的分析结果 Schema |

### 候选 Tools

| Tool | 行为 | 边界 |
| --- | --- | --- |
| `list_project_assets` | 返回当前项目已授权素材的 ID、类型、对象键别名和安全摘要 | 不返回签名 URL、完整对象路径或其他项目数据 |
| `get_media_metadata` | 返回已持久化的真实 MIME、时长、分辨率、帧率、音轨和探测状态 | Agent 不直接启动 FFprobe/Sharp |
| `validate_scene_plan` | 校验场景时长、模型约束、素材引用和连续性字段 | 纯逻辑、确定性、无外部调用 |
| `check_asset_coverage` | 按场景报告缺失的视频、图片、配音、音乐或音效需求 | 只报告缺口，不自动下载或生成 |

### Workflow / Worker

- 建立或完成 `media-probe-jobs`，由 Worker 使用受控 FFprobe/Sharp 参数处理素材。
- 将探测状态和结果持久化到 MySQL；Agent Tool 只读取已持久化结果。
- 探测任务具备输入大小、时长、超时、并发、幂等和临时目录清理策略。

### P1 验收门槛

1. 所有素材查询均执行租户和项目授权。
2. Agent 无法传入完整文件系统路径或跨项目对象键。
3. 元数据来自持久化探测结果，不由模型推断。
4. `validate_scene_plan` 和 `check_asset_coverage` 对相同输入产生稳定结果。
5. 探测失败、超时和不支持格式均形成可诊断状态，不被当作可用素材。

## 5. P2：生成准备

### 目标

把已批准的脚本、`scene_plan`、视觉参考和模型限制转换成可审核的生成计划，但仍不允许 Agent 在普通工具循环中直接产生付费调用。

### 候选 Skills

| 候选 Skill | 目标形态 | OpenMontage 候选来源 | 前置依赖 |
| --- | --- | --- | --- |
| `cinematic-video-prompting` | 将场景意图转换为结构化视频提示词和负面约束 | `skills/creative/video-gen-prompting.md` | 生成请求 Schema 和模型约束目录 |
| `cinematic-visual-style` | 固化色彩、镜头、灯光、质感和参考素材规则 | `skills/creative/cinematic.md` | P1 视觉参考结果 |
| `cinematic-continuity` | 检查角色、服装、场景、光线、运动方向和镜头衔接 | `skills/pipelines/cinematic/scene-director.md`、`script-director.md` | 稳定的角色和场景标识 |

### 候选 Tools

| Tool | 行为 | 边界 |
| --- | --- | --- |
| `validate_generation_prompt` | 校验提示词长度、必需字段、禁止内容和模型特定约束 | 不调用模型，不修改提示词事实状态 |
| `compare_model_capabilities` | 比较已配置模型的时长、比例、输入类型、可用状态和限制 | 继续位于 `ModelGateway` 能力目录之后 |
| `estimate_generation_batch` | 对整个 `scene_plan` 汇总可追溯费用和预计任务量 | 未配置价格必须返回 unavailable |
| `get_generation_job_status` | 查询当前工作流已持久化的生成任务状态 | 不轮询供应商，不接受任意 job ID |

### Workflow / Worker

- 生成请求由工作流在人工批准和数据库幂等 claim 后创建。
- 付费调用继续在既定 `ModelGateway`/队列边界后执行，不向 Agent 暴露供应商 SDK。
- 队列载荷只传业务 ID、对象键和已验证配置，不传 Base64 或大文件。
- 供应商超时、限流、错误码、重试和用量必须转换为内部统一语义。

### P2 验收门槛

1. 每个生成请求都能追溯到已批准的 `scene_plan` 版本。
2. 模型能力和价格均带配置来源与版本，不散落供应商常量。
3. 模型重试不会重复计费或生成重复结果。
4. Tool 只能提出、校验或查询生成计划；实际创建付费任务必须经过工作流审批和幂等 claim。
5. 未通过 APIMart 工具调用与供应商语义验证的模型不得标记为 available。

## 6. P3：编辑合成

### 目标

将已批准素材和生成结果转换为可由 `@chat-to-video/media` 与 Worker 确定性执行的时间线、音频和渲染配置。

### 候选 Skills

| 候选 Skill | 目标形态 | OpenMontage 候选来源 | 前置依赖 |
| --- | --- | --- | --- |
| `cinematic-editing` | 指导镜头取舍、节奏、转场和连续性 | `skills/creative/video-editing.md`、`skills/pipelines/cinematic/edit-director.md` | 已批准素材和稳定时间线 Schema |
| `cinematic-stitching` | 说明片段衔接、裁剪余量和转场限制 | `skills/creative/video-stitching.md` | 可查询的素材时间码和时长 |
| `cinematic-audio-direction` | 规划对白、配乐、音效、响度和淡入淡出 | OpenMontage audio 目录仅作能力参考 | 音轨 Schema、授权素材和混音能力 |
| `cinematic-compose` | 将编辑决策映射到当前受支持的 FFmpeg 渲染能力 | `skills/pipelines/cinematic/compose-director.md`、`skills/core/ffmpeg.md` | 正式 compose 阶段尚未启用前仅作为候选 |

### 候选 Tools

| Tool | 行为 | 边界 |
| --- | --- | --- |
| `validate_edit_plan` | 校验片段边界、总时长、轨道冲突、转场和素材引用 | 纯逻辑，不执行 FFmpeg |
| `get_render_presets` | 查询代码中受支持的分辨率、帧率、编码器和音频预设 | 预设事实源位于 `@chat-to-video/media` |
| `check_timeline_consistency` | 检查重叠、空洞、越界引用和音视频长度差异 | 输出结构化问题列表 |
| `inspect_render_capability` | 查询当前 Worker/部署是否具备所需受控能力 | 不暴露机器路径或任意命令参数 |

### Workflow / Worker

- 裁剪、拼接、缩放、补帧、字幕、音频混合和最终合成全部通过 Worker 执行。
- FFmpeg/FFprobe 使用受控可执行文件路径和参数数组，业务层不得拼接 Shell。
- `render-jobs` 使用确定性幂等键，重复消费先查询已持久化结果。
- 每个任务使用独立临时目录，并在成功、失败和取消后清理。
- 输出写入私有对象存储，MySQL 只保存对象键和媒体元数据。

### P3 验收门槛

1. 时间线和渲染配置都由共享 Zod Schema 校验。
2. Worker 对成功、失败、取消和重试均保持幂等。
3. 用户或模型文本不能进入 Shell 命令。
4. 媒体任务具备大小、时长、分辨率、超时和并发限制。
5. 媒体测试验证元数据、关键帧或哈希等稳定属性，而不是只检查文件存在。

## 7. P4：出片交付

### 目标

在正式引入 compose/publish 领域阶段后，对成片质量、导出规格、对象存储交付和清理策略进行一致管理。

### 候选 Skills

| 候选 Skill | 目标形态 | OpenMontage 候选来源 | 前置依赖 |
| --- | --- | --- | --- |
| `cinematic-publish` | 根据目标渠道形成导出和交付检查清单 | `skills/pipelines/cinematic/publish-director.md` | contracts 和工作流已增加 publish 阶段 |
| `cinematic-delivery-reviewer` | 审查画面、声音、字幕、时长、品牌和交付完整性 | `skills/meta/reviewer.md`、publish director | 可查询的最终渲染探测结果 |

### 候选 Tools

| Tool | 行为 | 边界 |
| --- | --- | --- |
| `validate_export_profile` | 校验容器、编码、分辨率、帧率、音频和渠道限制 | 纯逻辑，不执行导出 |
| `inspect_render_result` | 返回最终渲染的持久化元数据和质量检查结果 | 不读取任意本地路径 |
| `build_delivery_manifest` | 生成包含业务 ID、对象键别名、版本和校验信息的清单 | 不生成公开 URL，不泄露签名参数 |

### Workflow / Worker

- 导出、缩略图、校验和计算和最终媒体探测由 Worker 执行。
- 下载通过短时效预签名 URL 提供，API 不代理大文件。
- 临时和派生产物通过对象存储生命周期规则及 `cleanup-jobs` 清理。
- 发布到第三方平台属于新的外部集成，必须单独设计授权、撤销、审计和重试语义。

### P4 验收门槛

1. compose/publish 已先在 contracts、Mastra 工作流、数据库状态和 SSE 中正式建模。
2. 导出配置可审查、可版本化，并能回滚到上一个稳定预设。
3. 下载授权经过租户、项目和资源检查，签名 URL 不进入日志或审计详情。
4. 交付失败不会覆盖已成功的渲染结果，并能安全重试。
5. 文档、UI 和 API 不会把尚未接入的发布渠道显示为 available。

## 8. 暂不迁移

以下能力不属于当前首批或上述阶段的默认实现范围：

- OpenMontage 的 Python 模块扫描、动态 Tool 自动发现和运行时 Tool 创建。
- Shell、任意文件系统访问、任意 URL 下载、用户提供可执行路径或未经授权的对象键。
- Agent 在普通工具循环中直接调用付费图片、视频、TTS、音乐或音效模型。
- Agent 绕过 `ModelGateway`、人工审批、MySQL 状态和 BullMQ 直接执行媒体操作。
- HyperFrames、Remotion、HeyGen 及其专用 Skills/Tools；只有架构选型正式变更后才重新评估。
- OpenMontage 的 `idea-director` 和 `executive-producer` 运行角色；其职责与当前 Chat Agent 和固定工作流重叠。
- compose、publish 阶段；在 P3/P4 前置条件完成前，它们只保留为候选设计。
- 通用 Pipeline/Manifest 解释器、管理员控制面、数据库 Skill/Tool CRUD 和用户上传扩展。

## 9. 路线维护规则

- 每项能力进入实施前，重新检查本项目源码、精确依赖版本、现有测试和对应 OpenMontage 来源文件。
- 协议变更先修改 `@chat-to-video/contracts` 的 Zod Schema，再更新 API、Worker、Web 和测试。
- 新增外部依赖、供应商或运行时前，必须先说明现有架构无法满足的具体约束，并更新架构文档。
- 完成某阶段后，才将其状态从“候选路线”改为“已实现”，并附上对应源码、迁移、测试和运行验证证据。
- 本路线的优先级可以根据真实产品需求调整，但不能跳过授权、幂等、审计、队列和安全边界。
