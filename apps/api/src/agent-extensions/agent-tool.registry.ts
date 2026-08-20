import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  CinematicArtifactSchema,
  CinematicGenerativeStageSchema,
  CINEMATIC_PIPELINE_DEFINITION,
  CinematicStageSchema,
  VIDEO_MODEL_DURATION_OPTIONS,
  VideoModelSchema,
  getVideoModelMaxDurationSeconds,
  type CinematicArtifact,
  type CinematicGenerativeStage,
  type VideoModel,
  WorkflowCapabilitySnapshotSchema,
  WORKFLOW_CAPABILITY_SNAPSHOT_KEY,
  type CinematicStage,
  type WorkflowToolId,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import {
  selectImageProvider,
  selectTtsProvider,
  selectVideoProvider,
  type ProviderSelection,
} from "@chat-to-video/tools";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { Redis } from "ioredis";

import { createObservedRedisClient } from "../redis-client.js";
import { VIDEO_WORKFLOW_REPOSITORY } from "../video-workflow/video-workflow.tokens.js";
import {
  AgentExtensionRequestContextSchema,
  CinematicAgentRequestContextSchema,
} from "./agent-extension.context.js";
import {
  ALL_CINEMATIC_SKILL_IDS,
  CHAT_CAPABILITIES_SKILL_ID,
  CINEMATIC_REVIEWER_SKILL_ID,
  CINEMATIC_STAGE_SKILL_IDS,
} from "./agent-skill.catalog.js";
import {
  RESEARCH_TOOL_GATEWAY,
  type ResearchToolGateway,
} from "./research-tool-gateway.js";
import type { PromptCompressionRuntime } from "./prompt-compression.tool.js";
import {
  EstimateCinematicCostInputSchema,
  EstimateCinematicCostOutputSchema,
  estimateCinematicCost,
} from "./cinematic-pricing.js";

export {
  EstimateCinematicCostInputSchema,
  EstimateCinematicCostOutputSchema,
  estimateCinematicCost,
} from "./cinematic-pricing.js";

const CapabilityStatusSchema = z.enum([
  "available",
  "disabled",
  "unconfigured",
]);
const CapabilityRiskSchema = z.enum(["read_only", "mutating", "paid"]);

export const AgentCapabilitySchema = z.object({
  id: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(500),
  status: CapabilityStatusSchema,
  provider: z.string().trim().min(1).max(100).nullable(),
  risk: CapabilityRiskSchema,
  relatedSkillIds: z.array(z.string().trim().min(1).max(100)).max(20),
  adapterId: z.string().trim().min(1).max(100).nullable().optional(),
  executionBoundary: z.string().trim().min(1).max(100).nullable().optional(),
}).strict();

export const GetAgentCapabilitiesInputSchema = z.object({
  capability: z.string().trim().min(1).max(100).optional(),
}).strict();

export const GetAgentCapabilitiesOutputSchema = z.object({
  capabilities: z.array(AgentCapabilitySchema).max(20),
}).strict();

const WorkflowToolStatusSchema = z.enum(["available", "unconfigured", "unavailable"]);
const WorkflowToolSchema = z.object({
  id: z.string().trim().min(1).max(100),
  stages: z.array(CinematicStageSchema).min(1).max(10),
  requirement: z.enum(["required", "optional"]),
  status: WorkflowToolStatusSchema,
  executionBoundary: z.enum(["api_readonly", "agent_job", "image_job", "render_job", "media_probe_job"]),
  adapterId: z.string().trim().min(1).max(100).nullable(),
  provider: z.string().trim().min(1).max(100).nullable(),
  reason: z.string().trim().min(1).max(500).nullable(),
}).strict();

export const GetWorkflowToolsInputSchema = z.object({
  stage: CinematicStageSchema.optional(),
}).strict();
export const GetWorkflowToolsOutputSchema = z.object({
  tools: z.array(WorkflowToolSchema).max(100),
}).strict();

export const SearchWebInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  count: z.number().int().min(1).max(20).default(8),
  freshness: z.enum(["day", "week", "month", "year"]).optional(),
}).strict();
export const SearchWebOutputSchema = z.object({
  provider: z.literal("apimart"),
  query: z.string(),
  results: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    description: z.string(),
    age: z.string().nullable(),
  }).strict()).max(20),
}).strict();

