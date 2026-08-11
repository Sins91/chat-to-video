import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database.module.js";
import { AgentExtensionAuditService } from "./agent-extension-audit.service.js";
import { AgentSkillCatalog } from "./agent-skill.catalog.js";
import { AgentToolRegistry } from "./agent-tool.registry.js";

@Module({
  imports: [DatabaseModule],
  providers: [AgentExtensionAuditService, AgentSkillCatalog, AgentToolRegistry],
  exports: [AgentExtensionAuditService, AgentSkillCatalog, AgentToolRegistry],
})
export class AgentExtensionsModule {}
