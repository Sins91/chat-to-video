import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AgentExtensionRepository } from "@chat-to-video/database";
import { randomUUID } from "node:crypto";

import { AGENT_EXTENSION_REPOSITORY } from "../video-workflow/video-workflow.tokens.js";
import type { AgentExtensionRequestContext } from "./agent-extension.context.js";

export type AgentExtensionAuditHandle = {
  callKey: string;
  startedAt: number;
};

const SKILL_TOOL_NAMES = new Set(["skill", "skill_read", "skill_search"]);

const safeIdentifier = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/gu, "-").slice(0, 100);
  return normalized || undefined;
};

const getSkillId = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  for (const key of ["skillName", "skill", "name"]) {
    if (key in input) {
      const identifier = safeIdentifier(input[key as keyof typeof input]);
      if (identifier) return identifier;
    }
  }
  return undefined;
};

const summarizeInput = (input: unknown): string | undefined => {
  if (typeof input !== "object" || input === null) return undefined;
  const fields = Object.keys(input)
    .filter((key) => /^[a-zA-Z][a-zA-Z0-9_]*$/u.test(key))
    .filter((key) => !/(cookie|secret|signature|token|url)/iu.test(key))
    .sort()
    .slice(0, 12);
  return fields.length > 0 ? `fields=${fields.join(",")}` : undefined;
};

const estimatedCost = (output: unknown): number | undefined => {
  if (typeof output !== "object" || output === null || !("amountUsd" in output)) return undefined;
  return typeof output.amountUsd === "number" && Number.isFinite(output.amountUsd)
    ? output.amountUsd
    : undefined;
};

@Injectable()
export class AgentExtensionAuditService {
  private readonly logger = new Logger(AgentExtensionAuditService.name);

  constructor(
    @Inject(AGENT_EXTENSION_REPOSITORY)
    private readonly repository: AgentExtensionRepository,
  ) {}

  async start(input: {
    context: AgentExtensionRequestContext;
    toolName: string;
    toolInput: unknown;
    attempt: number;
    activitySequence: number;
  }): Promise<AgentExtensionAuditHandle> {
    const extensionKind = SKILL_TOOL_NAMES.has(input.toolName) ? "skill" : "tool";
    const extensionId = extensionKind === "skill"
      ? getSkillId(input.toolInput) ?? input.toolName
      : safeIdentifier(input.toolName) ?? "unknown-tool";
    const stage = input.context.agentId === "cinematic-stage-agent"
      ? input.context.stage
      : undefined;
    const callKey = [
      input.context.requestId,
      input.context.agentId,
      stage ?? "chat",
      `a${input.attempt}`,
      `e${input.activitySequence}`,
    ].join(":");
    try {
      await this.repository.start({
        id: randomUUID(),
        callKey,
        requestId: input.context.requestId,
        workflowId: input.context.agentId === "cinematic-stage-agent"
          ? input.context.workflowId
          : undefined,
        conversationId: input.context.conversationId,
        agentId: input.context.agentId,
        stage,
        extensionKind,
        extensionId,
        attempt: input.attempt,
        activitySequence: input.activitySequence,
        inputSummary: summarizeInput(input.toolInput),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Agent extension audit start failed requestId=${input.context.requestId} error=${error instanceof Error ? error.name : "unknown"}`,
      );
    }
    return { callKey, startedAt: performance.now() };
  }

  async complete(handle: AgentExtensionAuditHandle, output: unknown): Promise<void> {
    try {
      await this.repository.complete(handle.callKey, {
        durationMs: Math.max(0, Math.round(performance.now() - handle.startedAt)),
        estimatedCostUsd: estimatedCost(output),
      });
    } catch (error: unknown) {
      this.logger.warn(`Agent extension audit completion failed error=${error instanceof Error ? error.name : "unknown"}`);
    }
  }

  async fail(handle: AgentExtensionAuditHandle, error: unknown): Promise<void> {
    const errorCode = safeIdentifier(error instanceof Error ? error.name : "unknown") ?? "unknown";
    try {
      await this.repository.fail(handle.callKey, {
        durationMs: Math.max(0, Math.round(performance.now() - handle.startedAt)),
        errorCode,
      });
    } catch (auditError: unknown) {
      this.logger.warn(`Agent extension audit failure persistence failed error=${auditError instanceof Error ? auditError.name : "unknown"}`);
    }
  }
}
