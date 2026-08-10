import { Module } from "@nestjs/common";

import { AppController } from "./app.controller.js";
import { ChatAgentController } from "./chat-agent.controller.js";
import { ChatAgentService } from "./chat-agent.service.js";
import { ConversationModule } from "./conversation/conversation.module.js";
import { ModelGatewayModule } from "./model-gateway/model-gateway.module.js";
import { VideoWorkflowModule } from "./video-workflow/video-workflow.module.js";

@Module({
  imports: [ConversationModule, ModelGatewayModule, VideoWorkflowModule],
  controllers: [
    AppController,
    ChatAgentController,
  ],
  providers: [
    ChatAgentService,
  ],
})
export class AppModule {}
