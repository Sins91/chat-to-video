import { describe, expect, it } from "vitest";

import {
  ChatAgentRequestSchema,
  CreateReferenceImageUploadRequestSchema,
  MAX_REFERENCE_IMAGE_ANALYSIS_ITEM_CHARS,
  ReferenceImageAnalysisSchema,
  ReferenceImageResolutionSchema,
} from "../src/index.js";

const imageId = "00000000-0000-4000-8000-000000000001";

describe("reference image contracts", () => {
  it("accepts mixed and image-only chat messages", () => {
    expect(ChatAgentRequestSchema.parse({
      message: { id: "message-1", content: "保持人物一致", referenceImageIds: [imageId] },
    }).message.referenceImageIds).toEqual([imageId]);
    expect(ChatAgentRequestSchema.safeParse({
      message: { id: "message-2", content: "", referenceImageIds: [imageId] },
    }).success).toBe(true);
  });

  it("rejects empty chat messages and duplicate image IDs", () => {
    expect(ChatAgentRequestSchema.safeParse({ message: { id: "message-1", content: "" } }).success).toBe(false);
    expect(ChatAgentRequestSchema.safeParse({
      message: { id: "message-2", content: "参考", referenceImageIds: [imageId, imageId] },
    }).success).toBe(false);
  });

  it("validates an explicit user declaration", () => {
    expect(CreateReferenceImageUploadRequestSchema.parse({
      fileName: "hero.webp",
      mimeType: "image/webp",
      sizeBytes: 1024,
      declaration: { purpose: "character", label: "主角", sceneOrders: [1, 3] },
    }).declaration?.purpose).toBe("character");
  });

  it("validates structured GPT-5 mini analysis", () => {
    expect(ReferenceImageAnalysisSchema.safeParse({
      referenceImageId: imageId,
      purpose: "environment",
      label: "雨夜街道",
      visibleFeatures: ["湿润石板路", "暖色路灯"],
      consistencyRequirements: ["保持路灯位置与色温"],
      recommendedSceneOrders: [1, 2],
      confidence: 0.92,
      containsRealPerson: false,
      containsSensitiveContent: false,
      requiresUserConfirmation: false,
    }).success).toBe(true);
  });

  it("accepts 400-character analysis items and rejects longer items", () => {
    const analysis = {
      referenceImageId: imageId,
      purpose: "product" as const,
      label: "产品参考",
      visibleFeatures: ["特".repeat(MAX_REFERENCE_IMAGE_ANALYSIS_ITEM_CHARS)],
      consistencyRequirements: ["保".repeat(MAX_REFERENCE_IMAGE_ANALYSIS_ITEM_CHARS)],
      recommendedSceneOrders: [1],
      confidence: 0.9,
      containsRealPerson: false,
      containsSensitiveContent: false,
      requiresUserConfirmation: false,
    };

    expect(ReferenceImageAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(ReferenceImageAnalysisSchema.safeParse({
      ...analysis,
      consistencyRequirements: [
        "保".repeat(MAX_REFERENCE_IMAGE_ANALYSIS_ITEM_CHARS + 1),
      ],
    }).success).toBe(false);
  });

  it("validates deterministic reference-image resolution states", () => {
    expect(ReferenceImageResolutionSchema.safeParse({
      referenceImageId: imageId,
      resolutionRequestId: null,
      effectivePurpose: "style",
      effectiveLabel: "服装风格",
      source: "model",
      status: "auto_resolved",
      reason: "model_confident",
      confidence: 0.9,
    }).success).toBe(true);
  });
});
