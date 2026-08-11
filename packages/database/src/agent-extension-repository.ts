import { and, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { agentExtensionExecutions } from "./schema.js";

export type NewAgentExtensionExecution = {
  id: string;
  callKey: string;
  requestId: string;
  workflowId?: string;
  conversationId?: string;
  agentId: string;
  stage?: string;
  extensionKind: "skill" | "tool";
  extensionId: string;
  attempt: number;
  activitySequence: number;
  inputSummary?: string;
};

export class AgentExtensionRepository {
  constructor(private readonly database: Database) {}

  async start(input: NewAgentExtensionExecution): Promise<void> {
    await this.database.insert(agentExtensionExecutions).values({
      ...input,
      status: "running",
    }).onDuplicateKeyUpdate({ set: { callKey: input.callKey } });
  }

  async complete(callKey: string, values: {
    durationMs: number;
    estimatedCostUsd?: number;
  }): Promise<void> {
    await this.database.update(agentExtensionExecutions).set({
      status: "completed",
      durationMs: values.durationMs,
      estimatedCostUsd: values.estimatedCostUsd,
      completedAt: new Date(),
    }).where(and(
      eq(agentExtensionExecutions.callKey, callKey),
      eq(agentExtensionExecutions.status, "running"),
    ));
  }

  async fail(callKey: string, values: {
    durationMs: number;
    errorCode: string;
  }): Promise<void> {
    await this.database.update(agentExtensionExecutions).set({
      status: "failed",
      durationMs: values.durationMs,
      errorCode: values.errorCode,
      completedAt: new Date(),
    }).where(and(
      eq(agentExtensionExecutions.callKey, callKey),
      eq(agentExtensionExecutions.status, "running"),
    ));
  }
}
