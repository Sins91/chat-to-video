import {
  CINEMATIC_PIPELINE_DEFINITION,
  CinematicConsistencyReferenceArtifactSchema,
  CinematicReferenceBindingsSchema,
  getCinematicConsistencyReferencePriority,
  MAX_CONSISTENCY_REFERENCE_TEXT_CHARS,
} from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

const binding = (purpose: "character" | "product" | "environment" | "style", index: number) => ({
  groupId: `group-${index}`,
  assetId: `asset-${index}`,
  objectKey: `tenant/demo/project/demo/derived/references/ref-${index}.png`,
  purpose,
  approvalStatus: "approved" as const,
});

describe("cinematic consistency-reference contracts", () => {
  it("registers the v4 stage between scene plan and assets", () => {
    expect(CINEMATIC_PIPELINE_DEFINITION.definitionVersion).toBe(4);
    expect(CINEMATIC_PIPELINE_DEFINITION.stages.map((stage) => stage.id)).toEqual([
      "research", "proposal", "script", "scene_plan", "consistency_reference", "assets", "edit", "compose",
    ]);
    const stage = CINEMATIC_PIPELINE_DEFINITION.stages.find(
      (definition) => definition.id === "consistency_reference",
    );
    expect(stage?.planningReview).toEqual({ requiresApproval: true, allowsRevision: true });
    expect(stage?.executionReview).toEqual({ requiresApproval: true, allowsRevision: true });
    expect(stage?.execution).toBe("queue");
    expect(stage?.requiresApproval).toBe(true);
  });

  it("requires every continuity group to cover at least two scenes", () => {
    expect(CinematicConsistencyReferenceArtifactSchema.safeParse({
      status: "required",
      reason: "Repeated lead character.",
      groups: [{
        id: "lead",
        kind: "character",
        identityMode: "fictional",
        label: "Lead",
        sceneOrders: [1],
        canonicalDescription: "A fictional courier.",
        prompt: "Neutral full-body reference of a fictional courier.",
        aspectRatio: "16:9",
        estimatedCostUsd: 0.05,
      }],
    }).success).toBe(false);
    expect(CinematicConsistencyReferenceArtifactSchema.safeParse({
      status: "not_required",
      reason: "No repeated generated subject.",
      groups: [],
    }).success).toBe(true);
  });

  it("accepts 4000-character reference text and rejects longer values", () => {
    const group = {
      id: "lead",
      kind: "character" as const,
      identityMode: "fictional" as const,
      label: "Lead",
      sceneOrders: [1, 2],
      canonicalDescription: "描".repeat(MAX_CONSISTENCY_REFERENCE_TEXT_CHARS),
      prompt: "提".repeat(MAX_CONSISTENCY_REFERENCE_TEXT_CHARS),
      aspectRatio: "16:9" as const,
      estimatedCostUsd: 0.05,
    };
    const artifact = { status: "required" as const, reason: "Repeated lead.", groups: [group] };

    expect(CinematicConsistencyReferenceArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(CinematicConsistencyReferenceArtifactSchema.safeParse({
      ...artifact,
      groups: [{
        ...group,
        canonicalDescription: "描".repeat(MAX_CONSISTENCY_REFERENCE_TEXT_CHARS + 1),
      }],
    }).success).toBe(false);
    expect(CinematicConsistencyReferenceArtifactSchema.safeParse({
      ...artifact,
      groups: [{
        ...group,
        prompt: "提".repeat(MAX_CONSISTENCY_REFERENCE_TEXT_CHARS + 1),
      }],
    }).success).toBe(false);
  });

  it("ranks character anchors ahead of every other reference kind", () => {
    const characterPriority = getCinematicConsistencyReferencePriority("character");
    expect(characterPriority).toBeLessThan(getCinematicConsistencyReferencePriority("product"));
    expect(characterPriority).toBeLessThan(getCinematicConsistencyReferencePriority("environment"));
    expect(characterPriority).toBeLessThan(getCinematicConsistencyReferencePriority("style"));
  });

  it("limits bindings to three approved safe objects in fixed priority order", () => {
    expect(CinematicReferenceBindingsSchema.safeParse([
      binding("character", 1), binding("product", 2), binding("environment", 3),
    ]).success).toBe(true);
    expect(CinematicReferenceBindingsSchema.safeParse([
      binding("style", 1), binding("character", 2),
    ]).success).toBe(false);
    expect(CinematicReferenceBindingsSchema.safeParse([
      binding("character", 1), binding("product", 2), binding("environment", 3), binding("style", 4),
    ]).success).toBe(false);
    expect(CinematicReferenceBindingsSchema.safeParse([{
      ...binding("character", 1),
      objectKey: "tenant/demo/project/demo/derived/../secret.png",
    }]).success).toBe(false);
  });
});
