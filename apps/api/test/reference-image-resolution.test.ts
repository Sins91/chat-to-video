import type { ReferenceImageAnalysis } from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

import {
  parseReferenceImageMessageDeclarations,
  resolveReferenceImageAnalysis,
} from "../src/reference-image/reference-image.service.js";

const analysis = (overrides: Partial<ReferenceImageAnalysis> = {}): ReferenceImageAnalysis => ({
  referenceImageId: "00000000-0000-4000-8000-000000000001",
  purpose: "style",
  label: "服装平铺风格",
  visibleFeatures: ["中性色服装"],
  consistencyRequirements: ["保持配色"],
  recommendedSceneOrders: [1, 2],
  confidence: 0.9,
  containsRealPerson: false,
  containsSensitiveContent: false,
  requiresUserConfirmation: true,
  ...overrides,
});

describe("reference image resolution policy", () => {
  it("auto-resolves a confident safe model classification despite its advisory flag", () => {
    expect(resolveReferenceImageAnalysis({
      analysis: analysis(),
      declaration: null,
      declarationSource: null,
    })).toMatchObject({
      effectivePurpose: "style",
      status: "auto_resolved",
      reason: "model_confident",
    });
  });

  it("allows a confident real-person character reference and blocks sensitive content", () => {
    expect(resolveReferenceImageAnalysis({
      analysis: analysis({ purpose: "character", containsRealPerson: true }),
      declaration: null,
      declarationSource: null,
    }).status).toBe("auto_resolved");
    expect(resolveReferenceImageAnalysis({
      analysis: analysis({ containsSensitiveContent: true }),
      declaration: null,
      declarationSource: null,
    }).status).toBe("blocked");
  });

  it("requires clarification below the confidence threshold", () => {
    expect(resolveReferenceImageAnalysis({
      analysis: analysis({ confidence: 0.79 }),
      declaration: null,
      declarationSource: null,
    })).toMatchObject({ status: "needs_clarification", reason: "low_confidence" });
  });

  it("maps explicit declarations to numbered images", () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const declarations = parseReferenceImageMessageDeclarations(
      "图1作为人物参考，图2作为场景参考",
      [first, second],
    );
    expect(declarations.get(first)?.purpose).toBe("character");
    expect(declarations.get(second)?.purpose).toBe("environment");
  });

  it("applies an explicit shared purpose to all uploaded images", () => {
    const ids = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ];
    const declarations = parseReferenceImageMessageDeclarations("这些图片全部作为风格参考", ids);
    expect([...declarations.values()].map((item) => item.purpose)).toEqual(["style", "style"]);
  });
});