const SelectProviderInputSchema = z.object({
  preferredProvider: z.string().trim().min(1).max(100).optional(),
}).strict();
const SelectProviderOutputSchema = z.object({
  status: z.enum(["selected", "unavailable"]),
  selected: z.object({ id: z.string(), provider: z.string() }).strict().nullable(),
  alternatives: z.array(z.object({ id: z.string(), provider: z.string() }).strict()),
  score: z.number().min(0).max(1).nullable(),
  reason: z.string().nullable(),
}).strict();

type ToolRuntime = {
  executionBoundary: "api_readonly" | "agent_job" | "image_job" | "render_job" | "media_probe_job";
  adapterId: string | null;
  provider: string | null;
  status: "available" | "unconfigured" | "unavailable";
  reason: string | null;
};

const TOOL_CAPABILITIES: Partial<Record<WorkflowToolId, string>> = {
  image_generator: "image.generate",
  video_generator: "video.generate",
  music_generator: "music.generate",
  title_card: "image.render.title-card",
  video_compose: "video.compose.ffmpeg",
  audio_mixer: "audio.mix",
  audio_probe: "video.probe",
};

const API_TOOL_RUNTIMES: Partial<Record<WorkflowToolId, ToolRuntime>> = {
  web_search: { executionBoundary: "api_readonly", adapterId: "apimart.responses-web-search", provider: "apimart", status: "available", reason: null },
  prompt_compressor: { executionBoundary: "api_readonly", adapterId: "mastra.prompt-compressor", provider: "model-gateway", status: "available", reason: null },
  image_selector: { executionBoundary: "api_readonly", adapterId: "tools.image-selector", provider: "local", status: "available", reason: null },
  video_selector: { executionBoundary: "api_readonly", adapterId: "tools.video-selector", provider: "local", status: "available", reason: null },
  tts_selector: { executionBoundary: "api_readonly", adapterId: "tools.tts-selector", provider: "local", status: "available", reason: null },
};

const UNCONNECTED_TOOL_RUNTIME: ToolRuntime = {
  executionBoundary: "media_probe_job",
  adapterId: null,
  provider: "local",
  status: "unconfigured",
  reason: "Tool is registered for the stage but has no queue consumer or artifact handoff yet.",
};

const VideoModelConstraintSchema = z.object({
  model: VideoModelSchema,
  durationOptionsSeconds: z.array(z.number().int().positive()).min(1).max(20),
  maxDurationSeconds: z.number().int().positive(),
  rendererFamily: z.literal("ffmpeg"),
  status: z.literal("available"),
}).strict();

export const GetVideoModelConstraintsInputSchema = z.object({
  model: VideoModelSchema.optional(),
}).strict();

export const GetVideoModelConstraintsOutputSchema = z.object({
  models: z.array(VideoModelConstraintSchema).min(1).max(10),
}).strict();

const CinematicContextArtifactSchema = z.object({
  stage: CinematicGenerativeStageSchema,
  version: z.number().int().positive(),
  summary: z.string().trim().min(1).max(1_000),
}).strict();

export const GetCinematicContextInputSchema = z.object({}).strict();
export const GetCinematicContextOutputSchema = z.object({
  workflowId: z.string().uuid(),
  stage: CinematicGenerativeStageSchema,
  status: z.string().trim().min(1).max(32),
  currentVersion: z.number().int().nonnegative(),
  approvedArtifacts: z.array(CinematicContextArtifactSchema).max(6),
}).strict();

const CAPABILITIES = Object.freeze([
  {
    id: "cinematic.workflow",
    description: "固定的 cinematic-production 创作、审核与 render-jobs 交接流程。",
    status: "available",
    provider: null,
    risk: "read_only",
    relatedSkillIds: [...ALL_CINEMATIC_SKILL_IDS],
  },
  {
    id: "agent.tool-calling",
    description: "通过 ModelGateway 执行白名单内的只读 Agent Tools。",
    status: "available",
    provider: "model-gateway",
    risk: "read_only",
    relatedSkillIds: [CHAT_CAPABILITIES_SKILL_ID, CINEMATIC_REVIEWER_SKILL_ID],
  },
  {
    id: "prompt.compress",
    description: "仅在生产提示词超过共享协议字符上限时，通过专用无工具 Agent 进行语义压缩。",
    status: "available",
    provider: "model-gateway",
    risk: "paid",
    relatedSkillIds: [CINEMATIC_REVIEWER_SKILL_ID],
    adapterId: "mastra.prompt-compressor",
    executionBoundary: "api_readonly",
  },
  {
    id: "video.model-constraints",
    description: "查询共享 contracts 中支持的视频模型时长和 FFmpeg 渲染约束。",
    status: "available",
    provider: "apimart",
    risk: "read_only",
    relatedSkillIds: [
      CINEMATIC_STAGE_SKILL_IDS.scene_plan,
      CINEMATIC_STAGE_SKILL_IDS.assets,
      CINEMATIC_STAGE_SKILL_IDS.edit,
    ],
  },
  {
    id: "cinematic.cost-estimation",
    description: "仅使用经过审核且版本化的价格执行成本估算；缺少价格时明确返回 unavailable。",
    status: "available",
    provider: null,
    risk: "read_only",
    relatedSkillIds: [
      CINEMATIC_STAGE_SKILL_IDS.proposal,
      CINEMATIC_STAGE_SKILL_IDS.assets,
    ],
  },
] as const);

