import { Module } from "@nestjs/common";

import { AgentExtensionsModule } from "../agent-extensions/agent-extensions.module.js";
import { RESEARCH_TOOL_GATEWAY } from "../agent-extensions/research-tool-gateway.js";
import { AgentSkillCatalog } from "../agent-extensions/agent-skill.catalog.js";
import { AgentToolRegistry } from "../agent-extensions/agent-tool.registry.js";
import { DatabaseModule } from "../database.module.js";
import { ApimartResearchToolGateway } from "./apimart-research-tool-gateway.js";
import { ApimartAccountController } from "./apimart-account.controller.js";
import { ApimartAccountService } from "./apimart-account.service.js";
import { APIMART_CONFIG, loadApimartConfig } from "./apimart.config.js";
import { ApimartModelGateway } from "./apimart-model-gateway.js";
import { LLM_CONFIG, loadLlmConfig } from "./llm.config.js";
import { createMastraAgents, MASTRA_AGENTS } from "./mastra-agents.js";
import { MODEL_GATEWAY } from "./model-gateway.js";

@Module({
  imports: [AgentExtensionsModule, DatabaseModule],
  controllers: [ApimartAccountController],
  providers: [
    { provide: APIMART_CONFIG, useFactory: loadApimartConfig },
    {
      provide: LLM_CONFIG,
      useFactory: loadLlmConfig,
      inject: [APIMART_CONFIG],
    },
    ApimartResearchToolGateway,
    { provide: RESEARCH_TOOL_GATEWAY, useExisting: ApimartResearchToolGateway },
    AgentToolRegistry,
    {
      provide: MASTRA_AGENTS,
      useFactory: createMastraAgents,
      inject: [LLM_CONFIG, AgentSkillCatalog, AgentToolRegistry],
    },
    ApimartAccountService,
    ApimartModelGateway,
    { provide: MODEL_GATEWAY, useExisting: ApimartModelGateway },
  ],
  exports: [MASTRA_AGENTS, MODEL_GATEWAY],
})
export class ModelGatewayModule {}
