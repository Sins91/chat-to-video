import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  CreateVideoWorkflowResponseSchema,
  StoryboardVersionSchema,
  VideoWorkflowInteractionResultSchema,
  VideoWorkflowSnapshotSchema,
  type CreateVideoWorkflowResponse,
  type VideoWorkflowInteraction,
  type VideoWorkflowInteractionResult,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import type { ObjectStorage } from "@chat-to-video/storage";
import { randomUUID } from "node:crypto";
import { resumeHook, start } from "workflow/api";

import { videoCreationWorkflow } from "../workflows/video-creation.workflow.js";
import { VIDEO_OBJECT_STORAGE, VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";

const APPROVAL_PHRASES = new Set(["继续", "可以继续", "确认", "确认生成", "开始生成", "生成视频", "没问题继续"]);

const messageIntent = (message: string): "approve" | "revise" => {
  const normalized = message.normalize("NFKC").replace(/[\s，。！？!?,.]/gu, "");
  return APPROVAL_PHRASES.has(normalized) ? "approve" : "revise";
};

@Injectable()
export class VideoWorkflowService {
  constructor(
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
    @Inject(VIDEO_OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async create(initialPrompt: string): Promise<CreateVideoWorkflowResponse> {
    const workflowId = randomUUID();
    const requestId = randomUUID();
    await this.repository.createWorkflow({ id: workflowId, requestId, initialPrompt });
    const run = await start(videoCreationWorkflow, [{ workflowId, requestId, initialPrompt }]);
    await this.repository.setRunId(workflowId, run.runId);
    return CreateVideoWorkflowResponseSchema.parse({ workflowId, requestId });
  }

  async getSnapshot(workflowId: string): Promise<VideoWorkflowSnapshot> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
    const [storyboardRow, job] = await Promise.all([
      this.repository.findLatestStoryboard(workflowId),
      this.repository.findWorkflowVideoJob(workflowId),
    ]);
    const output = job ? await this.repository.findVideoOutput(job.id) : null;
    const playbackUrl = output ? await this.storage.createDownloadUrl(output.objectKey) : null;
    return VideoWorkflowSnapshotSchema.parse({
      workflowId: workflow.id,
      requestId: workflow.requestId,
      initialPrompt: workflow.initialPrompt,
      status: workflow.status,
      currentVersion: workflow.currentVersion,
      storyboard: storyboardRow ? StoryboardVersionSchema.parse({
        version: storyboardRow.version,
        revisionRequest: storyboardRow.revisionRequest,
        storyboard: storyboardRow.storyboard,
        createdAt: storyboardRow.createdAt.toISOString(),
      }) : null,
      videoJob: job ? {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        providerTaskId: job.providerTaskId,
        errorMessage: job.errorMessage,
        playbackUrl,
      } : null,
      errorMessage: workflow.errorMessage,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    });
  }

  async interact(workflowId: string, interaction: VideoWorkflowInteraction): Promise<VideoWorkflowInteractionResult> {
    const workflow = await this.repository.findWorkflow(workflowId);
    if (!workflow) throw new NotFoundException({ code: "VIDEO_WORKFLOW_NOT_FOUND", message: "Video workflow not found." });
    if (workflow.status !== "awaiting_input" || workflow.currentVersion < 1) {
      throw new ConflictException({ code: "VIDEO_WORKFLOW_NOT_WAITING", message: "The workflow is not waiting for review input." });
    }
    const intent = interaction.type === "approve" ? "approve" : messageIntent(interaction.text);
    const payload: VideoWorkflowInteraction = intent === "approve" ? { type: "approve" } : interaction;
    await resumeHook(`video-workflow:${workflowId}:review:${workflow.currentVersion}`, payload);
    return VideoWorkflowInteractionResultSchema.parse({ accepted: true, intent });
  }
}
