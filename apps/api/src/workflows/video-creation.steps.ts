import {
  RenderVideoJobPayloadSchema,
  StoryboardSchema,
  type RenderVideoJobPayload,
  type Storyboard,
  type VideoWorkflowCompletion,
  type VideoWorkflowEvent,
} from "@chat-to-video/contracts";
import { createDatabase, VideoWorkflowRepository } from "@chat-to-video/database";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { FatalError } from "workflow";

import { ApimartModelGateway } from "../model-gateway/apimart-model-gateway.js";
import { ModelGatewayError } from "../model-gateway/model-gateway.js";

type WorkflowInput = { workflowId: string; requestId: string; initialPrompt: string };

const databaseUrl = (): string => {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL must be configured.");
  return value;
};

const redisUrl = (): string => {
  const value = process.env.REDIS_URL?.trim();
  if (!value) throw new Error("REDIS_URL must be configured.");
  return value;
};

const repository = (): VideoWorkflowRepository => new VideoWorkflowRepository(createDatabase(databaseUrl()));

const appendEvent = async (input: {
  workflowId: string;
  requestId: string;
  type: VideoWorkflowEvent["type"];
  data: VideoWorkflowEvent["data"];
}): Promise<void> => {
  const event = await repository().appendEvent(input);
  const publisher = new Redis(redisUrl(), { maxRetriesPerRequest: 1 });
  try {
    await publisher.publish(`video-workflow:${input.workflowId}`, JSON.stringify(event));
  } finally {
    await publisher.quit();
  }
};

export async function generateStoryboardStep(input: WorkflowInput & {
  version: number;
  previousStoryboard?: Storyboard;
  revisionRequest?: string;
}): Promise<Storyboard> {
  "use step";

  const workflows = repository();
  await workflows.updateWorkflow(input.workflowId, { status: "drafting", errorMessage: null });
  await appendEvent({
    workflowId: input.workflowId,
    requestId: input.requestId,
    type: "agent.step",
    data: { status: "drafting", message: input.version === 1 ? "正在整理创意并生成分镜" : "正在根据修改意见生成新分镜" },
  });
  let storyboard: Storyboard;
  try {
    storyboard = StoryboardSchema.parse(await new ApimartModelGateway().generateStoryboard({
      requestId: input.requestId,
      initialPrompt: input.initialPrompt,
      previousStoryboard: input.previousStoryboard,
      revisionRequest: input.revisionRequest,
    }));
  } catch (error: unknown) {
    if (error instanceof ModelGatewayError && !error.isRetryable) {
      throw new FatalError(error.message);
    }
    throw error;
  }
  await workflows.saveStoryboard({
    workflowId: input.workflowId,
    version: input.version,
    revisionRequest: input.revisionRequest ?? null,
    storyboard,
  });
  return storyboard;
}

export async function activateStoryboardStep(input: WorkflowInput & { version: number; storyboard: Storyboard; revisionRequest?: string }): Promise<void> {
  "use step";

  const workflows = repository();
  await workflows.updateWorkflow(input.workflowId, { status: "awaiting_input", currentVersion: input.version, errorMessage: null });
  const createdAt = new Date().toISOString();
  await appendEvent({
    workflowId: input.workflowId,
    requestId: input.requestId,
    type: "storyboard.completed",
    data: {
      version: input.version,
      revisionRequest: input.revisionRequest ?? null,
      storyboard: input.storyboard,
      createdAt,
    },
  });
  await appendEvent({
    workflowId: input.workflowId,
    requestId: input.requestId,
    type: "agent.step",
    data: { status: "awaiting_input", message: "分镜已完成，请确认生成或继续提出修改" },
  });
}

export async function enqueueVideoStep(payload: RenderVideoJobPayload): Promise<void> {
  "use step";

  const parsed = RenderVideoJobPayloadSchema.parse(payload);
  const workflows = repository();
  await workflows.createVideoJob({
    id: parsed.jobId,
    workflowId: parsed.workflowId,
    storyboardVersion: parsed.storyboardVersion,
    objectKey: parsed.objectKey,
  });
  const connection = new Redis(redisUrl(), { maxRetriesPerRequest: 1 });
  const queue = new Queue<RenderVideoJobPayload>("render-jobs", { connection });
  try {
    await queue.add("generate-video", parsed, {
      jobId: parsed.jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  } finally {
    await queue.close();
    await connection.quit();
  }
  await appendEvent({
    workflowId: parsed.workflowId,
    requestId: parsed.requestId,
    type: "job.progress",
    data: { jobId: parsed.jobId, status: "queued", progress: 0 },
  });
}

export async function completeWorkflowStep(input: WorkflowInput & { completion: VideoWorkflowCompletion }): Promise<void> {
  "use step";

  await repository().updateWorkflow(input.workflowId, {
    status: input.completion.status,
    errorMessage: input.completion.status === "failed" ? input.completion.message : null,
  });
}

export async function failWorkflowStep(input: WorkflowInput & { message: string }): Promise<void> {
  "use step";

  await repository().updateWorkflow(input.workflowId, { status: "failed", errorMessage: input.message });
  await appendEvent({
    workflowId: input.workflowId,
    requestId: input.requestId,
    type: "agent.step",
    data: { status: "failed", message: input.message },
  });
}
