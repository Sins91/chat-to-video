import { resolve } from "node:path";
import type { VideoWorkflowRepository } from "@chat-to-video/database";
import { describe, expect, it } from "vitest";

import {
  createChatAgentRequestContext,
  createCinematicAgentRequestContext,
  createStoryboardAgentRequestContext,
} from "../src/agent-extensions/agent-extension.context.js";
import {
  AgentToolRegistry,
  estimateCinematicCost,
  GetAgentCapabilitiesInputSchema,
  getVideoModelConstraints,
  listAgentCapabilities,
} from "../src/agent-extensions/agent-tool.registry.js";
import { applyReviewedCinematicPricing } from "../src/agent-extensions/cinematic-pricing.js";
import {
  ALL_CINEMATIC_SKILL_IDS,
  AgentSkillCatalog,
  CINEMATIC_COMPOSE_SKILL_ID,
  CINEMATIC_CHECKPOINT_SKILL_ID,
  CINEMATIC_EXECUTIVE_PRODUCER_SKILL_ID,
  CINEMATIC_FINAL_REVIEW_SKILL_ID,
  CINEMATIC_GOVERNANCE_SKILL_ID,
  CINEMATIC_PUBLISH_SKILL_ID,
  CINEMATIC_REFERENCE_ANALYST_SKILL_ID,
  resolveAgentSkillRoot,
} from "../src/agent-extensions/agent-skill.catalog.js";

const requestId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
const workflowId = "00000000-0000-4000-8000-000000000003";

