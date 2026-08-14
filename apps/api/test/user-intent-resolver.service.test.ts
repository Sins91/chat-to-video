import { CINEMATIC_PIPELINE_DEFINITION } from "@chat-to-video/contracts";
import { describe, expect, it, vi } from "vitest";

import type { ModelGateway } from "../src/model-gateway/model-gateway.js";
import {
  UserIntentResolverService,
  WORKFLOW_INTENT_CLARIFICATION_GUIDANCE,
} from "../src/video-workflow/user-intent-resolver.service.js";

const context = {
  requestId: "00000000-0000-4000-8000-000000000001",
  workflowId: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  tenantId: "demo",
  projectId: "demo",
  workflowStatus: "awaiting_input",
  currentStage: "scene_plan" as const,
  currentVersion: 4,
  currentArtifactSummary: "three scenes",
  pipeline: CINEMATIC_PIPELINE_DEFINITION,
};

describe("UserIntentResolverService", () => {
  it("uses deterministic approval rules without a paid model call", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn() };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolve({ ...context, text: "我看行" })).resolves.toMatchObject({
      source: "rule",
      intent: { type: "approve", stageId: "scene_plan" },
    });
    expect(gateway.classifyWorkflowIntent).not.toHaveBeenCalled();
  });

  it.each(["要的嘛", "阔以阔以"])("recognizes dialect approval %s without a paid model call", async (text) => {
    const gateway = { classifyWorkflowIntent: vi.fn() };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolve({ ...context, text })).resolves.toMatchObject({
      source: "rule",
      intent: { type: "approve", stageId: "scene_plan" },
    });
    expect(gateway.classifyWorkflowIntent).not.toHaveBeenCalled();
  });

  it("never auto-advances an approval that also requests changes", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn() };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolve({ ...context, text: "可以，但是第二个镜头换成近景" })).resolves.toMatchObject({
      intent: { type: "approve_with_changes", advanceAfterChange: false },
    });
  });

  it("auto-advances only an explicit proposal direction selection with a next-step request", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn() };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolve({
      ...context,
      currentStage: "proposal",
      text: "选择第二个方案，直接进入下一步",
    })).resolves.toMatchObject({
      source: "rule",
      intent: {
        type: "approve_with_changes",
        stageId: "proposal",
        advanceAfterChange: true,
      },
    });
    await expect(resolver.resolve({
      ...context,
      currentStage: "proposal",
      text: "选择第二个方案",
    })).resolves.toMatchObject({
      intent: { type: "revise_current" },
    });
    expect(gateway.classifyWorkflowIntent).not.toHaveBeenCalled();
  });

  it("rejects an invalid model-selected future restart stage", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn().mockResolvedValue({
      type: "restart_from", stageId: "assets", feedback: "go forward",
    }) };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolve({ ...context, text: "换个思路" })).resolves.toMatchObject({
      intent: { type: "clarify" },
    });
  });

  it("preserves a model-classified out-of-scope action", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn().mockResolvedValue({ type: "out_of_scope" }) };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolve({ ...context, text: "帮我发送一封营销邮件" })).resolves.toMatchObject({
      source: "model",
      intent: { type: "out_of_scope" },
      requiresConfirmation: false,
    });
  });

  it("falls back to clarification when semantic classification fails", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn().mockRejectedValue(new Error("timeout")) };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolve({ ...context, text: "这个感觉怪怪的" })).resolves.toMatchObject({
      intent: { type: "clarify", question: WORKFLOW_INTENT_CLARIFICATION_GUIDANCE },
      source: "rule",
    });
  });
});
