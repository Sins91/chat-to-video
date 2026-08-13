import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createChatAgentRequestContext,
  createCinematicAgentRequestContext,
  createStoryboardAgentRequestContext,
} from "../src/agent-extensions/agent-extension.context.js";
import {
  estimateCinematicCost,
  GetAgentCapabilitiesInputSchema,
  getVideoModelConstraints,
  listAgentCapabilities,
} from "../src/agent-extensions/agent-tool.registry.js";
import {
  ALL_CINEMATIC_SKILL_IDS,
  AgentSkillCatalog,
  CINEMATIC_GOVERNANCE_SKILL_ID,
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
    ]);
    expect(catalog.forCinematic("scene_plan")).toEqual([
      expect.stringMatching(/cinematic-governance$/u),
      expect.stringMatching(/cinematic-scene-plan$/u),
      expect.stringMatching(/cinematic-reviewer$/u),
    ]);
    expect(ALL_CINEMATIC_SKILL_IDS).toContain(CINEMATIC_GOVERNANCE_SKILL_ID);
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
  it("does not invent pricing when no reviewed catalog exists", () => {
    expect(estimateCinematicCost({
      model: "doubao-seedance-2.0",
      durationsSeconds: [5],
    })).toEqual({
      status: "unavailable",
      amountUsd: null,
      pricingSource: null,
      pricingVersion: null,
      reason: "pricing_not_configured",
    });
  });
});