export const listAgentCapabilities = (filter?: string) => {
  const normalized = filter?.trim().toLocaleLowerCase("en-US");
  const capabilities = normalized
    ? CAPABILITIES.filter((capability) =>
        capability.id.toLocaleLowerCase("en-US").includes(normalized) ||
        capability.description.toLocaleLowerCase("zh-CN").includes(normalized)
      )
    : CAPABILITIES;
  return GetAgentCapabilitiesOutputSchema.parse({ capabilities });
};

export const getVideoModelConstraints = (model?: VideoModel) => {
  const models = VideoModelSchema.options
    .filter((candidate) => model === undefined || candidate === model)
    .map((candidate) => ({
      model: candidate,
      durationOptionsSeconds: [...VIDEO_MODEL_DURATION_OPTIONS[candidate]],
      maxDurationSeconds: getVideoModelMaxDurationSeconds(candidate),
      rendererFamily: "ffmpeg" as const,
      status: "available" as const,
    }));
  return GetVideoModelConstraintsOutputSchema.parse({ models });
};

const summarizeArtifact = (artifact: CinematicArtifact): string => {
  switch (artifact.stage) {
    case "research":
      return artifact.data.summary;
    case "proposal": {
      const recommendation = artifact.data.directions.find(
        (direction) => direction.id === artifact.data.recommendedDirectionId,
      );
      return `推荐方向：${recommendation?.title ?? artifact.data.recommendedDirectionId}；交付承诺：${artifact.data.deliveryPromise}`;
    }
    case "script":
      return `脚本《${artifact.data.title}》，${artifact.data.durationSeconds} 秒，共 ${artifact.data.beats.length} 个节拍。`;
    case "scene_plan":
      return `${artifact.data.aspectRatio} 场景计划，${artifact.data.durationSeconds} 秒，共 ${artifact.data.scenes.length} 个场景。`;
    case "consistency_reference":
      return artifact.data.status === "required"
        ? `一致性参考图需要 ${artifact.data.groups.length} 个连续性分组。`
        : `一致性参考图不需要：${artifact.data.reason}`;
    case "assets":
      return `素材计划共 ${artifact.data.assets.length} 项，幻灯片风险 ${artifact.data.slideshowRisk}/10，记录估算成本 ${artifact.data.totalEstimatedCostUsd} USD。`;
    case "edit":
      return `FFmpeg 剪辑计划，${artifact.data.durationSeconds} 秒，共 ${artifact.data.timeline.length} 个时间线片段。`;
  }
};

const stageIndex = (stage: CinematicGenerativeStage): number =>
  CinematicGenerativeStageSchema.options.indexOf(stage);

@Injectable()
export class AgentToolRegistry implements OnModuleDestroy {
  private capabilityRedis?: Redis;

