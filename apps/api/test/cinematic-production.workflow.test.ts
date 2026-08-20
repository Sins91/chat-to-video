import type { CinematicArtifact, CinematicGenerativeStage } from "@chat-to-video/contracts";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { describe, expect, it, vi } from "vitest";

import {
  CINEMATIC_WORKFLOW_ID,
  createCinematicWorkflow,
  initialCinematicState,
} from "../src/workflows/cinematic-production.workflow.js";

const input = {
  workflowId: "00000000-0000-4000-8000-000000000001",
  requestId: "00000000-0000-4000-8000-000000000002",
  initialPrompt: "A letter arriving on a rainy night",
  videoModel: "MiniMax-Hailuo-2.3" as const,
  durationSeconds: 10,
};

const artifacts: Record<CinematicGenerativeStage, CinematicArtifact> = {
  research: {
    stage: "research",
    data: {
      summary: "A restrained noir mood.",
      sourceMode: "generated",
      moodKeywords: ["noir", "rain", "mystery"],
      visualReferences: [
        { title: "Wet street", description: "Reflections and sodium light.", url: null },
        { title: "Sealed letter", description: "Macro paper texture.", url: null },
        { title: "Empty doorway", description: "Negative space and silhouette.", url: null },
      ],
      musicDirection: "Low strings and rain ambience.",
      soundDirection: "Rain, dialogue, and synchronized effects; no score.",
      productionConstraints: ["Ten second runtime"],
    },
  },
  proposal: {
    stage: "proposal",
    data: {
      directions: ["slow-reveal", "urgent-delivery", "memory-fragment"].map((id, index) => ({
        id,
        title: `Direction ${index + 1}`,
        logline: "A letter changes the night.",
        emotionalArc: ["anticipation", "reveal", "aftershock"],
        visualTreatment: "Noir rain and controlled camera motion.",
        colorPalette: ["charcoal", "amber", "steel blue"],
        musicDirection: "Low strings.",
        soundDirection: "Rain and synchronized effects; no score.",
      })),
      recommendedDirectionId: "slow-reveal",
      rendererFamily: "ffmpeg",
      durationSeconds: 10,
      estimatedCostUsd: 1.5,
      deliveryPromise: "A ten-second cinematic video.",
    },
  },
  script: {
    stage: "script",
    data: {
      title: "Rain Letter",
      durationSeconds: 10,
      dialogue: [],
      titleCards: [],
      beats: [
        { order: 1, durationSeconds: 4, purpose: "Approach", visual: "Courier in rain", audio: "Rain" },
        { order: 2, durationSeconds: 6, purpose: "Reveal", visual: "Letter close-up", audio: "Heartbeat" },
      ],
    },
  },
  scene_plan: {
    stage: "scene_plan",
    data: {
      durationSeconds: 10,
      aspectRatio: "16:9",
      scenes: [
        { order: 1, durationSeconds: 4, narrativeBeat: "Approach", visualPrompt: "Courier in rain", sourceType: "generated_video", motionRequired: true, camera: "Tracking", transition: "cut", audio: "Rain", audioMode: "seedance" },
        { order: 2, durationSeconds: 6, narrativeBeat: "Reveal", visualPrompt: "Letter close-up", sourceType: "generated_video", motionRequired: true, camera: "Macro push", transition: "crossfade", audio: "Heartbeat", audioMode: "seedance" },
      ],
    },
  },
  consistency_reference: {
    stage: "consistency_reference",
    data: { status: "not_required", reason: "No repeated generated subject.", groups: [] },
  },
  assets: {
    stage: "assets",
    data: {
      assets: [
        { sceneOrder: 1, kind: "video", sourceMode: "generate", status: "planned", prompt: "Courier in rain", estimatedCostUsd: 0.5 },
        { sceneOrder: 2, kind: "video", sourceMode: "generate", status: "planned", prompt: "Letter close-up", estimatedCostUsd: 0.5 },
      ],
      music: { sourceMode: "library", direction: "Low strings" },
      seedanceAudioDirection: "Rain and synchronized effects; no score.",
      totalEstimatedCostUsd: 1,
      slideshowRisk: 0,
    },
  },
  edit: {
    stage: "edit",
    data: {
      durationSeconds: 10,
      rendererFamily: "ffmpeg",
      timeline: [
        { sceneOrder: 1, startSeconds: 0, durationSeconds: 4, transition: "cut", audioGainDb: -6 },
        { sceneOrder: 2, startSeconds: 4, durationSeconds: 6, transition: "crossfade", audioGainDb: -4 },
      ],
      colorGrade: "Cool shadows and warm practical light.",
      audioMix: "Rain under low strings and heartbeat.",
      renderPrompt: "A noir courier delivers a mysterious letter in heavy rain.",
      qualityChecks: ["No still fallback", "Ten second runtime", "Controlled audio"],
    },
  },
};

