import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database.module.js";
import { VideoWorkflowModule } from "../video-workflow/video-workflow.module.js";
import { ConversationController } from "./conversation.controller.js";
import { ConversationService } from "./conversation.service.js";

@Module({
  imports: [DatabaseModule, VideoWorkflowModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
