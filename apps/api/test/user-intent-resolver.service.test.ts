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

  it.each([
    ["proposal", "把现有方案调整为更年轻的风格"],
    ["script", "重写结尾旁白，让语气更有力量"],
    ["scene_plan", "第二项删掉，增加产品特写"],
    ["assets", "替换背景音乐为轻快的电子乐"],
  ] as const)("resolves an actionable %s revision without a paid model call", async (currentStage, text) => {
    const gateway = { classifyWorkflowIntent: vi.fn() };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolve({ ...context, currentStage, text })).resolves.toMatchObject({
      source: "rule",
      resolverVersion: "v2",
      intent: { type: "revise_current", stageId: currentStage, feedback: text },
    });
    expect(gateway.classifyWorkflowIntent).not.toHaveBeenCalled();
  });

  it("asks for concrete revision details using the current stage label", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn() };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    const decision = await resolver.resolve({ ...context, text: "修改一下" });
    expect(decision).toMatchObject({
      source: "rule",
      intent: { type: "clarify" },
    });
    expect(decision.intent.type === "clarify" && decision.intent.question).toContain("分镜写作");
    expect(gateway.classifyWorkflowIntent).not.toHaveBeenCalled();
  });

  it("leaves an explicitly named earlier stage for semantic restart classification", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn().mockResolvedValue({
      type: "restart_from", stageId: "script", feedback: "修改脚本旁白",
    }) };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolve({ ...context, text: "修改脚本旁白" })).resolves.toMatchObject({
      source: "model",
      intent: { type: "restart_from", stageId: "script" },
      requiresConfirmation: true,
    });
    expect(gateway.classifyWorkflowIntent).toHaveBeenCalledOnce();
  });

  it("does not create a revision for a stage that disallows changes", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn().mockResolvedValue({
      type: "revise_current", stageId: "compose", feedback: "调整编码参数",
    }) };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    const decision = await resolver.resolve({
      ...context,
      currentStage: "compose",
      text: "调整编码参数",
    });
    expect(decision).toMatchObject({
      intent: { type: "clarify" },
    });
    expect(decision.intent.type === "clarify" && decision.intent.question).toContain("视频生成");
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
      intent: {
        type: "clarify",
        question: `当前正在审核“分镜写作”。${WORKFLOW_INTENT_CLARIFICATION_GUIDANCE}`,
      },
      source: "rule",
    });
  });

  it("starts an explicit terminal video request without a model call", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn() };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolveTerminal({
      ...context,
      workflowStatus: "succeeded",
      text: "再生成一段雨夜城市宣传片",
    })).resolves.toMatchObject({
      source: "rule",
      intent: { type: "start_workflow", brief: "再生成一段雨夜城市宣传片" },
    });
    expect(gateway.classifyWorkflowIntent).not.toHaveBeenCalled();
  });

  it("uses a self-contained model brief for a contextual terminal request", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn().mockResolvedValue({
      type: "start_workflow",
      pipelineId: "cinematic",
      brief: "沿用上一支成片的雨夜风格，再制作一支城市宣传片。",
    }) };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolveTerminal({
      ...context,
      workflowStatus: "succeeded",
      text: "按刚才的风格再做一版",
    })).resolves.toMatchObject({
      source: "model",
      intent: { type: "start_workflow" },
      requiresConfirmation: false,
    });
  });

  it("falls back to chat when terminal semantic classification fails", async () => {
    const gateway = { classifyWorkflowIntent: vi.fn().mockRejectedValue(new Error("timeout")) };
    const resolver = new UserIntentResolverService(gateway as unknown as ModelGateway);
    await expect(resolver.resolveTerminal({
      ...context,
      workflowStatus: "succeeded",
      text: "再来一个",
    })).resolves.toMatchObject({
      source: "rule",
      intent: { type: "chat" },
    });
  });
});
