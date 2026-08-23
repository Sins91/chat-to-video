import { describe, expect, it } from "vitest";

import {
  ApimartVideoSubmissionSchema,
  ActiveWorkflowRunContextSchema,
  CreateVideoWorkflowRequestSchema,
  createGeneratedVideoFilename,
  RenderVideoJobPayloadSchema,
  RecoverVideoWorkflowResponseSchema,
  RetryVideoWorkflowResponseSchema,
  UpdateVideoWorkflowModelRequestSchema,
  StoryboardSchema,
  ConversationEntrySchema,
  VideoWorkflowInteractionSchema,
  VideoWorkflowInteractionResultSchema,
  VideoWorkflowEventSchema,
  WorkflowStepProgressSchema,
  WorkflowUserIntentSchema,
  defineWorkflowPipeline,
  getPreviousWorkflowStage,
  getWorkflowStagesFrom,
  parseWorkflowRestartTarget,
  parseWorkflowDirectEntryTarget,
  PendingWorkflowControlSchema,
  PersistedChatQueueItemSchema,
  PERSISTED_CHAT_QUEUE_VERSION,
  CINEMATIC_PIPELINE_DEFINITION,
  isVideoWorkflowProcessingStatus,
  isVideoWorkflowTerminalStatus,
} from "../src/index.js";

const storyboard = {
  title: "雨夜来信",
  creativeSummary: "一封来自未来的信改变了女孩的选择。",
  shots: [
    { order: 1, durationSeconds: 4, scene: "雨夜旧街", subjectAction: "女孩打开信箱", camera: "缓慢推进", visualStyle: "电影写实，冷色霓虹", audio: "雨声与低沉环境乐" },
    { order: 2, durationSeconds: 6, scene: "信件特写", subjectAction: "墨迹显出警告", camera: "微距转手持跟拍", visualStyle: "高反差，浅景深", audio: "纸张声与心跳" },
  ],
  videoPrompt: "10 秒电影写实短片，雨夜旧街，镜头缓慢推进女孩打开信箱，切到信件墨迹特写。",
};

