import { Module } from "@nestjs/common";

import { ApimartAccountController } from "./apimart-account.controller.js";
import { ApimartAccountService } from "./apimart-account.service.js";
import { APIMART_CONFIG, loadApimartConfig } from "./apimart.config.js";
import { ApimartModelGateway } from "./apimart-model-gateway.js";
import { createMastraAgents, MASTRA_AGENTS } from "./mastra-agents.js";
import { MODEL_GATEWAY } from "./model-gateway.js";

@Module({
  controllers: [ApimartAccountController],
  providers: [
    { provide: APIMART_CONFIG, useFactory: loadApimartConfig },
    {
      provide: MASTRA_AGENTS,
      useFactory: createMastraAgents,
      inject: [APIMART_CONFIG],
    },
    ApimartAccountService,
    ApimartModelGateway,
    { provide: MODEL_GATEWAY, useExisting: ApimartModelGateway },
  ],
  exports: [MASTRA_AGENTS, MODEL_GATEWAY],
})
export class ModelGatewayModule {}
