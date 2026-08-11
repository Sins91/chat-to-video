import type { CinematicArtifact, CinematicGenerativeStage } from "@chat-to-video/contracts";
import { describe, expect, it, vi } from "vitest";

import type { VideoWorkflowOperations } from "../src/video-workflow/video-workflow.operations.js";
import {
  CINEMATIC_DIRECTOR_STEP_ID,
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
        { order: 1, durationSeconds: 4, narrativeBeat: "Approach", visualPrompt: "Courier in rain", sourceType: "generated_video", motionRequired: true, camera: "Tracking", transition: "cut", audio: "Rain" },
        { order: 2, durationSeconds: 6, narrativeBeat: "Reveal", visualPrompt: "Letter close-up", sourceType: "generated_video", motionRequired: true, camera: "Macro push", transition: "crossfade", audio: "Heartbeat" },
      ],
    },
  },
  assets: {
    stage: "assets",
    data: {
      assets: [
        { sceneOrder: 1, kind: "video", sourceMode: "generate", status: "planned", prompt: "Courier in rain", estimatedCostUsd: 0.5 },
        { sceneOrder: 2, kind: "video", sourceMode: "generate", status: "planned", prompt: "Letter close-up", estimatedCostUsd: 0.5 },
      ],
      music: { sourceMode: "library", direction: "Low strings" },
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
  enqueueCinematicVideo: vi.fn().mockResolvedValue(undefined),
  fail: vi.fn().mockResolvedValue(undefined),
});

describe("Cinematic production workflow", () => {
  it("uses stable identifiers and the default durable engine", () => {
    expect(CINEMATIC_WORKFLOW_ID).toBe("cinematic-production");
    expect(CINEMATIC_DIRECTOR_STEP_ID).toBe("cinematic-director");
    expect(createCinematicWorkflow(
      createOperations() as unknown as VideoWorkflowOperations,
    ).engineType).toBe("default");
  });

  it("moves through approval gates, supports revision, and ends after queue handoff", async () => {
    const operations = createOperations();
    const workflow = createCinematicWorkflow(
      operations as unknown as VideoWorkflowOperations,
    );
    const run = await workflow.createRun();

    expect((await run.start({ inputData: input, initialState: initialCinematicState() })).status)
      .toBe("suspended");
    expect((await run.resume({ step: CINEMATIC_DIRECTOR_STEP_ID, resumeData: { type: "approve" } })).status)
      .toBe("suspended");
    expect((await run.resume({ step: CINEMATIC_DIRECTOR_STEP_ID, resumeData: { type: "approve" } })).status)
      .toBe("suspended");
    expect((await run.resume({
      step: CINEMATIC_DIRECTOR_STEP_ID,
      resumeData: { type: "message", messageId: "message-1", text: "Use a lower camera angle" },
    })).status).toBe("suspended");
    expect((await run.resume({ step: CINEMATIC_DIRECTOR_STEP_ID, resumeData: { type: "approve" } })).status)
      .toBe("suspended");
    expect((await run.resume({ step: CINEMATIC_DIRECTOR_STEP_ID, resumeData: { type: "approve" } })).status)
      .toBe("success");

    expect(operations.generateCinematicArtifact).toHaveBeenCalledTimes(7);
    expect(operations.enqueueCinematicVideo).toHaveBeenCalledOnce();
  });

  it("persists rounded per-scene durations and suspends for confirmation again", async () => {
    const operations = createOperations();
    const workflow = createCinematicWorkflow(
      operations as unknown as VideoWorkflowOperations,
    );
    const run = await workflow.createRun();

    await run.start({ inputData: input, initialState: initialCinematicState() });
    await run.resume({ step: CINEMATIC_DIRECTOR_STEP_ID, resumeData: { type: "approve" } });
    await run.resume({ step: CINEMATIC_DIRECTOR_STEP_ID, resumeData: { type: "approve" } });
    const result = await run.resume({
      step: CINEMATIC_DIRECTOR_STEP_ID,
      resumeData: {
        type: "scene_durations",
        messageId: "scene-duration-message",
        scenes: [
          { order: 1, durationSeconds: 5 },
          { order: 2, durationSeconds: 5 },
        ],
      },
    });

    expect(result.status).toBe("suspended");
    expect(operations.applySceneDurations).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 5,
        scenes: [
          { order: 1, durationSeconds: 5 },
          { order: 2, durationSeconds: 5 },
        ],
      }),
    );
    expect(operations.activateCinematicArtifact).toHaveBeenLastCalledWith(
      expect.objectContaining({
        version: 5,
        requiresApproval: true,
      }),
    );
  });
});