describe("video workflow contracts", () => {
  it("derives processing and terminal workflow states consistently", () => {
    expect((["drafting", "queued", "running"] as const)
      .every((status) => isVideoWorkflowProcessingStatus(status))).toBe(true);
    expect((["succeeded", "failed", "cancelled"] as const)
      .every((status) => isVideoWorkflowTerminalStatus(status))).toBe(true);
    expect(isVideoWorkflowProcessingStatus("awaiting_input")).toBe(false);
    expect(isVideoWorkflowTerminalStatus("awaiting_input")).toBe(false);
  });

  it("validates versioned persistent queue records and rejects corrupt versions", () => {
    const item = {
      version: PERSISTED_CHAT_QUEUE_VERSION,
      id: "00000000-0000-4000-8000-000000000020",
      messageId: "message-1",
      conversationId: "00000000-0000-4000-8000-000000000010",
      text: "下一条消息",
      referenceImages: [],
      videoModel: "doubao-seedance-2.0",
      subtitlesEnabled: false,
      status: "queued",
      attemptCount: 0,
      nextAttemptAt: null,
      errorMessage: null,
      createdAt: "2026-08-10T01:00:00.000Z",
      updatedAt: "2026-08-10T01:00:00.000Z",
    };
    expect(PersistedChatQueueItemSchema.parse(item)).toMatchObject({ version: 1 });
    expect(PersistedChatQueueItemSchema.safeParse({ ...item, version: 2 }).success).toBe(false);
    expect(PersistedChatQueueItemSchema.safeParse({ ...item, text: "", referenceImages: [] }).success).toBe(false);
  });
  it("defaults new workflows to subtitles disabled", () => {
    const request = CreateVideoWorkflowRequestSchema.parse({
      messageId: "message-1",
      prompt: "制作一条产品短片",
      referenceImageIds: [],
      videoModel: "doubao-seedance-2.0",
    });
    expect(request.subtitlesEnabled).toBe(false);
  });
  it("validates structured workflow user intents", () => {
    expect(WorkflowUserIntentSchema.parse({ type: "approve", stageId: "proposal" }))
      .toEqual({ type: "approve", stageId: "proposal" });
    expect(WorkflowUserIntentSchema.parse({ type: "out_of_scope" }))
      .toEqual({ type: "out_of_scope" });
    expect(WorkflowUserIntentSchema.safeParse({
      type: "restart_from",
      stageId: "proposal",
      feedback: "",
      invalidates: ["script"],
    }).success).toBe(false);
  });

  it("derives direct-entry support from the registered pipeline", () => {
    expect(parseWorkflowDirectEntryTarget(CINEMATIC_PIPELINE_DEFINITION, "script")?.id)
      .toBe("script");
    expect(parseWorkflowDirectEntryTarget(CINEMATIC_PIPELINE_DEFINITION, "research"))
      .toBeNull();
  });

  it("validates an auditable pending workflow control", () => {
    const pending = PendingWorkflowControlSchema.parse({
      controlRequestId: "00000000-0000-4000-8000-000000000011",
      kind: "exit_workflow",
      sourceWorkflowId: "00000000-0000-4000-8000-000000000012",
      targetPipelineId: null,
      targetStageId: null,
      expectedStateVersion: 3,
      candidate: null,
      impact: { summary: "Cancel queued work and preserve history." },
      requestedAt: "2026-08-14T00:00:00.000Z",
      expiresAt: "2026-08-14T00:15:00.000Z",
    });
    expect(pending.impact.activeJobCount).toBe(0);
  });
  it("validates persisted active run recovery context", () => {
    expect(ActiveWorkflowRunContextSchema.parse({ kind: "start", baseVersion: 0 }))
      .toEqual({ kind: "start", baseVersion: 0 });
    expect(ActiveWorkflowRunContextSchema.safeParse({
      kind: "restart",
      restartRequestId: "not-a-uuid",
      targetStage: "proposal",
      text: "重新生成方案",
      baseVersion: 4,
      previousArtifactVersion: 2,
    }).success).toBe(false);
  });

  it("creates a safe generated-video filename from the generated content title", () => {
    expect(createGeneratedVideoFilename("雨夜来信：女孩 / 旧街", "job-12345678"))
      .toBe("雨夜来信-女孩 - 旧街.mp4");
    expect(createGeneratedVideoFilename("   ", "job-12345678"))
      .toBe("video-job-1234.mp4");
    expect(createGeneratedVideoFilename("雨夜来信..终版", "job-12345678"))
      .toBe("雨夜来信.终版.mp4");
    expect(RenderVideoJobPayloadSchema.safeParse({
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      jobId: "job-1",
      storyboardVersion: 1,
      videoPrompt: "Rainy night",
      objectKey: "tenant/demo/project/demo/render/job-1/雨夜来信-女孩 - 旧街.mp4",
    }).success).toBe(true);
  });

  it("accepts a contiguous storyboard totaling ten seconds", () => {
    expect(StoryboardSchema.parse(storyboard)).toEqual(storyboard);
  });

  it("rejects a storyboard with an invalid total duration", () => {
    expect(StoryboardSchema.safeParse({ ...storyboard, shots: storyboard.shots.map((shot) => ({ ...shot, durationSeconds: 3 })) }).success).toBe(false);
  });

  it("keeps approval explicit and validates revision messages", () => {
    expect(VideoWorkflowInteractionSchema.parse({ type: "approve" })).toEqual({ type: "approve" });
    expect(VideoWorkflowInteractionSchema.parse({
      type: "message",
      messageId: "message-selection",
      text: "选择第二个方案并继续下一步",
      advanceAfterChange: true,
    })).toMatchObject({ advanceAfterChange: true });
    expect(VideoWorkflowInteractionSchema.safeParse({ type: "message", messageId: "message-1", text: "" }).success).toBe(false);
  });

  it("rejects the removed legacy restart interactions", () => {
    expect(VideoWorkflowInteractionSchema.safeParse({
      type: "restart_request",
      messageId: "restart-message",
      targetStage: "script",
      text: "从脚本重新开始",
    }).success).toBe(false);
    expect(VideoWorkflowInteractionSchema.safeParse({
      type: "restart_confirm",
      messageId: "restart-message",
      restartRequestId: "00000000-0000-4000-8000-000000000099",
    }).success).toBe(false);
  });

  it("derives restart behavior from one pipeline definition", () => {
    const pipeline = defineWorkflowPipeline({
      id: "audio-story",
      definitionVersion: 1,
      initialStageId: "brief",
      terminalStageIds: ["mix"],
      stages: [
        { id: "brief", label: "需求", aliases: ["需求"], stepId: "brief", isRestartable: false, intentTopics: ["需求"], ownedArtifactKinds: ["brief"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: ["outline"], inputArtifactKinds: [], outputArtifactKinds: ["brief"], execution: "agent", planningReview: { requiresApproval: false, allowsRevision: false }, capabilities: { required: [], optional: [], conditional: [] }, tools: { required: [], optional: [] } },
        { id: "outline", label: "大纲", aliases: ["大纲"], stepId: "outline", isRestartable: true, intentTopics: ["大纲"], ownedArtifactKinds: ["outline"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: ["voice"], inputArtifactKinds: ["brief"], outputArtifactKinds: ["outline"], execution: "agent", planningReview: { requiresApproval: true, allowsRevision: true }, capabilities: { required: [], optional: [], conditional: [] }, tools: { required: [], optional: [] } },
        { id: "voice", label: "配音", aliases: ["配音"], stepId: "voice", isRestartable: true, intentTopics: ["配音"], ownedArtifactKinds: ["voice"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: ["mix"], inputArtifactKinds: ["outline"], outputArtifactKinds: ["voice"], execution: "agent", planningReview: { requiresApproval: true, allowsRevision: true }, capabilities: { required: [], optional: [], conditional: [] }, tools: { required: [], optional: [] } },
        { id: "mix", label: "混音", aliases: ["混音"], stepId: "mix", isRestartable: false, intentTopics: ["混音"], ownedArtifactKinds: ["mix"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: [], inputArtifactKinds: ["voice"], outputArtifactKinds: ["mix"], execution: "queue", planningReview: { requiresApproval: false, allowsRevision: false }, capabilities: { required: [], optional: [], conditional: [] }, tools: { required: [], optional: [] } },
      ],
    });

    expect(parseWorkflowRestartTarget(pipeline, "voice")?.label).toBe("配音");
    expect(parseWorkflowRestartTarget(pipeline, "mix")).toBeNull();
    expect(getPreviousWorkflowStage(pipeline, "voice")?.id).toBe("outline");
    expect(getWorkflowStagesFrom(pipeline, "outline").map((stage) => stage.id))
      .toEqual(["outline", "voice", "mix"]);
  });

  it("derives cinematic Tool registration from the pipeline definition", () => {
    const research = CINEMATIC_PIPELINE_DEFINITION.stages.find((stage) => stage.id === "research");
    const assets = CINEMATIC_PIPELINE_DEFINITION.stages.find((stage) => stage.id === "assets");
    const compose = CINEMATIC_PIPELINE_DEFINITION.stages.find((stage) => stage.id === "compose");
    expect(research?.tools.required).toEqual(["web_search"]);
    expect(assets?.tools.optional).toContain("image_selector");
    expect(assets?.tools.optional).toContain("apimart_tts");
    expect(compose?.tools.required).toEqual(["video_compose"]);
    expect(compose?.tools.optional).toContain("visual_qa");
  });

  it("validates persisted restart events and read-only archived videos", () => {
    const eventBase = {
      eventId: "restart-event",
      sequence: 8,
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      timestamp: "2026-08-12T01:00:00.000Z",
    };
    expect(VideoWorkflowEventSchema.safeParse({
      ...eventBase,
      type: "workflow.restart.started",
      data: {
        restartRequestId: "00000000-0000-4000-8000-000000000099",
        targetStage: "scene_plan",
        previousRunId: "old-run",
        runId: "new-run",
      },
    }).success).toBe(true);
    expect(ConversationEntrySchema.safeParse({
      id: "archived-video-job-1",
      type: "archived_video",
      workflowId: eventBase.workflowId,
      jobId: "job-1",
      storyboardVersion: 7,
      initialPrompt: "生成一段雨夜短片",
      videoTitle: "雨夜来信",
      playbackUrl: "https://storage.example/video.mp4?signature=short-lived",
      createdAt: eventBase.timestamp,
    }).success).toBe(true);
    expect(ConversationEntrySchema.safeParse({
      id: "asset-batch-1",
      type: "cinematic_asset_batch",
      workflowId: eventBase.workflowId,
      batchId: "asset-batch-1",
      planVersion: 6,
      status: "approved",
      assetCount: 5,
      isSuperseded: false,
      supersededAt: null,
      createdAt: eventBase.timestamp,
    }).success).toBe(true);
    expect(ConversationEntrySchema.safeParse({
      id: "asset-batch-1",
      type: "cinematic_asset_batch",
      workflowId: eventBase.workflowId,
      batchId: "asset-batch-1",
      planVersion: 6,
      status: "approved",
      assetCount: 5,
      isSuperseded: false,
      supersededAt: null,
      objectKey: "tenant/demo/project/demo/derived/asset/private.mp4",
      createdAt: eventBase.timestamp,
    }).success).toBe(false);
    expect(ConversationEntrySchema.safeParse({
      id: "asset-batch-1",
      type: "cinematic_asset_batch",
      workflowId: eventBase.workflowId,
      batchId: "asset-batch-1",
      planVersion: 6,
      status: "approved",
      assetCount: 0,
      isSuperseded: false,
      supersededAt: null,
      createdAt: "not-a-timestamp",
    }).success).toBe(false);
  });

  it("accepts structured workflow steps and legacy events", () => {
    expect(WorkflowStepProgressSchema.parse({
      stepId: "scene-plan",
      stepLabel: "分镜写作",
      stepState: "awaiting_input",
      stepIndex: 5,
      stepTotal: 8,
      message: "分镜写作已完成。",
    }).stepIndex).toBe(5);

    const eventBase = {
      eventId: "event-1",
      sequence: 1,
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      timestamp: new Date().toISOString(),
      type: "agent.step" as const,
    };
    expect(VideoWorkflowEventSchema.safeParse({
      ...eventBase,
      data: { status: "drafting", message: "Legacy event" },
    }).success).toBe(true);
    expect(VideoWorkflowEventSchema.safeParse({
      ...eventBase,
      data: {
        status: "drafting",
        stepId: "scene-plan",
        stepLabel: "分镜写作",
        stepState: "running",
        stepIndex: 5,
        stepTotal: 8,
        message: "正在生成分镜。",
      },
    }).success).toBe(true);
  });

  it("rejects incomplete or out-of-range workflow step presentation", () => {
    expect(WorkflowStepProgressSchema.safeParse({
      stepId: "future-node",
      stepLabel: "未来节点",
      stepState: "running",
      stepIndex: 9,
      stepTotal: 8,
      message: "正在执行。",
    }).success).toBe(false);
    expect(VideoWorkflowEventSchema.safeParse({
      eventId: "event-2",
      sequence: 2,
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      timestamp: new Date().toISOString(),
      type: "agent.step",
      data: {
        status: "drafting",
        stepId: "scene-plan",
        message: "Missing presentation fields",
      },
    }).success).toBe(false);
  });

  it("validates redacted tool activity while keeping legacy message compatibility", () => {
    const toolActivity = {
      toolName: "search-assets",
      toolLabel: "\u7d20\u6750\u68c0\u7d22",
      state: "running" as const,
      summary: "\u6b63\u5728\u68c0\u7d22\u53ef\u7528\u7d20\u6750\u2026",
    };
    const progress = {
      stepId: "assets",
      stepLabel: "\u7d20\u6750\u89c4\u5212",
      stepState: "running" as const,
      stepIndex: 6,
      stepTotal: 8,
      message: toolActivity.summary,
      toolActivity,
    };

    expect(WorkflowStepProgressSchema.parse(progress).toolActivity).toEqual(toolActivity);
    expect(WorkflowStepProgressSchema.safeParse({
      ...progress,
      message: "A different legacy message",
    }).success).toBe(false);
    expect(WorkflowStepProgressSchema.safeParse({
      ...progress,
      toolActivity: { ...toolActivity, summary: "" },
    }).success).toBe(false);
    expect(WorkflowStepProgressSchema.safeParse({
      ...progress,
      toolActivity: { ...toolActivity, input: { token: "secret" } },
    }).success).toBe(false);
    expect(WorkflowStepProgressSchema.safeParse({
      ...progress,
      toolActivity: { ...toolActivity, state: "waiting" },
    }).success).toBe(false);

    expect(VideoWorkflowEventSchema.safeParse({
      eventId: "event-tool-1",
      sequence: 3,
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      timestamp: new Date().toISOString(),
      type: "agent.step",
      data: { status: "drafting", ...progress },
    }).success).toBe(true);
  });

  it("accepts a queue position on queued job progress and rejects negative positions", () => {
    const event = {
      eventId: "event-queue-1",
      sequence: 3,
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      timestamp: new Date().toISOString(),
      type: "job.progress" as const,
      data: {
        jobId: "job-1",
        status: "queued" as const,
        progress: 0,
        queueAhead: 4,
      },
    };
    expect(VideoWorkflowEventSchema.parse(event).data).toMatchObject({ queueAhead: 4 });
    expect(VideoWorkflowEventSchema.safeParse({
      ...event,
      data: { ...event.data, queueAhead: -1 },
    }).success).toBe(false);
  });

  it("validates the Seedance submission task identifier", () => {
    expect(ApimartVideoSubmissionSchema.parse({ code: 200, data: [{ status: "submitted", task_id: "task_123" }] }).data[0]?.task_id).toBe("task_123");
  });

  it("accepts only supported video models, omits client duration, and keeps old queued jobs compatible", () => {
    expect(CreateVideoWorkflowRequestSchema.parse({
      messageId: "message-1",
      prompt: "生成一段雨夜短片",
      videoModel: "MiniMax-Hailuo-2.3",
    }).videoModel).toBe("MiniMax-Hailuo-2.3");
    expect(CreateVideoWorkflowRequestSchema.safeParse({
      messageId: "message-1",
      prompt: "生成一段雨夜短片",
      videoModel: "MiniMax-Hailuo-2.3",
      durationSeconds: 10,
    }).success).toBe(false);
    expect(CreateVideoWorkflowRequestSchema.safeParse({
      messageId: "message-1",
      prompt: "生成一段雨夜短片",
      videoModel: "unknown-model",
    }).success).toBe(false);
    expect(RenderVideoJobPayloadSchema.parse({
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      jobId: "job-1",
      storyboardVersion: 1,
      videoPrompt: "Rainy night",
      objectKey: "tenant/demo/project/demo/render/job-1/video.mp4",
    }).videoModel).toBe("doubao-seedance-2.0");
    expect(UpdateVideoWorkflowModelRequestSchema.parse({
      videoModel: "doubao-seedance-2.0",
    }).videoModel).toBe("doubao-seedance-2.0");
  });

  it("validates explicit video recovery responses", () => {
    expect(RetryVideoWorkflowResponseSchema.parse({ accepted: true, jobId: "workflow-version-1" }))
      .toEqual({ accepted: true, jobId: "workflow-version-1" });
    expect(RetryVideoWorkflowResponseSchema.safeParse({ accepted: false, jobId: "workflow-version-1" }).success)
      .toBe(false);
    expect(RecoverVideoWorkflowResponseSchema.parse({
      accepted: true,
      workflowId: "00000000-0000-4000-8000-000000000001",
    })).toMatchObject({ accepted: true });
  });

  it("validates persisted workflow assistant completion notifications", () => {
    expect(VideoWorkflowEventSchema.safeParse({
      eventId: "event-message-1",
      sequence: 3,
      workflowId: "00000000-0000-4000-8000-000000000001",
      requestId: "00000000-0000-4000-8000-000000000002",
      timestamp: new Date().toISOString(),
      type: "message.completed",
      data: { messageId: "cycle-1:fallback" },
    }).success).toBe(true);
  });
});