const createOperations = () => ({
  generateCinematicArtifact: vi.fn().mockImplementation(
    ({ stage }: { stage: CinematicGenerativeStage }) => Promise.resolve(artifacts[stage]),
  ),
  activateCinematicArtifact: vi.fn().mockResolvedValue(undefined),
  applySceneDurations: vi.fn().mockImplementation(
    ({ scenes }: { scenes: ReadonlyArray<{ order: number; durationSeconds: number }> }) => {
      const scenePlan = artifacts.scene_plan;
      if (scenePlan.stage !== "scene_plan") throw new Error("Expected scene plan fixture.");
      return Promise.resolve({
        ...scenePlan,
        data: {
          ...scenePlan.data,
          scenes: scenePlan.data.scenes.map((scene, index) => ({
            ...scene,
            durationSeconds: scenes[index]?.durationSeconds ?? scene.durationSeconds,
            generationDurationSeconds: 6,
          })),
        },
      });
    },
  ),
  preflightStageExecution: vi.fn().mockResolvedValue(true),
  enqueueConsistencyReferenceBatch: vi.fn().mockResolvedValue("not_required"),
  enqueueCinematicAssetBatch: vi.fn().mockResolvedValue(undefined),
  enqueueCinematicVideo: vi.fn().mockResolvedValue(undefined),
  enqueueCinematicVideoVersion: vi.fn().mockResolvedValue(undefined),
  fail: vi.fn().mockResolvedValue(undefined),
});

