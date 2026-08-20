import type { AgentExtensionRepository } from "@chat-to-video/database";
import { describe, expect, it, vi } from "vitest";

import { AgentExtensionAuditService } from "../src/agent-extensions/agent-extension-audit.service.js";

const context = {
  requestId: "00000000-0000-4000-8000-000000000001",
  conversationId: "00000000-0000-4000-8000-000000000002",
  tenantId: "tenant-1",
  projectId: "project-1",
  agentId: "chat-default" as const,
};

describe("AgentExtensionAuditService", () => {
  it("records only safe metadata and estimated cost", async () => {
    const repository = {
      start: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AgentExtensionAuditService(
      repository as unknown as AgentExtensionRepository,
    );

    const handle = await service.start({
      context,
      toolName: "estimate_cinematic_cost",
      toolInput: { model: "doubao-seedance-2.0", secret: "not-persisted" },
      attempt: 1,
      activitySequence: 1,
    });
    await service.complete(handle, { status: "estimated", amountUsd: 1.25 });

    expect(repository.start).toHaveBeenCalledWith(expect.objectContaining({
      extensionKind: "tool",
      extensionId: "estimate_cinematic_cost",
      inputSummary: "fields=model",
    }));
    expect(JSON.stringify(repository.start.mock.calls)).not.toContain("not-persisted");
    expect(repository.complete).toHaveBeenCalledWith(handle.callKey, expect.objectContaining({
      estimatedCostUsd: 1.25,
    }));
  });

  it("classifies native Mastra skill calls and records a redacted failure code", async () => {
    const repository = {
      start: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AgentExtensionAuditService(
      repository as unknown as AgentExtensionRepository,
    );
    const handle = await service.start({
      context,
      toolName: "skill_read",
      toolInput: { skillName: "cinematic-capabilities" },
      attempt: 1,
      activitySequence: 1,
    });
    await service.fail(handle, new TypeError("sensitive detail"));

    expect(repository.start).toHaveBeenCalledWith(expect.objectContaining({
      extensionKind: "skill",
      extensionId: "cinematic-capabilities",
    }));
    expect(repository.fail).toHaveBeenCalledWith(handle.callKey, expect.objectContaining({
      errorCode: "TypeError",
    }));
  });

  it("records prompt compression counts without persisting prompt content", async () => {
    const repository = {
      start: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const service = new AgentExtensionAuditService(
      repository as unknown as AgentExtensionRepository,
    );
    const handle = await service.start({
      context,
      toolName: "prompt_compressor",
      toolInput: {
        prompt: "PRIVATE_PROMPT_CONTENT".repeat(60),
        purpose: "asset_generation",
        maxCharacters: 1_000,
      },
      attempt: 1,
      activitySequence: 101,
    });
    await service.complete(handle, {
      compressedCharacters: 640,
      wasCompressed: true,
    });

    const started = repository.start.mock.calls[0]?.[0] as unknown;
    const completed = repository.complete.mock.calls[0]?.[1] as unknown;
    expect(typeof started === "object" && started !== null && "inputSummary" in started
      ? started.inputSummary
      : undefined).toContain("purpose=asset_generation");
    expect(typeof completed === "object" && completed !== null && "inputSummary" in completed
      ? completed.inputSummary
      : undefined).toContain("compressedCharacters=640");
    expect(JSON.stringify([
      repository.start.mock.calls,
      repository.complete.mock.calls,
    ])).not.toContain("PRIVATE_PROMPT_CONTENT");
  });
});
