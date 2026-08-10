import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { VideoWorkflowEventSchema, type VideoWorkflowEvent } from "@chat-to-video/contracts";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import { Redis } from "ioredis";

import { loadRedisUrl } from "./video-workflow.config.js";
import { VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";

type EventListener = (event: VideoWorkflowEvent) => void;

@Injectable()
export class WorkflowEventService implements OnModuleDestroy {
  private readonly publisher = new Redis(loadRedisUrl(), { maxRetriesPerRequest: 1 });
  private readonly subscriber = new Redis(loadRedisUrl(), { maxRetriesPerRequest: 1 });
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(@Inject(VIDEO_WORKFLOW_REPOSITORY) private readonly repository: VideoWorkflowRepository) {
    this.subscriber.on("message", (channel: string, message: string) => {
      const workflowId = channel.replace(/^video-workflow:/u, "");
      let decoded: unknown;
      try {
        decoded = JSON.parse(message) as unknown;
      } catch {
        return;
      }
      const parsed = VideoWorkflowEventSchema.safeParse(decoded);
      if (!parsed.success) return;
      for (const listener of this.listeners.get(workflowId) ?? []) listener(parsed.data);
    });
  }

  async append(input: {
    workflowId: string;
    requestId: string;
    type: VideoWorkflowEvent["type"];
    data: VideoWorkflowEvent["data"];
  }): Promise<VideoWorkflowEvent> {
    const event = await this.repository.appendEvent(input);
    await this.publisher.publish(`video-workflow:${input.workflowId}`, JSON.stringify(event));
    return event;
  }

  async listen(workflowId: string, listener: EventListener): Promise<() => Promise<void>> {
    let workflowListeners = this.listeners.get(workflowId);
    if (!workflowListeners) {
      workflowListeners = new Set();
      this.listeners.set(workflowId, workflowListeners);
      await this.subscriber.subscribe(`video-workflow:${workflowId}`);
    }
    workflowListeners.add(listener);
    return async () => {
      const current = this.listeners.get(workflowId);
      current?.delete(listener);
      if (current?.size === 0) {
        this.listeners.delete(workflowId);
        await this.subscriber.unsubscribe(`video-workflow:${workflowId}`);
      }
    };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}