  private async listRuntimeCapabilities(filter?: string) {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return listAgentCapabilities(filter);
    this.capabilityRedis ??= createObservedRedisClient(
      redisUrl,
      AgentToolRegistry.name,
      "api-agent-capabilities",
      {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      },
    );
    let runtime: ReturnType<typeof listAgentCapabilities>["capabilities"] = [];
    try {
      if (this.capabilityRedis.status === "wait") await this.capabilityRedis.connect();
      const raw = await this.capabilityRedis.get(WORKFLOW_CAPABILITY_SNAPSHOT_KEY);
      if (raw) {
        const snapshot = WorkflowCapabilitySnapshotSchema.safeParse(JSON.parse(raw) as unknown);
        if (snapshot.success) {
          runtime = snapshot.data.resolutions.map((resolution) => ({
            id: resolution.capabilityId,
            description: resolution.reason ?? `由 ${resolution.adapterId ?? "未配置适配器"} 提供。`,
            status: resolution.status === "available"
              ? "available" as const
              : resolution.status === "unconfigured"
                ? "unconfigured" as const
                : "disabled" as const,
            provider: resolution.provider,
            risk: resolution.capabilityId === "video.probe"
              ? "read_only" as const
              : resolution.provider === "local"
                ? "mutating" as const
                : "paid" as const,
            relatedSkillIds: [CHAT_CAPABILITIES_SKILL_ID, CINEMATIC_REVIEWER_SKILL_ID],
            adapterId: resolution.adapterId,
            executionBoundary: resolution.executionBoundary,
          }));
        }
      }
    } catch {
      runtime = [];
    }
    const combined = [...listAgentCapabilities().capabilities, ...runtime];
    const normalized = filter?.trim().toLocaleLowerCase("en-US");
    return GetAgentCapabilitiesOutputSchema.parse({
      capabilities: normalized
        ? combined.filter((capability) =>
            capability.id.toLocaleLowerCase("en-US").includes(normalized) ||
            capability.description.toLocaleLowerCase("zh-CN").includes(normalized)
          )
        : combined,
    });
  }

  private async listRuntimeToolResolutions() {
    const redisUrl = process.env.REDIS_URL?.trim();
    if (!redisUrl) return [];
    this.capabilityRedis ??= createObservedRedisClient(
      redisUrl,
      AgentToolRegistry.name,
      "api-agent-capabilities",
      {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      },
    );
    try {
      if (this.capabilityRedis.status === "wait") await this.capabilityRedis.connect();
      const raw = await this.capabilityRedis.get(WORKFLOW_CAPABILITY_SNAPSHOT_KEY);
      if (!raw) return [];
      const snapshot = WorkflowCapabilitySnapshotSchema.safeParse(JSON.parse(raw) as unknown);
      return snapshot.success ? snapshot.data.tools : [];
    } catch {
      return [];
    }
  }

  private async listWorkflowTools(stage?: CinematicStage) {
    const [capabilities, runtimeTools] = await Promise.all([
      this.listRuntimeCapabilities(),
      this.listRuntimeToolResolutions(),
    ]);
    const capabilityById = new Map(capabilities.capabilities.map((capability) => [capability.id, capability]));
    const runtimeToolById = new Map(runtimeTools.map((toolResolution) => [toolResolution.toolId, toolResolution]));
    const registrations = new Map<WorkflowToolId, { stages: CinematicStage[]; requirement: "required" | "optional" }>();
    for (const definition of CINEMATIC_PIPELINE_DEFINITION.stages) {
      if (stage && definition.id !== stage) continue;
      for (const requirement of ["required", "optional"] as const) {
        for (const toolId of definition.tools[requirement]) {
          const current = registrations.get(toolId);
          if (current) {
            if (!current.stages.includes(definition.id)) current.stages.push(definition.id);
            if (requirement === "required") current.requirement = "required";
          } else {
            registrations.set(toolId, { stages: [definition.id], requirement });
          }
        }
      }
    }
    const tools = [...registrations.entries()].map(([id, registration]) => {
      const apiRuntime = API_TOOL_RUNTIMES[id];
      const workerRuntime = runtimeToolById.get(id);
      const capabilityId = TOOL_CAPABILITIES[id];
      const capability = capabilityId ? capabilityById.get(capabilityId) : undefined;
      const runtime: ToolRuntime = apiRuntime ?? (workerRuntime ? {
        executionBoundary: workerRuntime.executionBoundary,
        adapterId: workerRuntime.adapterId,
        provider: workerRuntime.provider,
        status: workerRuntime.status,
        reason: workerRuntime.reason,
      } : capability ? {
        executionBoundary: WorkflowToolSchema.shape.executionBoundary.parse(
          capability.executionBoundary ?? "media_probe_job",
        ),
        adapterId: capability.adapterId ?? null,
        provider: capability.provider,
        status: capability.status === "disabled" ? "unavailable" : capability.status,
        reason: capability.description,
      } : UNCONNECTED_TOOL_RUNTIME);
      return { id, ...registration, ...runtime };
    });
    return GetWorkflowToolsOutputSchema.parse({ tools });
  }