const createTestWorkflow = (
  operations: Parameters<typeof createCinematicWorkflow>[0],
) => {
  const workflow = createCinematicWorkflow(operations);
  new Mastra({
    storage: new InMemoryStore(),
    workflows: { [CINEMATIC_WORKFLOW_ID]: workflow },
  });
  return workflow;
};
describe("Cinematic production workflow", () => {
  it("uses stable native step identifiers and the default durable engine", () => {
    const workflow = createTestWorkflow(
      createOperations(),
    );
    expect(CINEMATIC_WORKFLOW_ID).toBe("cinematic-production");
    expect(workflow.engineType).toBe("default");
  });

  it("runs native steps, revises one review step, and hands off assets exactly once", async () => {
    const operations = createOperations();
    const workflow = createTestWorkflow(
      operations,
    );
    const run = await workflow.createRun();

    expect((await run.start({ inputData: input, initialState: initialCinematicState(input) })).status)
      .toBe("suspended");
    expect((await run.resume({ step: "proposal", resumeData: { type: "approve" } })).status)
      .toBe("suspended");
    expect((await run.resume({ step: "script", resumeData: { type: "approve" } })).status)
      .toBe("suspended");
    expect((await run.resume({
      step: "scene-plan",
      resumeData: { type: "message", messageId: "message-revision", text: "Use a lower camera angle" },
    })).status).toBe("suspended");
    expect((await run.resume({ step: "scene-plan", resumeData: { type: "approve" } })).status)
      .toBe("suspended");
    expect((await run.resume({ step: "consistency-reference", resumeData: { type: "approve" } })).status)
      .toBe("suspended");
    expect((await run.resume({ step: "assets", resumeData: { type: "approve" } })).status)
      .toBe("success");

    expect(operations.generateCinematicArtifact).toHaveBeenCalledTimes(7);
    expect(operations.enqueueCinematicAssetBatch).toHaveBeenCalledOnce();
    expect(operations.enqueueCinematicAssetBatch).toHaveBeenCalledWith(
      expect.objectContaining({ version: 7 }),
    );
    expect(operations.enqueueCinematicVideoVersion).not.toHaveBeenCalled();
  });

  it("queues required consistency references and does not enter assets before approval", async () => {
    const operations = createOperations();
    operations.generateCinematicArtifact.mockImplementation(
      ({ stage }: { stage: CinematicGenerativeStage }) => Promise.resolve(stage === "consistency_reference"
        ? {
            stage: "consistency_reference",
            data: {
              status: "required",
              reason: "The courier appears in two generated scenes.",
              groups: [{
                id: "courier",
                kind: "character",
                identityMode: "fictional",
                label: "Courier",
                sceneOrders: [1, 2],
                canonicalDescription: "A fictional courier in a dark rain coat.",
                prompt: "Neutral full-body reference of a fictional courier in a dark rain coat.",
                aspectRatio: "16:9",
                estimatedCostUsd: 0.05,
              }],
            },
          }
        : artifacts[stage]),
    );
    const workflow = createTestWorkflow(operations);
    const run = await workflow.createRun();
    await run.start({ inputData: input, initialState: initialCinematicState(input) });
    await run.resume({ step: "proposal", resumeData: { type: "approve" } });
    await run.resume({ step: "script", resumeData: { type: "approve" } });
    const planningReview = await run.resume({ step: "scene-plan", resumeData: { type: "approve" } });
    operations.enqueueConsistencyReferenceBatch.mockResolvedValue("queued");
    expect(planningReview.status).toBe("suspended");
    expect(operations.enqueueConsistencyReferenceBatch).not.toHaveBeenCalled();

    const result = await run.resume({
      step: "consistency-reference",
      resumeData: { type: "approve" },
    });

    expect(result.status).toBe("success");
    expect(operations.activateCinematicArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ requiresApproval: true, version: 5 }),
    );
    expect(operations.enqueueConsistencyReferenceBatch).toHaveBeenCalledOnce();
    expect(operations.enqueueConsistencyReferenceBatch).toHaveBeenCalledWith(
      expect.objectContaining({ version: 5 }),
    );
    expect(operations.enqueueCinematicAssetBatch).not.toHaveBeenCalled();
  });

  it("continues from approved consistency references at assets planning", async () => {
    const operations = createOperations();
    const workflow = createTestWorkflow(operations);
    const continuationInput = {
      ...input,
      continuation: {
        kind: "stage_execution_approved" as const,
        stageId: "consistency_reference" as const,
        baseVersion: 5,
      },
    };
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: continuationInput,
      initialState: initialCinematicState(continuationInput, 5),
    });

    expect(result.status).toBe("suspended");
    expect(operations.generateCinematicArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "assets", version: 6 }),
    );
    expect(operations.enqueueConsistencyReferenceBatch).not.toHaveBeenCalled();
  });
  it("keeps asset review suspended when execution preflight is blocked", async () => {
    const operations = createOperations();
    const workflow = createTestWorkflow(operations);
    const run = await workflow.createRun();

    await run.start({ inputData: input, initialState: initialCinematicState(input) });
    await run.resume({ step: "proposal", resumeData: { type: "approve" } });
    await run.resume({ step: "script", resumeData: { type: "approve" } });
    await run.resume({ step: "scene-plan", resumeData: { type: "approve" } });
    await run.resume({
      step: "consistency-reference",
      resumeData: { type: "approve" },
    });
    operations.preflightStageExecution.mockResolvedValue(false);

    const result = await run.resume({
      step: "assets",
      resumeData: { type: "approve" },
    });

    expect(result.status).toBe("suspended");
    expect(operations.preflightStageExecution).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "assets", version: 6 }),
    );
    expect(operations.enqueueCinematicAssetBatch).not.toHaveBeenCalled();
    expect(operations.enqueueCinematicVideoVersion).not.toHaveBeenCalled();
    expect(operations.fail).not.toHaveBeenCalled();
  });

  it("continues from approved assets in a new run and enqueues final composition", async () => {
    const operations = createOperations();
    const workflow = createTestWorkflow(operations);
    const continuationInput = {
      ...input,
      continuation: { kind: "stage_execution_approved" as const, stageId: "assets" as const, baseVersion: 7 },
    };
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: continuationInput,
      initialState: initialCinematicState(continuationInput, 7),
    });

    expect(result.status).toBe("success");
    expect(operations.generateCinematicArtifact).toHaveBeenCalledOnce();
    expect(operations.generateCinematicArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "edit", version: 8 }),
    );
    expect(operations.enqueueCinematicVideoVersion).toHaveBeenCalledWith(
      expect.objectContaining({ version: 8 }),
    );
  });

  it("starts a replacement run at its target without replaying earlier paid steps", async () => {
    const operations = createOperations();
    const workflow = createTestWorkflow(
      operations,
    );
    const restartInput = {
      ...input,
      restart: {
        restartRequestId: "00000000-0000-4000-8000-000000000099",
        targetStage: "assets" as const,
        text: "Use practical source footage",
        previousArtifactVersion: 6,
      },
    };
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: restartInput,
      initialState: initialCinematicState(restartInput, 8),
    });

    expect(result.status).toBe("suspended");
    expect(operations.generateCinematicArtifact).toHaveBeenCalledOnce();
    expect(operations.generateCinematicArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "assets",
        version: 9,
        previousArtifactVersion: 6,
      }),
    );
    expect(operations.enqueueCinematicVideoVersion).not.toHaveBeenCalled();
  });

  it.each([
    ["proposal", "proposal"],
    ["script", "script"],
    ["scene_plan", "scene-plan"],
    ["assets", "assets"],
    ["consistency_reference", "consistency-reference"],
  ] as const)("revises %s in the same native step and suspends again", async (targetStage, stepId) => {
    const operations = createOperations();
    const workflow = createTestWorkflow(operations);
    const restartInput = {
      ...input,
      restart: {
        restartRequestId: "00000000-0000-4000-8000-000000000099",
        targetStage,
        text: `Restart ${targetStage}`,
        previousArtifactVersion: 6,
      },
    };
    const run = await workflow.createRun();
    await run.start({ inputData: restartInput, initialState: initialCinematicState(restartInput, 8) });
    const result = await run.resume({
      step: stepId,
      resumeData: { type: "message", messageId: `revise-${targetStage}`, text: "Try another direction" },
    });

    expect(result.status).toBe("suspended");
    expect(operations.generateCinematicArtifact).toHaveBeenCalledTimes(2);
    expect(operations.generateCinematicArtifact).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: targetStage,
        version: 10,
        previousArtifactVersion: 9,
        revisionRequest: "Try another direction",
      }),
    );
  });

  it("persists scene duration revisions and rejects them at other review steps", async () => {
    const operations = createOperations();
    const workflow = createTestWorkflow(operations);
    const run = await workflow.createRun();
    await run.start({ inputData: input, initialState: initialCinematicState(input) });
    await run.resume({ step: "proposal", resumeData: { type: "approve" } });
    await run.resume({ step: "script", resumeData: { type: "approve" } });
    const revised = await run.resume({
      step: "scene-plan",
      resumeData: {
        type: "scene_durations",
        messageId: "duration-update",
        scenes: [
          { order: 1, durationSeconds: 5 },
          { order: 2, durationSeconds: 5 },
        ],
      },
    });
    expect(revised.status).toBe("suspended");
    expect(operations.applySceneDurations).toHaveBeenCalledWith(
      expect.objectContaining({ version: 5 }),
    );

    const invalidOperations = createOperations();
    const invalidRun = await createTestWorkflow(invalidOperations).createRun();
    await invalidRun.start({ inputData: input, initialState: initialCinematicState(input) });
    const invalid = await invalidRun.resume({
      step: "proposal",
      resumeData: {
        type: "scene_durations",
        messageId: "invalid-duration-update",
        scenes: [{ order: 1, durationSeconds: 10 }],
      },
    });
    expect(invalid.status).toBe("failed");
    expect(invalidOperations.fail).toHaveBeenCalledOnce();
  });
});
