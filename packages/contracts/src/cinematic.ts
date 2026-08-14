import { z } from "zod";

import { defineWorkflowPipeline } from "./workflow-pipeline.js";

export const CinematicStageSchema = z.enum([
  "research",
  "proposal",
  "script",
  "scene_plan",
  "assets",
  "edit",
  "compose",
]);

export const CinematicGenerativeStageSchema = CinematicStageSchema.exclude(["compose"]);

export const CINEMATIC_PIPELINE_DEFINITION = defineWorkflowPipeline({
  id: "cinematic",
  label: "电影化视频",
  aliases: ["电影化", "电影感", "cinematic"],
  definitionVersion: 2,
  initialStageId: "research",
  terminalStageIds: ["compose"],
  directEntryStageIds: ["proposal", "script", "scene_plan", "assets"],
  stages: [
    { id: "research", label: "创作研究", aliases: ["创作研究", "研究", "research"], stepId: "research", producesArtifact: true, requiresApproval: false, allowsRevision: false, isRestartable: false, intentTopics: ["参考资料", "创作约束", "调研"], ownedArtifactKinds: ["research_brief"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: ["proposal"], inputArtifactKinds: [], outputArtifactKinds: ["research_brief"], execution: "agent", planningReview: { requiresApproval: false, allowsRevision: false }, directorSkillId: "cinematic-research", reviewerSkillId: "cinematic-reviewer", capabilities: { required: [], optional: [], conditional: [] } },
    { id: "proposal", label: "创意方案", aliases: ["创意方案", "方案阶段", "proposal"], stepId: "proposal", producesArtifact: true, requiresApproval: true, allowsRevision: true, isRestartable: true, intentTopics: ["主题", "受众", "概念", "风格", "预算", "供应商"], ownedArtifactKinds: ["proposal"], allowsAutoAdvanceAfterRevision: true, allowedNextStageIds: ["script"], inputArtifactKinds: ["research_brief"], outputArtifactKinds: ["proposal"], execution: "agent", planningReview: { requiresApproval: true, allowsRevision: true }, directorSkillId: "cinematic-proposal", reviewerSkillId: "cinematic-reviewer", capabilities: { required: [], optional: [], conditional: [] } },
    { id: "script", label: "脚本", aliases: ["脚本", "文案阶段", "script"], stepId: "script", stepLabel: "脚本生成", producesArtifact: true, requiresApproval: true, allowsRevision: true, isRestartable: true, intentTopics: ["剧情", "文案", "旁白", "叙事节奏"], ownedArtifactKinds: ["script"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: ["scene_plan"], inputArtifactKinds: ["proposal"], outputArtifactKinds: ["script"], execution: "agent", planningReview: { requiresApproval: true, allowsRevision: true }, directorSkillId: "cinematic-script", reviewerSkillId: "cinematic-reviewer", capabilities: { required: [], optional: [], conditional: [] } },
    { id: "scene_plan", label: "分镜写作", aliases: ["分镜", "分镜写作", "场景规划", "scene plan", "storyboard"], stepId: "scene-plan", producesArtifact: true, requiresApproval: true, allowsRevision: true, isRestartable: true, intentTopics: ["镜头", "场景顺序", "运镜", "逐镜时长"], ownedArtifactKinds: ["scene_plan"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: ["assets"], inputArtifactKinds: ["script"], outputArtifactKinds: ["scene_plan"], execution: "agent", planningReview: { requiresApproval: true, allowsRevision: true }, directorSkillId: "cinematic-scene-plan", reviewerSkillId: "cinematic-reviewer", capabilities: { required: [], optional: ["video.probe"], conditional: [] } },
    { id: "assets", label: "素材规划", aliases: ["素材规划", "素材阶段", "asset", "assets"], stepId: "assets", producesArtifact: true, requiresApproval: true, allowsRevision: true, isRestartable: true, intentTopics: ["图片", "视频", "音乐", "声音素材"], ownedArtifactKinds: ["asset_manifest"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: ["edit"], inputArtifactKinds: ["scene_plan"], outputArtifactKinds: ["asset_manifest"], execution: "queue", planningReview: { requiresApproval: true, allowsRevision: true }, executionReview: { requiresApproval: true, allowsRevision: true }, directorSkillId: "cinematic-assets", reviewerSkillId: "cinematic-reviewer", capabilities: { required: [], optional: [], conditional: [{ capability: "video.generate", when: "motion_required_without_source_video" }, { capability: "image.generate", when: "generated_image_planned" }, { capability: "image.render.title-card", when: "title_card_planned" }, { capability: "music.generate", when: "music_generation_selected" }] } },
    { id: "edit", label: "剪辑方案", aliases: ["剪辑方案", "剪辑", "edit"], stepId: "edit", producesArtifact: true, requiresApproval: false, allowsRevision: false, isRestartable: false, intentTopics: ["剪辑", "字幕", "同步", "转场"], ownedArtifactKinds: ["edit_decisions"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: ["compose"], inputArtifactKinds: ["asset_manifest"], outputArtifactKinds: ["edit_decisions"], execution: "agent", planningReview: { requiresApproval: false, allowsRevision: false }, directorSkillId: "cinematic-edit", reviewerSkillId: "cinematic-reviewer", capabilities: { required: [], optional: [], conditional: [] } },
    { id: "compose", label: "视频生成", aliases: ["视频生成", "合成", "compose"], stepId: "video-generation", producesArtifact: false, requiresApproval: false, allowsRevision: false, isRestartable: false, intentTopics: ["编码", "分辨率", "音量", "成片"], ownedArtifactKinds: ["render_output"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: [], inputArtifactKinds: ["edit_decisions"], outputArtifactKinds: ["render_output"], execution: "queue", planningReview: { requiresApproval: false, allowsRevision: false }, directorSkillId: "cinematic-governance", reviewerSkillId: "cinematic-reviewer", capabilities: { required: ["video.compose.ffmpeg"], optional: ["video.probe"], conditional: [{ capability: "audio.mix", when: "audio_asset_planned" }] } },
  ],
});

export const CinematicDurationSecondsSchema = z.number().int().min(4).max(300);
export const CinematicClipDurationSecondsSchema = z.number().int().min(1).max(15);
const CinematicSceneOrderSchema = z.number().int().min(1).max(60);

export const CinematicResearchBriefSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  sourceMode: z.enum(["generated", "source_led", "hybrid"]),
  moodKeywords: z.array(z.string().trim().min(1).max(80)).min(3).max(8),
  visualReferences: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    url: z.string().url().nullable(),
  }).strict()).min(3).max(8),
  musicDirection: z.string().trim().min(1).max(500),
  productionConstraints: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
}).strict();

export const CinematicProposalSchema = z.object({
  directions: z.array(z.object({
    id: z.string().trim().regex(/^[a-z0-9-]+$/u).max(40),
    title: z.string().trim().min(1).max(120),
    logline: z.string().trim().min(1).max(400),
    emotionalArc: z.array(z.string().trim().min(1).max(200)).min(3).max(8),
    visualTreatment: z.string().trim().min(1).max(800),
    colorPalette: z.array(z.string().trim().min(1).max(80)).min(3).max(8),
    musicDirection: z.string().trim().min(1).max(400),
  }).strict()).length(3),
  recommendedDirectionId: z.string().trim().regex(/^[a-z0-9-]+$/u).max(40),
  rendererFamily: z.literal("ffmpeg"),
  durationSeconds: CinematicDurationSecondsSchema,
  estimatedCostUsd: z.number().min(0).max(1_000),
  deliveryPromise: z.string().trim().min(1).max(500),
}).strict().superRefine((proposal, context) => {
  if (!proposal.directions.some((direction) => direction.id === proposal.recommendedDirectionId)) {
    context.addIssue({
      code: "custom",
      message: "The recommended direction must reference one of the proposal directions.",
      path: ["recommendedDirectionId"],
    });
  }
});

export const CinematicScriptSchema = z.object({
  title: z.string().trim().min(1).max(120),
  durationSeconds: CinematicDurationSecondsSchema,
  dialogue: z.array(z.string().trim().min(1).max(300)).max(60),
  titleCards: z.array(z.string().trim().min(1).max(160)).max(30),
  beats: z.array(z.object({
    order: CinematicSceneOrderSchema,
    durationSeconds: CinematicDurationSecondsSchema,
    purpose: z.string().trim().min(1).max(240),
    visual: z.string().trim().min(1).max(500),
    audio: z.string().trim().min(1).max(300),
  }).strict()).min(1).max(60),
}).strict().superRefine((script, context) => {
  const duration = script.beats.reduce((total, beat) => total + beat.durationSeconds, 0);
  if (duration !== script.durationSeconds) {
    context.addIssue({ code: "custom", message: "Script beats must total durationSeconds.", path: ["beats"] });
  }
  if (script.beats.some((beat, index) => beat.order !== index + 1)) {
    context.addIssue({ code: "custom", message: "Script beat order must be contiguous.", path: ["beats"] });
  }
});

export const CinematicSceneSchema = z.object({
  order: CinematicSceneOrderSchema,
  durationSeconds: CinematicClipDurationSecondsSchema,
  generationDurationSeconds: CinematicClipDurationSecondsSchema.optional(),
  narrativeBeat: z.string().trim().min(1).max(300),
  visualPrompt: z.string().trim().min(1).max(1_000),
  sourceType: z.enum(["generated_video", "generated_image", "supplied_video", "title_card"]),
  motionRequired: z.boolean(),
  camera: z.string().trim().min(1).max(300),
  transition: z.enum(["cut", "crossfade", "fade_black", "match_cut"]),
  audio: z.string().trim().min(1).max(300),
}).strict();

export const CinematicScenePlanSchema = z.object({
  durationSeconds: CinematicDurationSecondsSchema,
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  scenes: z.array(CinematicSceneSchema).min(1).max(60),
}).strict().superRefine((plan, context) => {
  const duration = plan.scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
  if (duration !== plan.durationSeconds) {
    context.addIssue({ code: "custom", message: "Scene durations must total durationSeconds.", path: ["scenes"] });
  }
  if (plan.scenes.some((scene, index) => scene.order !== index + 1)) {
    context.addIssue({ code: "custom", message: "Scene order must be contiguous.", path: ["scenes"] });
  }
});

export const CinematicAssetManifestSchema = z.object({
  assets: z.array(z.object({
    sceneOrder: CinematicSceneOrderSchema,
    kind: z.enum(["video", "image", "title_card", "audio"]),
    sourceMode: z.enum(["generate", "supplied", "library"]),
    status: z.literal("planned"),
    prompt: z.string().trim().min(1).max(1_000),
    estimatedCostUsd: z.number().min(0).max(1_000),
  }).strict()).min(1).max(120),
  music: z.object({
    sourceMode: z.enum(["generate", "supplied", "library"]),
    direction: z.string().trim().min(1).max(500),
  }).strict(),
  totalEstimatedCostUsd: z.number().min(0).max(1_000),
  slideshowRisk: z.number().int().min(0).max(10),
}).strict();

export const CinematicEditDecisionsSchema = z.object({
  durationSeconds: CinematicDurationSecondsSchema,
  rendererFamily: z.literal("ffmpeg"),
  timeline: z.array(z.object({
    sceneOrder: CinematicSceneOrderSchema,
    startSeconds: z.number().min(0).max(300),
    durationSeconds: CinematicClipDurationSecondsSchema,
    transition: z.enum(["cut", "crossfade", "fade_black", "match_cut"]),
    audioGainDb: z.number().min(-60).max(12),
  }).strict()).min(1).max(60),
  colorGrade: z.string().trim().min(1).max(400),
  audioMix: z.string().trim().min(1).max(500),
  renderPrompt: z.string().trim().min(1).max(4_000),
  qualityChecks: z.array(z.string().trim().min(1).max(240)).min(3).max(12),
}).strict().superRefine((edit, context) => {
  const duration = edit.timeline.reduce((total, item) => total + item.durationSeconds, 0);
  if (duration !== edit.durationSeconds) {
    context.addIssue({ code: "custom", message: "Timeline items must total durationSeconds.", path: ["timeline"] });
  }
  if (edit.timeline.some((item, index) => item.sceneOrder !== index + 1)) {
    context.addIssue({ code: "custom", message: "Timeline scene order must be contiguous.", path: ["timeline"] });
  }
});

export const CinematicArtifactSchemaByStage = {
  research: z.object({
    stage: z.literal("research"),
    data: CinematicResearchBriefSchema,
  }).strict(),
  proposal: z.object({
    stage: z.literal("proposal"),
    data: CinematicProposalSchema,
  }).strict(),
  script: z.object({
    stage: z.literal("script"),
    data: CinematicScriptSchema,
  }).strict(),
  scene_plan: z.object({
    stage: z.literal("scene_plan"),
    data: CinematicScenePlanSchema,
  }).strict(),
  assets: z.object({
    stage: z.literal("assets"),
    data: CinematicAssetManifestSchema,
  }).strict(),
  edit: z.object({
    stage: z.literal("edit"),
    data: CinematicEditDecisionsSchema,
  }).strict(),
} as const;

export const CinematicArtifactSchema = z.discriminatedUnion("stage", [
  CinematicArtifactSchemaByStage.research,
  CinematicArtifactSchemaByStage.proposal,
  CinematicArtifactSchemaByStage.script,
  CinematicArtifactSchemaByStage.scene_plan,
  CinematicArtifactSchemaByStage.assets,
  CinematicArtifactSchemaByStage.edit,
]);

export const CinematicArtifactVersionSchema = z.object({
  version: z.number().int().positive(),
  revisionRequest: z.string().trim().min(1).max(2_000).nullable(),
  artifact: CinematicArtifactSchema,
  isSuperseded: z.boolean().default(false),
  supersededAt: z.string().datetime({ offset: true }).nullable().default(null),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const CinematicRenderSceneSchema = CinematicSceneSchema.extend({
  generationDurationSeconds: CinematicClipDurationSecondsSchema,
  assetObjectKey: z.string()
    .regex(/^tenant\/demo\/project\/demo\/derived\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/u)
    .refine((value) => !value.includes(".."), "Asset object key is unsafe.")
    .optional(),
  assetMimeType: z.enum(["video/mp4", "image/png", "image/jpeg"]).optional(),
});

export const CinematicRenderPlanSchema = z.object({
  rendererFamily: z.literal("ffmpeg"),
  durationSeconds: CinematicDurationSecondsSchema,
  modelMaxDurationSeconds: CinematicClipDurationSecondsSchema,
  scenes: z.array(CinematicRenderSceneSchema).min(1).max(60),
  music: z.object({
    objectKey: z.string()
      .regex(/^tenant\/demo\/project\/demo\/derived\/[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/u)
      .refine((value) => !value.includes(".."), "Music object key is unsafe."),
    mimeType: z.enum(["audio/wav", "audio/mp4", "audio/mpeg"]),
    gainDb: z.number().min(-60).max(12).default(-12),
  }).strict().optional(),
}).strict().superRefine((plan, context) => {
  plan.scenes.forEach((scene, index) => {
    if ((scene.assetObjectKey === undefined) !== (scene.assetMimeType === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Render scene asset key and MIME must be provided together.",
        path: ["scenes", index, "assetObjectKey"],
      });
    }
  });
  if (plan.scenes.some((scene) => scene.generationDurationSeconds > plan.modelMaxDurationSeconds)) {
    context.addIssue({ code: "custom", message: "Every scene must fit within the selected model's single-generation limit.", path: ["scenes"] });
  }
  if (plan.scenes.some((scene) => scene.generationDurationSeconds < scene.durationSeconds)) {
    context.addIssue({
      code: "custom",
      message: "Model generation duration must cover the final scene duration.",
      path: ["scenes"],
    });
  }
  const duration = plan.scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
  if (duration !== plan.durationSeconds) {
    context.addIssue({ code: "custom", message: "Render scenes must total durationSeconds.", path: ["scenes"] });
  }
});

export type CinematicStage = z.infer<typeof CinematicStageSchema>;
export type CinematicGenerativeStage = z.infer<typeof CinematicGenerativeStageSchema>;
export type CinematicArtifact = z.infer<typeof CinematicArtifactSchema>;
export type CinematicArtifactVersion = z.infer<typeof CinematicArtifactVersionSchema>;
export type CinematicRenderPlan = z.infer<typeof CinematicRenderPlanSchema>;
