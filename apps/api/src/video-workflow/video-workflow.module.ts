import { Module } from "@nestjs/common";
import { createDatabase, VideoWorkflowRepository } from "@chat-to-video/database";
import { ObjectStorage } from "@chat-to-video/storage";

import { VideoWorkflowController } from "./video-workflow.controller.js";
import { loadDatabaseUrl, loadStorageConfig } from "./video-workflow.config.js";
import { VideoWorkflowService } from "./video-workflow.service.js";
import { VIDEO_OBJECT_STORAGE, VIDEO_WORKFLOW_REPOSITORY } from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";

@Module({
  controllers: [VideoWorkflowController],
  providers: [
    VideoWorkflowService,
    WorkflowEventService,
    { provide: VIDEO_WORKFLOW_REPOSITORY, useFactory: () => new VideoWorkflowRepository(createDatabase(loadDatabaseUrl())) },
    { provide: VIDEO_OBJECT_STORAGE, useFactory: () => new ObjectStorage(loadStorageConfig()) },
  ],
})
export class VideoWorkflowModule {}