  private async selectProvider(
    kind: "image" | "video" | "tts",
    preferredProvider?: string,
  ) {
    const capabilities = await this.listRuntimeCapabilities();
    const capabilityId = kind === "image"
      ? "image.generate"
      : kind === "video"
        ? "video.generate"
        : "audio.speech";
    const candidates = capabilities.capabilities
      .filter((capability) => capability.id === capabilityId)
      .map((capability) => ({
        id: capability.adapterId ?? capability.id,
        provider: capability.provider ?? "unknown",
        status: capability.status === "available" ? "available" as const : "unconfigured" as const,
        operations: [kind === "image" ? "generate_image" : kind === "video" ? "text_to_video" : "text_to_speech"],
        qualityScore: 0.8,
        costScore: 0.5,
        latencyScore: 0.5,
      }));
    let selection: ProviderSelection;
    try {
      const input = { candidates, preferredProvider };
      selection = kind === "image"
        ? selectImageProvider(input)
        : kind === "video"
          ? selectVideoProvider(input)
          : selectTtsProvider(input);
    } catch {
      return SelectProviderOutputSchema.parse({
        status: "unavailable",
        selected: null,
        alternatives: [],
        score: null,
        reason: `No available ${kind} provider is registered.`,
      });
    }
    return SelectProviderOutputSchema.parse({
      status: "selected",
      selected: { id: selection.selected.id, provider: selection.selected.provider },
      alternatives: selection.alternatives.map((candidate) => ({ id: candidate.id, provider: candidate.provider })),
      score: selection.score,
      reason: null,
    });
  }

  readonly getWorkflowTools = createTool({
    id: "get_workflow_tools",
    description: "按 cinematic 阶段查询统一注册的 Tool、真实可用状态和执行边界。",
    strict: true,
    requireApproval: false,
    inputSchema: GetWorkflowToolsInputSchema,
    outputSchema: GetWorkflowToolsOutputSchema,
    requestContextSchema: AgentExtensionRequestContextSchema,
    execute: ({ stage }) => this.listWorkflowTools(stage),
  });

  readonly searchWeb = createTool({
    id: "web_search",
    description: "通过 APIMart 内置 Web Search 获取带来源 URL 的 research 参考资料。",
    strict: true,
    requireApproval: false,
    inputSchema: SearchWebInputSchema,
    outputSchema: SearchWebOutputSchema,
    requestContextSchema: CinematicAgentRequestContextSchema,
    execute: (input) => this.researchToolGateway.searchWeb(input),
  });

  readonly imageSelector = createTool({
    id: "image_selector",
    description: "从当前 Worker capability snapshot 中选择可用图像生成适配器。",
    strict: true,
    requireApproval: false,
    inputSchema: SelectProviderInputSchema,
    outputSchema: SelectProviderOutputSchema,
    requestContextSchema: CinematicAgentRequestContextSchema,
    execute: ({ preferredProvider }) => this.selectProvider("image", preferredProvider),
  });

  readonly videoSelector = createTool({
    id: "video_selector",
    description: "从当前 Worker capability snapshot 中选择可用视频生成适配器。",
    strict: true,
    requireApproval: false,
    inputSchema: SelectProviderInputSchema,
    outputSchema: SelectProviderOutputSchema,
    requestContextSchema: CinematicAgentRequestContextSchema,
    execute: ({ preferredProvider }) => this.selectProvider("video", preferredProvider),
  });

  readonly ttsSelector = createTool({
    id: "tts_selector",
    description: "查询并选择已实际注册的 TTS 执行适配器；没有执行边界时明确返回 unavailable。",
    strict: true,
    requireApproval: false,
    inputSchema: SelectProviderInputSchema,
    outputSchema: SelectProviderOutputSchema,
    requestContextSchema: CinematicAgentRequestContextSchema,
    execute: ({ preferredProvider }) => this.selectProvider("tts", preferredProvider),
  });

  readonly getAgentCapabilities = createTool({
    id: "get_agent_capabilities",
    description: "查询当前服务端实际注册的 cinematic Agent 能力、状态、风险和关联技能。",
    strict: true,
    requireApproval: false,
    inputSchema: GetAgentCapabilitiesInputSchema,
    outputSchema: GetAgentCapabilitiesOutputSchema,
    requestContextSchema: AgentExtensionRequestContextSchema,
    execute: ({ capability }) => this.listRuntimeCapabilities(capability),
  });

  readonly getVideoModelConstraints = createTool({
    id: "get_video_model_constraints",
    description: "查询当前共享协议支持的视频模型时长档位、单场景上限和渲染器。",
    strict: true,
    requireApproval: false,
    inputSchema: GetVideoModelConstraintsInputSchema,
    outputSchema: GetVideoModelConstraintsOutputSchema,
    requestContextSchema: AgentExtensionRequestContextSchema,
    execute: ({ model }) => Promise.resolve(getVideoModelConstraints(model)),
  });

