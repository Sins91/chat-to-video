import { describe, expect, it, vi } from "vitest";

import {
  createVideoCreationWorkflow,
  initialVideoCreationState,
  VIDEO_CREATION_WORKFLOW_ID,
  VIDEO_REVIEW_STEP_ID,
} from "../src/workflows/video-creation.workflow.js";
import type { VideoWorkflowOperations } from "../src/video-workflow/video-workflow.operations.js";

const input = {
  workflowId: "00000000-0000-4000-8000-000000000001",
  requestId: "00000000-0000-4000-8000-000000000002",
  initialPrompt: "A letter arriving on a rainy night",
  videoModel: "MiniMax-Hailuo-2.3" as const,
};

const storyboard = {
  title: "Rain Letter",
  creativeSummary: "A mysterious letter arrives in the rain.",
  shots: [
    { order: 1, durationSeconds: 4, scene: "Rainy street", subjectAction: "A courier approaches", camera: "Tracking", visualStyle: "Noir", audio: "Rain" },
    { order: 2, durationSeconds: 6, scene: "Old mailbox", subjectAction: "The letter is delivered", camera: "Close-up", visualStyle: "High contrast", audio: "Heartbeat" },
  ],
  videoPrompt: "A noir rainy street, tracking a courier delivering a letter, close-up cut, rain and heartbeat audio.",
};

const createOperations = () => ({
  generateStoryboard: vi.fn().mockResolvedValue(storyboard),
  activateStoryboard: vi.fn().mockResolvedValue(undefined),
  enqueueVideo: vi.fn().mockResolvedValue(undefined),
  fail: vi.fn().mockResolvedValue(undefined),
});

describe("Mastra video creation workflow", () => {
  it("uses stable engine and review identifiers for persisted resumes", () => {
    expect(VIDEO_CREATION_WORKFLOW_ID).toBe("video-creation");
    expect(VIDEO_REVIEW_STEP_ID).toBe("storyboard-review");

    const workflow = createVideoCreationWorkflow(
      createOperations() as unknown as VideoWorkflowOperations,
    );
    expect(workflow.engineType).toBe("default");
  });

  it("starts with no generated storyboard", () => {
    expect(initialVideoCreationState()).toEqual({
      phase: "initial",
      version: 0,
      storyboard: null,
      revisionRequest: null,
    });
  });

  it("suspends for review, loops on revision, and ends after enqueue", async () => {
    const operations = createOperations();
    const workflow = createVideoCreationWorkflow(operations as unknown as VideoWorkflowOperations);
    const run = await workflow.createRun();

    const first = await run.start({ inputData: input, initialState: initialVideoCreationState() });
    expect(first.status).toBe("suspended");
    expect(operations.activateStoryboard).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }));

    const revised = await run.resume({
      step: VIDEO_REVIEW_STEP_ID,
      resumeData: { type: "message", text: "Use a low-angle second shot" },
    });
    expect(revised.status).toBe("suspended");
    expect(operations.generateStoryboard).toHaveBeenCalledTimes(2);
    expect(operations.activateStoryboard).toHaveBeenLastCalledWith(expect.objectContaining({ version: 2 }));

    const approved = await run.resume({
      step: VIDEO_REVIEW_STEP_ID,
      resumeData: { type: "approve" },
    });
    expect(approved.status).toBe("success");
    expect(operations.enqueueVideo).toHaveBeenCalledOnce();
    expect(operations.enqueueVideo).toHaveBeenCalledWith(expect.objectContaining({
      videoModel: "MiniMax-Hailuo-2.3",
    }));
  });

  it("records an Agent failure without a framework retry", async () => {
    const operations = createOperations();
    operations.generateStoryboard.mockRejectedValue(new Error("Agent unavailable"));
    const workflow = createVideoCreationWorkflow(operations as unknown as VideoWorkflowOperations);
    const run = await workflow.createRun();

    const result = await run.start({ inputData: input, initialState: initialVideoCreationState() });
    expect(result.status).toBe("failed");
    expect(operations.generateStoryboard).toHaveBeenCalledOnce();
    expect(operations.fail).toHaveBeenCalledOnce();
  });
});
