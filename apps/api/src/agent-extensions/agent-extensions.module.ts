import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database.module.js";
import { AgentExtensionAuditService } from "./agent-extension-audit.service.js";
import { AgentSkillCatalog } from "./agent-skill.catalog.js";

@Module({
  imports: [DatabaseModule],
  providers: [AgentExtensionAuditService, AgentSkillCatalog],
  exports: [AgentExtensionAuditService, AgentSkillCatalog],
})
export class AgentExtensionsModule {}
