import { Module } from "@nestjs/common";
import { WorkflowModule } from "@workflow/nest";

import { AppController } from "./app.controller.js";
import { ChatAgentController } from "./chat-agent.controller.js";
import { ChatAgentService } from "./chat-agent.service.js";
import { ApimartModelGateway } from "./model-gateway/apimart-model-gateway.js";
import { MODEL_GATEWAY } from "./model-gateway/model-gateway.js";
import { VideoWorkflowModule } from "./video-workflow/video-workflow.module.js";

@Module({
  imports: [WorkflowModule.forRoot(), VideoWorkflowModule],
  controllers: [
    AppController,
    ChatAgentController,
  ],
  providers: [
    ApimartModelGateway,
    ChatAgentService,
    { provide: MODEL_GATEWAY, useExisting: ApimartModelGateway },
  ],
})
export class AppModule {}
