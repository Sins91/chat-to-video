import { Module } from "@nestjs/common";
import { WorkflowModule } from "@workflow/nest";

import { AppController } from "./app.controller.js";
import { ChatAgentController } from "./chat-agent.controller.js";
import { ChatAgentService } from "./chat-agent.service.js";
import { ApimartModelGateway } from "./model-gateway/apimart-model-gateway.js";
import { MODEL_GATEWAY } from "./model-gateway/model-gateway.js";
import { WorkflowValidationController } from "./workflow-validation.controller.js";
import { WorkflowValidationService } from "./workflow-validation.service.js";

@Module({
  imports: [WorkflowModule.forRoot()],
  controllers: [
    AppController,
    ChatAgentController,
    WorkflowValidationController,
  ],
  providers: [
    ApimartModelGateway,
    ChatAgentService,
    WorkflowValidationService,
    { provide: MODEL_GATEWAY, useExisting: ApimartModelGateway },
  ],
})
export class AppModule {}
