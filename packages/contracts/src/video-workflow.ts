import {
  CinematicArtifactVersionSchema,
  CinematicRenderPlanSchema,
  CinematicStageSchema,
} from "./cinematic.js";
import { WorkflowPipelineIdSchema, WorkflowStageIdSchema } from "./workflow-pipeline.js";
import { WorkflowCapabilityResolutionSchema } from "./workflow-capability.js";
import { CinematicAssetBatchSchema } from "./cinematic-assets.js";
import {
  VIDEO_MODEL_DURATION_OPTIONS,
  VideoJobIdSchema,
  VideoJobStatusSchema,
  VideoModelSchema,
  VideoWorkflowIdSchema,
} from "./video-workflow-common.js";
export * from "./video-workflow-common.js";
import { z } from "zod";

const RelatedConversationIdSchema = z.string().uuid();
const RelatedMessageIdSchema = z.string().trim().min(1).max(100);

export const StoryboardShotSchema = z
  .object({
    order: z.number().int().min(1).max(4),
    durationSeconds: z.number().int().min(1).max(10),
    scene: z.string().trim().min(1).max(300),
    subjectAction: z.string().trim().min(1).max(300),
    camera: z.string().trim().min(1).max(200),
    visualStyle: z.string().trim().min(1).max(200),
    audio: z.string().trim().min(1).max(200),
  })
  .strict();

export const StoryboardSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    creativeSummary: z.string().trim().min(1).max(500),
    shots: z.array(StoryboardShotSchema).min(2).max(4),
    videoPrompt: z.string().trim().min(1).max(4_000),
  })
  .strict()
  .superRefine((storyboard, context) => {
    const totalSeconds = storyboard.shots.reduce(
      (total, shot) => total + shot.durationSeconds,
      0,
    );
    if (totalSeconds !== 10) {
      context.addIssue({
        code: "custom",
        message: "Storyboard shots must total exactly 10 seconds.",
        path: ["shots"],
      });
    }
    const orders = storyboard.shots.map((shot) => shot.order);
    const expectedOrders = storyboard.shots.map((_, index) => index + 1);
    if (orders.some((order, index) => order !== expectedOrders[index])) {
      context.addIssue({
        code: "custom",
        message: "Storyboard shot order must be contiguous and start at 1.",
        path: ["shots"],
      });
    }
  });