describe("agent extension boundaries", () => {
  it("builds a validated chat RequestContext", () => {
    const context = createChatAgentRequestContext({
      requestId,
      conversationId,
      tenantId: "tenant-1",
      projectId: "project-1",
      agentId: "chat-default",
    });
    expect(context.all).toEqual({
      requestId,
      conversationId,
      tenantId: "tenant-1",
      projectId: "project-1",
      agentId: "chat-default",
    });
  });

  it("builds a tool-free storyboard RequestContext", () => {
    expect(createStoryboardAgentRequestContext({
      requestId,
      conversationId,
      workflowId,
      tenantId: "tenant-1",
      projectId: "project-1",
    }).get("agentId")).toBe("storyboard-agent");
  });
  it("builds a stage-scoped cinematic RequestContext", () => {
    expect(createCinematicAgentRequestContext({
      requestId,
      conversationId,
      workflowId,
      stage: "scene_plan",
      tenantId: "tenant-1",
      projectId: "project-1",
    }).get("stage")).toBe("scene_plan");
  });

  it("uses an explicit stage Skill whitelist", () => {
    const catalog = new AgentSkillCatalog();
    expect(catalog.forChat()).toEqual([
      expect.stringMatching(/cinematic-governance$/u),
      expect.stringMatching(/cinematic-capabilities$/u),
      expect.stringMatching(/cinematic-reference-analyst$/u),
    ]);
    expect(catalog.forCinematic("scene_plan")).toEqual([
      expect.stringMatching(/cinematic-governance$/u),
      expect.stringMatching(/cinematic-executive-producer$/u),
      expect.stringMatching(/cinematic-checkpoint$/u),
      expect.stringMatching(/cinematic-scene-plan$/u),
      expect.stringMatching(/cinematic-reviewer$/u),
    ]);
    expect(catalog.forCinematic("research")).toEqual(expect.arrayContaining([
      expect.stringMatching(/cinematic-reference-analyst$/u),
    ]));
    expect(ALL_CINEMATIC_SKILL_IDS).toContain(CINEMATIC_GOVERNANCE_SKILL_ID);
    expect(ALL_CINEMATIC_SKILL_IDS).toContain(CINEMATIC_COMPOSE_SKILL_ID);
    expect(ALL_CINEMATIC_SKILL_IDS).toEqual(expect.arrayContaining([
      CINEMATIC_CHECKPOINT_SKILL_ID,
      CINEMATIC_EXECUTIVE_PRODUCER_SKILL_ID,
      CINEMATIC_REFERENCE_ANALYST_SKILL_ID,
      CINEMATIC_FINAL_REVIEW_SKILL_ID,
      CINEMATIC_PUBLISH_SKILL_ID,
    ]));
  });

  it("resolves Nest SWC split code and asset output directories", () => {
    const moduleDirectory = resolve(
      "virtual-root",
      "dist",
      "src",
      "agent-extensions",
    );
    const expectedRoot = resolve(
      "virtual-root",
      "dist",
      "agent-extensions",
      "skills",
    );
    expect(resolveAgentSkillRoot(moduleDirectory, (path) =>
      ALL_CINEMATIC_SKILL_IDS.some((skillId) =>
        path === resolve(expectedRoot, skillId, "SKILL.md")
      )
    )).toBe(expectedRoot);
  });
  it("rejects additional Tool input fields", () => {
    expect(() => GetAgentCapabilitiesInputSchema.parse({ extra: true })).toThrow();
  });
  it("reports only registered capability metadata", () => {
    const result = listAgentCapabilities("tool-calling");
    expect(result.capabilities.map((capability) => capability.id)).toEqual([
      "agent.tool-calling",
    ]);
  });

  it("scopes registered Tools to the current cinematic stage", () => {
    const registry = new AgentToolRegistry(
      {} as VideoWorkflowRepository,
      { searchWeb: () => Promise.resolve({ provider: "apimart", query: "q", results: [] }) },
    );
    expect(Object.keys(registry.forCinematic("research"))).toContain("web_search");
    expect(Object.keys(registry.forCinematic("research"))).not.toContain("image_selector");
    expect(Object.keys(registry.forCinematic("assets"))).toEqual(expect.arrayContaining([
      "tts_selector",
      "image_selector",
      "video_selector",
    ]));
  });

  it("returns shared model constraints", () => {
    const result = getVideoModelConstraints("doubao-seedance-2.0");
    expect(result.models).toHaveLength(1);
    expect(result.models[0]?.rendererFamily).toBe("ffmpeg");
  });

  it("uses only an explicitly supplied, versioned pricing entry", () => {
    const duration = getVideoModelConstraints("doubao-seedance-2.0")
      .models[0]?.durationOptionsSeconds[0];
    if (duration === undefined) throw new Error("Expected a duration option.");
    expect(estimateCinematicCost({
      model: "doubao-seedance-2.0",
      durationsSeconds: [duration],
    }, {
      "doubao-seedance-2.0": {
        usdPerGeneratedSecond: 0.25,
        source: "reviewed-fixture",
        version: "2026-08-11",
      },
    })).toEqual({
      status: "estimated",
      amountUsd: duration * 0.25,
      pricingSource: "reviewed-fixture",
      pricingVersion: "2026-08-11",
      reason: null,
    });
  });
  it("uses the reviewed APIMart prices for the configured generation profiles", () => {
    expect(estimateCinematicCost({
      model: "doubao-seedance-2.0",
      durationsSeconds: [5],
      generatedImageCount: 1,
      generatedMusicCount: 1,
    })).toEqual({
      status: "estimated",
      amountUsd: 1.0357,
      pricingSource: "https://api.apimart.ai/api/pricing/model",
      pricingVersion: "2026-08-14",
      reason: null,
    });
  });

  it("still reports unavailable when a model has no reviewed pricing entry", () => {
    expect(estimateCinematicCost({
      model: "doubao-seedance-2.0",
      durationsSeconds: [5],
    }, {})).toEqual({
      status: "unavailable",
      amountUsd: null,
      pricingSource: null,
      pricingVersion: null,
      reason: "pricing_not_configured",
    });
  });

  it("replaces model-authored asset costs with deterministic APIMart charges", () => {
    const scenePlan = {
      stage: "scene_plan" as const,
      data: {
        durationSeconds: 10,
        aspectRatio: "16:9" as const,
        scenes: [
          {
            order: 1,
            durationSeconds: 4,
            generationDurationSeconds: 6,
            narrativeBeat: "建立场景",
            visualPrompt: "雨夜街道",
            sourceType: "generated_video" as const,
            motionRequired: true,
            camera: "推进",
            transition: "cut" as const,
            audio: "雨声",
          },
          {
            order: 2,
            durationSeconds: 6,
            generationDurationSeconds: 6,
            narrativeBeat: "揭示线索",
            visualPrompt: "信件特写",
            sourceType: "generated_image" as const,
            motionRequired: false,
            camera: "固定",
            transition: "crossfade" as const,
            audio: "心跳",
          },
        ],
      },
    };
    const priced = applyReviewedCinematicPricing({
      stage: "assets",
      data: {
        assets: [
          { sceneOrder: 1, kind: "video", sourceMode: "generate", status: "planned", prompt: "雨夜街道", estimatedCostUsd: 999 },
          { sceneOrder: 2, kind: "image", sourceMode: "generate", status: "planned", prompt: "信件特写", estimatedCostUsd: 999 },
        ],
        music: { sourceMode: "generate", direction: "低音弦乐" },
        totalEstimatedCostUsd: 999,
        slideshowRisk: 2,
      },
    }, {
      videoModel: "MiniMax-Hailuo-2.3",
      approvedArtifacts: [scenePlan],
    });

    expect(priced.stage).toBe("assets");
    if (priced.stage !== "assets") throw new Error("Expected a priced asset manifest.");
    expect(priced.data.assets.map((asset) => asset.estimatedCostUsd)).toEqual([0.366, 0.0732]);
    expect(priced.data.totalEstimatedCostUsd).toBe(0.5142);
  });
});
