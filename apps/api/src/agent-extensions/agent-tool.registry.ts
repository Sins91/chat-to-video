import { Inject, Injectable } from "@nestjs/common";
import {
  CinematicArtifactSchema,
  CinematicGenerativeStageSchema,
  VIDEO_MODEL_DURATION_OPTIONS,
  VideoModelSchema,
  getVideoModelMaxDurationSeconds,
  roundVideoModelDurationSeconds,
  type CinematicArtifact,
  type CinematicGenerativeStage,
  type VideoModel,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

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
}).strict();

export const GetAgentCapabilitiesInputSchema = z.object({
  capability: z.string().trim().min(1).max(100).optional(),
}).strict();

export const GetAgentCapabilitiesOutputSchema = z.object({
  capabilities: z.array(AgentCapabilitySchema).max(20),
}).strict();

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

export const EstimateCinematicCostInputSchema = z.object({
  model: VideoModelSchema,
  durationsSeconds: z.array(z.number().int().positive()).min(1).max(60),
}).strict().superRefine((input, context) => {
  const maximum = getVideoModelMaxDurationSeconds(input.model);
  input.durationsSeconds.forEach((duration, index) => {
    if (duration > maximum) {
      context.addIssue({
        code: "custom",
        message: `Scene duration exceeds the ${maximum} second model limit.`,
        path: ["durationsSeconds", index],
      });
    }
  });
});

export const EstimateCinematicCostOutputSchema = z.object({
  status: z.enum(["estimated", "unavailable"]),
  amountUsd: z.number().min(0).max(1_000_000).nullable(),
  pricingSource: z.string().trim().min(1).max(500).nullable(),
  pricingVersion: z.string().trim().min(1).max(100).nullable(),
  reason: z.literal("pricing_not_configured").nullable(),
}).strict();

type CinematicPrice = {
  readonly usdPerGeneratedSecond: number;
  readonly source: string;
  readonly version: string;
};

export type CinematicPricingCatalog = Partial<
  Readonly<Record<VideoModel, CinematicPrice>>
>;

const REVIEWED_PRICING: CinematicPricingCatalog = Object.freeze({});

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

export const estimateCinematicCost = (
  input: z.infer<typeof EstimateCinematicCostInputSchema>,
  pricing: CinematicPricingCatalog = REVIEWED_PRICING,
) => {
  const parsed = EstimateCinematicCostInputSchema.parse(input);
  const price = pricing[parsed.model];
  if (!price) {
    return EstimateCinematicCostOutputSchema.parse({
      status: "unavailable",
      amountUsd: null,
      pricingSource: null,
      pricingVersion: null,
      reason: "pricing_not_configured",
    });
  }
  const generatedSeconds = parsed.durationsSeconds.reduce(
    (total, duration) =>
      total + roundVideoModelDurationSeconds(parsed.model, duration),
    0,
  );
  return EstimateCinematicCostOutputSchema.parse({
    status: "estimated",
    amountUsd: Number(
      (generatedSeconds * price.usdPerGeneratedSecond).toFixed(6),
    ),
    pricingSource: price.source,
    pricingVersion: price.version,
    reason: null,
  });
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
    case "assets":
      return `素材计划共 ${artifact.data.assets.length} 项，幻灯片风险 ${artifact.data.slideshowRisk}/10，记录估算成本 ${artifact.data.totalEstimatedCostUsd} USD。`;
    case "edit":
      return `FFmpeg 剪辑计划，${artifact.data.durationSeconds} 秒，共 ${artifact.data.timeline.length} 个时间线片段。`;
  }
};

const stageIndex = (stage: CinematicGenerativeStage): number =>
  CinematicGenerativeStageSchema.options.indexOf(stage);

@Injectable()
export class AgentToolRegistry {
  readonly getAgentCapabilities = createTool({
    id: "get_agent_capabilities",
    description: "查询当前服务端实际注册的 cinematic Agent 能力、状态、风险和关联技能。",
    strict: true,
    requireApproval: false,
    inputSchema: GetAgentCapabilitiesInputSchema,
    outputSchema: GetAgentCapabilitiesOutputSchema,
    requestContextSchema: AgentExtensionRequestContextSchema,
    execute: ({ capability }) => Promise.resolve(listAgentCapabilities(capability)),
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
    description: "使用经过审核且版本化的价格估算 cinematic 场景批次成本；没有可信价格时返回 unavailable。",
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
      if (workflow.cinematicStage !== requestContext.stage) {
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
  ) {}

  forChat() {
    return {
      get_agent_capabilities: this.getAgentCapabilities,
      get_video_model_constraints: this.getVideoModelConstraints,
      estimate_cinematic_cost: this.estimateCinematicCost,
    };
  }

  forCinematic() {
    return {
      get_agent_capabilities: this.getAgentCapabilities,
      get_video_model_constraints: this.getVideoModelConstraints,
      get_cinematic_context: this.getCinematicContext,
      estimate_cinematic_cost: this.estimateCinematicCost,
    };
  }
}