  readonly estimateCinematicCost = createTool({
    id: "estimate_cinematic_cost",
    description: "使用经过审核且版本化的 APIMart 价格估算视频秒数、2K 图片和音乐生成成本；没有可信价格时返回 unavailable。",
    strict: true,
    requireApproval: false,
    inputSchema: EstimateCinematicCostInputSchema,
    outputSchema: EstimateCinematicCostOutputSchema,
    requestContextSchema: AgentExtensionRequestContextSchema,
    execute: (input) => Promise.resolve(estimateCinematicCost(input)),
  });

  readonly getCinematicContext = createTool({
    id: "get_cinematic_context",
    description: "查询当前服务端作用域内 cinematic 工作流的阶段和已批准上游产物摘要。",
    strict: true,
    requireApproval: false,
    inputSchema: GetCinematicContextInputSchema,
    outputSchema: GetCinematicContextOutputSchema,
    requestContextSchema: CinematicAgentRequestContextSchema,
    execute: async (_input, context) => {
      const requestContext = CinematicAgentRequestContextSchema.parse(
        context?.requestContext?.all,
      );
      const workflow = await this.repository.findScopedWorkflow(
        requestContext.workflowId,
        requestContext.tenantId,
        requestContext.projectId,
      );
      if (!workflow) throw new Error("Scoped cinematic workflow was not found.");
      if (workflow.currentStageId !== requestContext.stage) {
        throw new Error("Cinematic request context does not match persisted workflow stage.");
      }
      const rows = await this.repository.listCinematicArtifacts(
        requestContext.workflowId,
      );
      const latestByStage = new Map<
        CinematicGenerativeStage,
        { artifact: CinematicArtifact; version: number }
      >();
      for (const row of rows) {
        const artifact = CinematicArtifactSchema.parse(row.artifact);
        latestByStage.set(artifact.stage, { artifact, version: row.version });
      }
      const approvedArtifacts = [...latestByStage.values()]
        .filter(({ artifact }) =>
          stageIndex(artifact.stage) < stageIndex(requestContext.stage)
        )
        .sort((left, right) =>
          stageIndex(left.artifact.stage) - stageIndex(right.artifact.stage)
        )
        .map(({ artifact, version }) => ({
          stage: artifact.stage,
          version,
          summary: summarizeArtifact(artifact).slice(0, 1_000),
        }));
      return GetCinematicContextOutputSchema.parse({
        workflowId: workflow.id,
        stage: requestContext.stage,
        status: workflow.status,
        currentVersion: workflow.currentVersion,
        approvedArtifacts,
      });
    },
  });

  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY)
    private readonly repository: VideoWorkflowRepository,
    @Inject(RESEARCH_TOOL_GATEWAY)
    private readonly researchToolGateway: ResearchToolGateway,
  ) {}

  forChat() {
    return {
      get_agent_capabilities: this.getAgentCapabilities,
      get_workflow_tools: this.getWorkflowTools,
      get_video_model_constraints: this.getVideoModelConstraints,
      estimate_cinematic_cost: this.estimateCinematicCost,
    };
  }

  forStoryboard(promptCompressor: PromptCompressionRuntime["tool"]) {
    return { prompt_compressor: promptCompressor };
  }

  forCinematic(
    stage: CinematicGenerativeStage,
    promptCompressor?: PromptCompressionRuntime["tool"],
  ) {
    const common = {
      get_agent_capabilities: this.getAgentCapabilities,
      get_workflow_tools: this.getWorkflowTools,
      get_video_model_constraints: this.getVideoModelConstraints,
      get_cinematic_context: this.getCinematicContext,
      estimate_cinematic_cost: this.estimateCinematicCost,
      ...(promptCompressor && CINEMATIC_PIPELINE_DEFINITION.stages
          .find((definition) => definition.id === stage)
          ?.tools.optional.includes("prompt_compressor")
        ? { prompt_compressor: promptCompressor }
        : {}),
    };
    if (stage === "research") return { ...common, web_search: this.searchWeb };
    if (stage === "proposal" || stage === "assets") {
      return {
        ...common,
        tts_selector: this.ttsSelector,
        image_selector: this.imageSelector,
        video_selector: this.videoSelector,
      };
    }
    return common;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.capabilityRedis && this.capabilityRedis.status !== "end") {
      await this.capabilityRedis.quit();
    }
  }
}