export const StoryboardVersionSchema = z
  .object({
    version: z.number().int().positive(),
    revisionRequest: z.string().trim().min(1).max(2_000).nullable(),
    storyboard: StoryboardSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const VideoWorkflowStatusSchema = z.enum([
  "drafting",
  "awaiting_input",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const VideoWorkflowFailureCodeSchema = z.enum([
  "AGENT_PROGRESS_STALLED",
  "QUEUE_PROGRESS_STALLED",
  "VIDEO_PROGRESS_STALLED",
  "WORKFLOW_RUN_NOT_RECOVERABLE",
]);

export const ActiveWorkflowRunContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start"), baseVersion: z.literal(0) }).strict(),
  z.object({
    kind: z.literal("restart"),
    restartRequestId: z.string().uuid(),
    targetStage: WorkflowStageIdSchema,
    text: z.string().trim().min(1).max(2_000),
    baseVersion: z.number().int().positive(),
    previousArtifactVersion: z.number().int().positive().nullable(),
  }).strict(),
]);

export const WorkflowStepStateSchema = z.enum([
  "running",
  "awaiting_input",
  "completed",
  "failed",
]);

export const WorkflowToolActivitySchema = z
  .object({
    toolName: z.string().trim().regex(/^[a-zA-Z0-9._-]+$/u).min(1).max(100),
    toolLabel: z.string().trim().min(1).max(80),
    state: z.enum(["running", "completed", "failed"]),
    summary: z.string().trim().min(1).max(500),
  })
  .strict();

export const WorkflowStepProgressSchema = z
  .object({
    stepId: z.string().trim().regex(/^[a-z0-9._-]+$/u).max(100),
    stepLabel: z.string().trim().min(1).max(80),
    stepState: WorkflowStepStateSchema,
    stepIndex: z.number().int().min(1).max(100),
    stepTotal: z.number().int().min(1).max(100),
    message: z.string().trim().min(1).max(500),
    toolActivity: WorkflowToolActivitySchema.optional(),
  })
  .strict()
  .superRefine((progress, context) => {
    if (progress.stepIndex > progress.stepTotal) {
      context.addIssue({
        code: "custom",
        message: "Workflow step index cannot exceed the total step count.",
        path: ["stepIndex"],
      });
    }
    if (progress.toolActivity && progress.message !== progress.toolActivity.summary) {
      context.addIssue({
        code: "custom",
        message: "Workflow step message must match the tool activity summary.",
        path: ["message"],
      });
    }
  });

const workflowStepEventFields = {
  stepId: WorkflowStepProgressSchema.shape.stepId.optional(),
  stepLabel: WorkflowStepProgressSchema.shape.stepLabel.optional(),
  stepState: WorkflowStepProgressSchema.shape.stepState.optional(),
  stepIndex: WorkflowStepProgressSchema.shape.stepIndex.optional(),
  stepTotal: WorkflowStepProgressSchema.shape.stepTotal.optional(),
};

const validateOptionalWorkflowStep = (
  data: Record<string, unknown>,
  context: z.RefinementCtx,
): void => {
  const values = [
    data.stepId,
    data.stepLabel,
    data.stepState,
    data.stepIndex,
    data.stepTotal,
    data.toolActivity,
  ];
  if (values.every((value) => value === undefined)) return;
  const parsed = WorkflowStepProgressSchema.safeParse({
    stepId: data.stepId,
    stepLabel: data.stepLabel,
    stepState: data.stepState,
    stepIndex: data.stepIndex,
    stepTotal: data.stepTotal,
    message: data.message,
    toolActivity: data.toolActivity,
  });
  if (parsed.success) return;
  context.addIssue({
    code: "custom",
    message: "Workflow step presentation fields must be complete and valid.",
    path: ["stepId"],
  });
};

const AgentStepEventDataSchema = z
  .object({
    status: VideoWorkflowStatusSchema,
    message: WorkflowStepProgressSchema.shape.message,
    toolActivity: WorkflowToolActivitySchema.optional(),
    ...workflowStepEventFields,
  })
  .strict()
  .superRefine(validateOptionalWorkflowStep);

const JobProgressEventDataSchema = z
  .object({
    jobId: VideoJobIdSchema,
    status: VideoJobStatusSchema,
    progress: z.number().int().min(0).max(100),
    queueAhead: z.number().int().nonnegative().max(1_000_000).optional(),
    message: WorkflowStepProgressSchema.shape.message.optional(),
    ...workflowStepEventFields,
  })
  .strict()
  .superRefine((data, context) => {
    if (data.message === undefined) {
      const hasStepFields = [
        data.stepId,
        data.stepLabel,
        data.stepState,
        data.stepIndex,
        data.stepTotal,
      ].some((value) => value !== undefined);
      if (!hasStepFields) return;
    }
    validateOptionalWorkflowStep(data, context);
  });

export const VideoJobSnapshotSchema = z
  .object({
    jobId: VideoJobIdSchema,
    status: VideoJobStatusSchema,
    progress: z.number().int().min(0).max(100),
    queueAhead: z.number().int().nonnegative().max(1_000_000).nullable().default(null),
    providerTaskId: z.string().min(1).max(200).nullable(),
    errorMessage: z.string().max(1_000).nullable(),
    videoTitle: z.string().trim().min(1).max(120).nullable().default(null),
    playbackUrl: z.string().url().nullable(),
  })
  .strict();

// Compatibility alias: restart targets are pipeline-defined stage IDs, not a global enum.
export const VideoWorkflowRestartStageSchema = WorkflowStageIdSchema;

export const PendingVideoWorkflowRestartSchema = z.object({
  restartRequestId: z.string().uuid(),
  targetStage: VideoWorkflowRestartStageSchema,
  text: z.string().trim().min(1).max(2_000),
  expectedVersion: z.number().int().nonnegative(),
  requestedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const VideoWorkflowSnapshotSchema = z
  .object({
    workflowId: VideoWorkflowIdSchema,
    pipeline: WorkflowPipelineIdSchema.default("cinematic"),
    currentStage: WorkflowStageIdSchema.default("research"),
    cinematicStage: CinematicStageSchema.optional(),
    currentArtifact: CinematicArtifactVersionSchema.nullable().default(null),
    assetBatch: CinematicAssetBatchSchema.nullable().default(null),
    requestId: z.string().uuid(),
    videoModel: VideoModelSchema,
    durationSeconds: CinematicRenderPlanSchema.shape.durationSeconds.default(10),
    initialPrompt: z.string().trim().min(1).max(8_000),
    status: VideoWorkflowStatusSchema,
    currentVersion: z.number().int().nonnegative(),
    storyboard: StoryboardVersionSchema.nullable(),
    videoJob: VideoJobSnapshotSchema.nullable(),
    pendingRestart: PendingVideoWorkflowRestartSchema.nullable().default(null),
    errorMessage: z.string().max(1_000).nullable(),
    lastProgressAt: z.string().datetime({ offset: true }).optional(),
    failureCode: VideoWorkflowFailureCodeSchema.nullable().optional(),
    canRecover: z.boolean().optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const CreateVideoWorkflowRequestSchema = z
  .object({
    conversationId: RelatedConversationIdSchema.optional(),
    messageId: RelatedMessageIdSchema,
    prompt: z.string().trim().min(1).max(8_000),
    videoModel: VideoModelSchema,
  })
  .strict();

export const CreateVideoWorkflowResponseSchema = z
  .object({
    conversationId: RelatedConversationIdSchema,
    workflowId: VideoWorkflowIdSchema,
    requestId: z.string().uuid(),
  })
  .strict();

export const UpdateVideoWorkflowModelRequestSchema = z
  .object({ videoModel: VideoModelSchema })
  .strict();

export const UpdateVideoWorkflowModelResponseSchema = z
  .object({ accepted: z.literal(true), videoModel: VideoModelSchema })
  .strict();

export const RetryVideoWorkflowResponseSchema = z
  .object({ accepted: z.literal(true), jobId: VideoJobIdSchema })
  .strict();

export const RecoverVideoWorkflowResponseSchema = z
  .object({ accepted: z.literal(true), workflowId: VideoWorkflowIdSchema })
  .strict();

export const VideoWorkflowInteractionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve") }).strict(),
  z
    .object({
      type: z.literal("message"),
      messageId: RelatedMessageIdSchema,
      text: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("scene_durations"),
      messageId: RelatedMessageIdSchema,
      scenes: z
        .array(
          z
            .object({
              order: z.number().int().min(1).max(60),
              durationSeconds: z.number().int().min(1).max(15),
            })
            .strict(),
        )
        .min(1)
        .max(60),
    })
    .strict(),
  z.object({
    type: z.literal("restart_request"),
    messageId: RelatedMessageIdSchema,
    targetStage: VideoWorkflowRestartStageSchema,
    text: z.string().trim().min(1).max(2_000),
  }).strict(),
  z.object({
    type: z.literal("restart_confirm"),
    messageId: RelatedMessageIdSchema,
    restartRequestId: z.string().uuid(),
  }).strict(),
  z.object({
    type: z.literal("restart_cancel"),
    messageId: RelatedMessageIdSchema,
    restartRequestId: z.string().uuid(),
  }).strict(),
]);

export const VideoWorkflowInteractionResultSchema = z
  .object({
    accepted: z.literal(true),
    intent: z.enum([
      "approve",
      "revise",
      "restart_requested",
      "restart_confirmed",
      "restart_cancelled",
      "restart_unavailable",
    ]),
    restartRequestId: z.string().uuid().optional(),
  })
  .strict();

const eventBase = {
  eventId: z.string().min(1).max(100),
  sequence: z.number().int().nonnegative(),
  workflowId: VideoWorkflowIdSchema,
  requestId: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
};

export const VideoWorkflowEventSchema = z.discriminatedUnion("type", [
  z.object({ ...eventBase, type: z.literal("workflow.snapshot"), data: VideoWorkflowSnapshotSchema }).strict(),
  z.object({ ...eventBase, type: z.literal("agent.step"), data: AgentStepEventDataSchema }).strict(),
  z.object({ ...eventBase, type: z.literal("storyboard.completed"), data: StoryboardVersionSchema }).strict(),
  z.object({ ...eventBase, type: z.literal("cinematic.artifact.completed"), data: CinematicArtifactVersionSchema }).strict(),
  z.object({ ...eventBase, type: z.literal("cinematic.approval.required"), data: z.object({ stage: CinematicStageSchema, version: z.number().int().positive() }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("workflow.restart.requested"), data: PendingVideoWorkflowRestartSchema }).strict(),
  z.object({ ...eventBase, type: z.literal("workflow.restart.started"), data: z.object({
    restartRequestId: z.string().uuid(),
    targetStage: VideoWorkflowRestartStageSchema,
    previousRunId: z.string().min(1).max(200).nullable(),
    runId: z.string().min(1).max(200),
  }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("workflow.restart.cancelled"), data: z.object({
    restartRequestId: z.string().uuid(),
    targetStage: VideoWorkflowRestartStageSchema,
  }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("job.progress"), data: JobProgressEventDataSchema }).strict(),
  z.object({ ...eventBase, type: z.literal("job.completed"), data: z.object({ jobId: VideoJobIdSchema }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("job.failed"), data: z.object({ jobId: VideoJobIdSchema, message: z.string().min(1).max(1_000) }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("heartbeat"), data: z.object({}).strict() }).strict(),
]);

export const VideoWorkflowCompletionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("succeeded"), jobId: VideoJobIdSchema }).strict(),
  z.object({ status: z.literal("failed"), jobId: VideoJobIdSchema, message: z.string().min(1).max(1_000) }).strict(),
]);

export const RenderVideoJobPayloadSchema = z
  .object({
    workflowId: VideoWorkflowIdSchema,
    requestId: z.string().uuid(),
    jobId: VideoJobIdSchema,
    cinematic: CinematicRenderPlanSchema.optional(),
    storyboardVersion: z.number().int().positive(),
    videoModel: VideoModelSchema.default("doubao-seedance-2.0"),
    videoPrompt: z.string().trim().min(1).max(4_000),
    capabilityResolutions: z.array(WorkflowCapabilityResolutionSchema).default([]),
    objectKey: z.string()
      .regex(/^tenant\/demo\/project\/demo\/render\/[a-zA-Z0-9-]+\/(?:video|[\p{L}\p{N}][\p{L}\p{N} _.-]{0,95})\.mp4$/u)
      .refine((objectKey) => !objectKey.includes(".."), "Object key cannot contain parent path segments."),
  })
  .strict()
  .superRefine((payload, context) => {
    if (!payload.cinematic) return;
    const supportedDurations: readonly number[] =
      VIDEO_MODEL_DURATION_OPTIONS[payload.videoModel];
    payload.cinematic.scenes.forEach((scene, index) => {
      if (!supportedDurations.includes(scene.generationDurationSeconds)) {
        context.addIssue({
          code: "custom",
          message: "Scene generation duration is not supported by the selected model.",
          path: ["cinematic", "scenes", index, "generationDurationSeconds"],
        });
      }
    });
  });

export const RENDER_JOB_TIMEOUT_MS = 12 * 60 * 60 * 1_000;

export const RenderTimeoutCleanupJobPayloadSchema = z
  .object({
    workflowId: VideoWorkflowIdSchema,
    requestId: z.string().uuid(),
    jobId: VideoJobIdSchema,
    deadlineAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const ApimartVideoSubmissionSchema = z
  .object({
    code: z.literal(200),
    data: z.array(z.object({ status: z.literal("submitted"), task_id: z.string().min(1) }).strict()).length(1),
  })
  .strict();

const ApimartVideoResultSchema = z
  .object({
    videos: z.array(z.object({ url: z.union([z.string().url(), z.array(z.string().url()).min(1)]) }).passthrough()).min(1),
  })
  .passthrough();

export const ApimartVideoTaskSchema = z
  .object({
    code: z.literal(200),
    data: z
      .object({
        id: z.string().min(1),
        status: z.enum(["pending", "processing", "completed", "failed", "cancelled"]),
        progress: z.number().int().min(0).max(100).default(0),
        result: ApimartVideoResultSchema.optional(),
        error: z.object({ message: z.string().min(1) }).passthrough().optional(),
      })
      .passthrough(),
  })
  .strict();

export type Storyboard = z.infer<typeof StoryboardSchema>;
export type StoryboardVersion = z.infer<typeof StoryboardVersionSchema>;
export type VideoWorkflowStatus = z.infer<typeof VideoWorkflowStatusSchema>;
export type VideoWorkflowFailureCode = z.infer<typeof VideoWorkflowFailureCodeSchema>;
export type ActiveWorkflowRunContext = z.infer<typeof ActiveWorkflowRunContextSchema>;
export type WorkflowStepState = z.infer<typeof WorkflowStepStateSchema>;
export type WorkflowToolActivity = z.infer<typeof WorkflowToolActivitySchema>;
export type WorkflowStepProgress = z.infer<typeof WorkflowStepProgressSchema>;
export type VideoWorkflowSnapshot = z.infer<typeof VideoWorkflowSnapshotSchema>;
export type VideoWorkflowRestartStage = z.infer<typeof VideoWorkflowRestartStageSchema>;
export type PendingVideoWorkflowRestart = z.infer<typeof PendingVideoWorkflowRestartSchema>;
export type CreateVideoWorkflowRequest = z.infer<typeof CreateVideoWorkflowRequestSchema>;
export type CreateVideoWorkflowResponse = z.infer<typeof CreateVideoWorkflowResponseSchema>;
export type UpdateVideoWorkflowModelRequest = z.infer<typeof UpdateVideoWorkflowModelRequestSchema>;
export type UpdateVideoWorkflowModelResponse = z.infer<typeof UpdateVideoWorkflowModelResponseSchema>;
export type RetryVideoWorkflowResponse = z.infer<typeof RetryVideoWorkflowResponseSchema>;
export type RecoverVideoWorkflowResponse = z.infer<typeof RecoverVideoWorkflowResponseSchema>;
export type VideoWorkflowInteraction = z.infer<typeof VideoWorkflowInteractionSchema>;
export type VideoWorkflowInteractionResult = z.infer<typeof VideoWorkflowInteractionResultSchema>;
export type VideoWorkflowEvent = z.infer<typeof VideoWorkflowEventSchema>;
export type VideoWorkflowCompletion = z.infer<typeof VideoWorkflowCompletionSchema>;
export type RenderVideoJobPayload = z.infer<typeof RenderVideoJobPayloadSchema>;
export type RenderTimeoutCleanupJobPayload = z.infer<typeof RenderTimeoutCleanupJobPayloadSchema>;
export type ApimartVideoSubmission = z.infer<typeof ApimartVideoSubmissionSchema>;
export type ApimartVideoTask = z.infer<typeof ApimartVideoTaskSchema>;
