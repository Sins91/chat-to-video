import { Injectable } from "@nestjs/common";
import {
  CINEMATIC_PIPELINE_DEFINITION,
  CinematicGenerativeStageSchema,
  findWorkflowStage,
  type CinematicGenerativeStage,
} from "@chat-to-video/contracts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  CINEMATIC_SKILL_TEMPLATE_DEFINITIONS,
  isCinematicSkillTemplateStage,
  type CinematicSkillTemplateId,
} from "./cinematic-skill-template.registry.js";

export const CHAT_CAPABILITIES_SKILL_ID = "cinematic-capabilities";
export const CINEMATIC_GOVERNANCE_SKILL_ID = "cinematic-governance";
export const CINEMATIC_REVIEWER_SKILL_ID = "cinematic-reviewer";
export const CINEMATIC_COMPOSE_SKILL_ID = "cinematic-compose";
export const CINEMATIC_REFERENCE_ANALYST_SKILL_ID = "cinematic-reference-analyst";
export const CINEMATIC_FINAL_REVIEW_SKILL_ID = "cinematic-final-review";
export const CINEMATIC_PUBLISH_SKILL_ID = "cinematic-publish";

export const CINEMATIC_DEFERRED_STAGE_SKILL_IDS = Object.freeze({
  final_review: CINEMATIC_FINAL_REVIEW_SKILL_ID,
  publish: CINEMATIC_PUBLISH_SKILL_ID,
});

export const getCinematicStageSkillId = (
  stage: CinematicGenerativeStage,
): string => {
  const skillId = findWorkflowStage(
    CINEMATIC_PIPELINE_DEFINITION,
    stage,
  )?.stageSkillId;
  if (!skillId) {
    throw new Error("Cinematic stage Skill is not registered: " + stage + ".");
  }
  return skillId;
};

export const CINEMATIC_STAGE_SKILL_IDS = Object.freeze(
  Object.fromEntries(
    CinematicGenerativeStageSchema.options.map((stage) => [
      stage,
      getCinematicStageSkillId(stage),
    ]),
  ) as Record<CinematicGenerativeStage, string>,
);

export const ALL_CINEMATIC_SKILL_IDS = Object.freeze([
  CINEMATIC_GOVERNANCE_SKILL_ID,
  CHAT_CAPABILITIES_SKILL_ID,
  CINEMATIC_REFERENCE_ANALYST_SKILL_ID,
  ...Object.values(CINEMATIC_STAGE_SKILL_IDS),
  CINEMATIC_COMPOSE_SKILL_ID,
  ...CINEMATIC_SKILL_TEMPLATE_DEFINITIONS.map((definition) => definition.skillId),
  CINEMATIC_REVIEWER_SKILL_ID,
]);

const agentSkillRootCandidates = (moduleDirectory: string): string[] => [
  // Source execution and deployments that colocate assets with compiled JS.
  resolve(moduleDirectory, "skills"),
  // Nest SWC currently emits JS under dist/src while copying assets under dist.
  resolve(moduleDirectory, "..", "..", "agent-extensions", "skills"),
];

export const resolveAgentSkillRoot = (
  moduleDirectory: string = import.meta.dirname,
  isFileAvailable: (path: string) => boolean = existsSync,
): string => {
  const skillRoot = agentSkillRootCandidates(moduleDirectory).find((candidate) =>
    ALL_CINEMATIC_SKILL_IDS.every((skillId) =>
      isFileAvailable(resolve(candidate, skillId, "SKILL.md"))
    )
  );
  if (!skillRoot) {
    throw new Error("Packaged cinematic Agent skill assets are unavailable.");
  }
  return skillRoot;
};

@Injectable()
export class AgentSkillCatalog {
  private readonly skillPaths = new Map<string, string>();

  constructor() {
    const skillRoot = resolveAgentSkillRoot();
    for (const skillId of ALL_CINEMATIC_SKILL_IDS) {
      this.skillPaths.set(skillId, resolve(skillRoot, skillId));
    }
  }

  forChat(): string[] {
    return [
      this.getRequiredPath(CINEMATIC_GOVERNANCE_SKILL_ID),
      this.getRequiredPath(CHAT_CAPABILITIES_SKILL_ID),
      this.getRequiredPath(CINEMATIC_REFERENCE_ANALYST_SKILL_ID),
    ];
  }

  forCinematic(
    stage: CinematicGenerativeStage,
    templateSkillId?: CinematicSkillTemplateId,
  ): string[] {
    const stageSkillId = templateSkillId &&
        isCinematicSkillTemplateStage(templateSkillId, stage)
      ? templateSkillId
      : CINEMATIC_STAGE_SKILL_IDS[stage];
    return [
      this.getRequiredPath(CINEMATIC_GOVERNANCE_SKILL_ID),
      this.getRequiredPath(stageSkillId),
      ...(stage === "research"
        ? [this.getRequiredPath(CINEMATIC_REFERENCE_ANALYST_SKILL_ID)]
        : []),
      this.getRequiredPath(CINEMATIC_REVIEWER_SKILL_ID),
    ];
  }

  private getRequiredPath(skillId: string): string {
    const skillPath = this.skillPaths.get(skillId);
    if (!skillPath) throw new Error(`Agent skill is not registered: ${skillId}.`);
    return skillPath;
  }
}
