import { z } from "zod";

const RelatedConversationIdSchema = z.string().uuid();
const RelatedMessageIdSchema = z.string().trim().min(1).max(100);

export const VideoWorkflowIdSchema = z.string().uuid();
export const VideoJobIdSchema = z.string().min(1).max(100);
export const VideoModelSchema = z.enum([
  "MiniMax-Hailuo-2.3",
  "doubao-seedance-2.0",
]);

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

export const VideoJobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const VideoJobSnapshotSchema = z
  .object({
    jobId: VideoJobIdSchema,
    status: VideoJobStatusSchema,
    progress: z.number().int().min(0).max(100),
    providerTaskId: z.string().min(1).max(200).nullable(),
    errorMessage: z.string().max(1_000).nullable(),
    playbackUrl: z.string().url().nullable(),
  })
  .strict();

export const VideoWorkflowSnapshotSchema = z
  .object({
    workflowId: VideoWorkflowIdSchema,
    requestId: z.string().uuid(),
    videoModel: VideoModelSchema,
    initialPrompt: z.string().trim().min(1).max(8_000),
    status: VideoWorkflowStatusSchema,
    currentVersion: z.number().int().nonnegative(),
    storyboard: StoryboardVersionSchema.nullable(),
    videoJob: VideoJobSnapshotSchema.nullable(),
    errorMessage: z.string().max(1_000).nullable(),
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

export const VideoWorkflowInteractionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve") }).strict(),
  z
    .object({
      type: z.literal("message"),
      messageId: RelatedMessageIdSchema,
      text: z.string().trim().min(1).max(2_000),
    })
    .strict(),
]);

export const VideoWorkflowInteractionResultSchema = z
  .object({ accepted: z.literal(true), intent: z.enum(["approve", "revise"]) })
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
  z.object({ ...eventBase, type: z.literal("agent.step"), data: z.object({ status: VideoWorkflowStatusSchema, message: z.string().min(1).max(500) }).strict() }).strict(),
  z.object({ ...eventBase, type: z.literal("storyboard.completed"), data: StoryboardVersionSchema }).strict(),
  z.object({ ...eventBase, type: z.literal("job.progress"), data: z.object({ jobId: VideoJobIdSchema, status: VideoJobStatusSchema, progress: z.number().int().min(0).max(100) }).strict() }).strict(),
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
    storyboardVersion: z.number().int().positive(),
    videoModel: VideoModelSchema.default("doubao-seedance-2.0"),
    videoPrompt: z.string().trim().min(1).max(4_000),
    objectKey: z.string().regex(/^tenant\/demo\/project\/demo\/render\/[a-zA-Z0-9-]+\/video\.mp4$/u),
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
export type VideoJobStatus = z.infer<typeof VideoJobStatusSchema>;
export type VideoModel = z.infer<typeof VideoModelSchema>;
export type VideoWorkflowSnapshot = z.infer<typeof VideoWorkflowSnapshotSchema>;
export type CreateVideoWorkflowRequest = z.infer<typeof CreateVideoWorkflowRequestSchema>;
export type CreateVideoWorkflowResponse = z.infer<typeof CreateVideoWorkflowResponseSchema>;
export type UpdateVideoWorkflowModelRequest = z.infer<typeof UpdateVideoWorkflowModelRequestSchema>;
export type UpdateVideoWorkflowModelResponse = z.infer<typeof UpdateVideoWorkflowModelResponseSchema>;
export type RetryVideoWorkflowResponse = z.infer<typeof RetryVideoWorkflowResponseSchema>;
export type VideoWorkflowInteraction = z.infer<typeof VideoWorkflowInteractionSchema>;
export type VideoWorkflowInteractionResult = z.infer<typeof VideoWorkflowInteractionResultSchema>;
export type VideoWorkflowEvent = z.infer<typeof VideoWorkflowEventSchema>;
export type VideoWorkflowCompletion = z.infer<typeof VideoWorkflowCompletionSchema>;
export type RenderVideoJobPayload = z.infer<typeof RenderVideoJobPayloadSchema>;
export type ApimartVideoSubmission = z.infer<typeof ApimartVideoSubmissionSchema>;
export type ApimartVideoTask = z.infer<typeof ApimartVideoTaskSchema>;
