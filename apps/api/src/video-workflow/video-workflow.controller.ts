import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Res,
} from "@nestjs/common";
import {
  CreateVideoWorkflowRequestSchema,
  type RetryVideoWorkflowResponse,
  UpdateVideoWorkflowModelRequestSchema,
  VideoWorkflowEventSchema,
  VideoWorkflowIdSchema,
  VideoWorkflowInteractionSchema,
  type CreateVideoWorkflowResponse,
  type UpdateVideoWorkflowModelResponse,
  type VideoWorkflowInteractionResult,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";

import { VideoWorkflowService } from "./video-workflow.service.js";
import { VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";

const parseWorkflowId = (value: unknown): string => {
  const parsed = VideoWorkflowIdSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ code: "INVALID_VIDEO_WORKFLOW_ID", message: "Video workflow ID is invalid." });
  return parsed.data;
};

@Controller("video-workflows")
export class VideoWorkflowController {
  constructor(
    @Inject(VideoWorkflowService) private readonly workflows: VideoWorkflowService,
    @Inject(WorkflowEventService) private readonly events: WorkflowEventService,
    @Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() body: unknown): Promise<CreateVideoWorkflowResponse> {
    const parsed = CreateVideoWorkflowRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: "INVALID_VIDEO_WORKFLOW_REQUEST", message: "Video workflow request is invalid.", issues: parsed.error.issues });
    return this.workflows.create(parsed.data);
  }

  @Get(":workflowId")
  getSnapshot(@Param("workflowId") workflowId: unknown): Promise<VideoWorkflowSnapshot> {
    return this.workflows.getSnapshot(parseWorkflowId(workflowId));
  }

  @Patch(":workflowId/model")
  async updateModel(
    @Param("workflowId") workflowId: unknown,
    @Body() body: unknown,
  ): Promise<UpdateVideoWorkflowModelResponse> {
    const parsed = UpdateVideoWorkflowModelRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_VIDEO_MODEL_REQUEST",
        message: "Video model request is invalid.",
        issues: parsed.error.issues,
      });
    }
    return this.workflows.updateModel(parseWorkflowId(workflowId), parsed.data.videoModel);
  }

  @Post(":workflowId/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@Param("workflowId") workflowId: unknown): Promise<RetryVideoWorkflowResponse> {
    return this.workflows.retry(parseWorkflowId(workflowId));
  }

  @Post(":workflowId/interactions")
  @HttpCode(HttpStatus.ACCEPTED)
  async interact(@Param("workflowId") workflowId: unknown, @Body() body: unknown): Promise<VideoWorkflowInteractionResult> {
    const parsed = VideoWorkflowInteractionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: "INVALID_VIDEO_WORKFLOW_INTERACTION", message: "Video workflow interaction is invalid.", issues: parsed.error.issues });
    return this.workflows.interact(parseWorkflowId(workflowId), parsed.data);
  }

  @Get(":workflowId/events")
  async streamEvents(
    @Param("workflowId") workflowIdValue: unknown,
    @Headers("last-event-id") lastEventId: string | undefined,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const workflowId = parseWorkflowId(workflowIdValue);
    const snapshot = await this.workflows.getSnapshot(workflowId);
    const cursor = lastEventId && /^\d+$/u.test(lastEventId) ? Number(lastEventId) : 0;
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    let latestSequence = cursor;
    const writeEvent = (event: unknown): void => {
      const parsed = VideoWorkflowEventSchema.parse(event);
      const isEphemeral = parsed.type === "workflow.snapshot" || parsed.type === "heartbeat";
      if (!isEphemeral && parsed.sequence <= latestSequence) return;
      latestSequence = Math.max(latestSequence, parsed.sequence);
      response.write(`id: ${parsed.sequence}\nevent: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`);
    };
    const stopListening = await this.events.listen(workflowId, writeEvent);
    writeEvent({
      eventId: randomUUID(),
      sequence: latestSequence,
      workflowId,
      requestId: snapshot.requestId,
      type: "workflow.snapshot",
      timestamp: new Date().toISOString(),
      data: snapshot,
    });
    for (const event of await this.repository.listEvents(workflowId, cursor)) writeEvent(event);

    const heartbeat = setInterval(() => writeEvent({
      eventId: randomUUID(),
      sequence: latestSequence,
      workflowId,
      requestId: snapshot.requestId,
      type: "heartbeat",
      timestamp: new Date().toISOString(),
      data: {},
    }), 15_000);
    await new Promise<void>((resolve) => {
      response.once("close", () => {
        clearInterval(heartbeat);
        void stopListening().finally(resolve);
      });
    });
  }
}
