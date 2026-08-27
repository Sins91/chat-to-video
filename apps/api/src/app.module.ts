import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AppController } from "./app.controller.js";
import { ChatAgentController } from "./chat-agent.controller.js";
import { ChatAgentService } from "./chat-agent.service.js";
import { ConversationModule } from "./conversation/conversation.module.js";
import { DatabaseSchemaExceptionFilter } from "./database-schema-exception.filter.js";
import { InternalAccessGuard } from "./internal-auth/internal-access.guard.js";
import { ModelGatewayModule } from "./model-gateway/model-gateway.module.js";
import { ReferenceImageModule } from "./reference-image/reference-image.module.js";
import { VideoWorkflowModule } from "./video-workflow/video-workflow.module.js";

@Module({
  imports: [ConversationModule, ModelGatewayModule, ReferenceImageModule, VideoWorkflowModule],
  controllers: [
    AppController,
    ChatAgentController,
  ],
  providers: [
    ChatAgentService,
    {
      provide: APP_FILTER,
      useClass: DatabaseSchemaExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: InternalAccessGuard,
    },
  ],
})
export class AppModule {}
