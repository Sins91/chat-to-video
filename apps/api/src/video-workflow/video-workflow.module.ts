import { Module } from "@nestjs/common";
import { ObjectStorage } from "@chat-to-video/storage";

import { DatabaseModule } from "../database.module.js";
import { ModelGatewayModule } from "../model-gateway/model-gateway.module.js";
import { MastraRuntimeService } from "./mastra-runtime.service.js";
import { VideoWorkflowController } from "./video-workflow.controller.js";
import { loadStorageConfig } from "./video-workflow.config.js";
import { VideoWorkflowService } from "./video-workflow.service.js";
import { MASTRA_RUNTIME, VIDEO_OBJECT_STORAGE } from "./video-workflow.tokens.js";
import { WorkflowEventService } from "./workflow-event.service.js";
import { VideoWorkflowOperations } from "./video-workflow.operations.js";

@Module({
  imports: [DatabaseModule, ModelGatewayModule],
  controllers: [VideoWorkflowController],
  providers: [
    VideoWorkflowService,
    WorkflowEventService,
    VideoWorkflowOperations,
    MastraRuntimeService,
    { provide: MASTRA_RUNTIME, useExisting: MastraRuntimeService },
    { provide: VIDEO_OBJECT_STORAGE, useFactory: () => new ObjectStorage(loadStorageConfig()) },
  ],
  exports: [VideoWorkflowService],
})
export class VideoWorkflowModule {}
