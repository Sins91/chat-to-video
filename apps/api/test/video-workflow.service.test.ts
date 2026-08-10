import type { VideoWorkflowRepository } from "@chat-to-video/database";
import type { ObjectStorage } from "@chat-to-video/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workflowApi = vi.hoisted(() => ({ resumeHook: vi.fn(), start: vi.fn() }));
vi.mock("workflow/api", () => workflowApi);

import { VideoWorkflowService } from "../src/video-workflow/video-workflow.service.js";

const waitingWorkflow = {
  id: "00000000-0000-4000-8000-000000000001",
  runId: "run-1",
  requestId: "00000000-0000-4000-8000-000000000002",
  initialPrompt: "雨夜里的未来来信",
  status: "awaiting_input",
  currentVersion: 1,
  errorMessage: null,
  createdAt: new Date("2026-08-09T00:00:00.000Z"),
  updatedAt: new Date("2026-08-09T00:00:00.000Z"),
};

describe("VideoWorkflowService interactions", () => {
  const repository = { findWorkflow: vi.fn() };
  const storage = { createDownloadUrl: vi.fn() };
  const service = new VideoWorkflowService(repository as unknown as VideoWorkflowRepository, storage as unknown as ObjectStorage);

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findWorkflow.mockResolvedValue(waitingWorkflow);
    workflowApi.resumeHook.mockResolvedValue({ runId: "run-1" });
  });

  it("treats an approval phrase as an approval event", async () => {
    await expect(service.interact(waitingWorkflow.id, { type: "message", text: "可以继续" })).resolves.toEqual({ accepted: true, intent: "approve" });
    expect(workflowApi.resumeHook).toHaveBeenCalledWith(`video-workflow:${waitingWorkflow.id}:review:1`, { type: "approve" });
  });

  it("keeps other messages as storyboard revisions", async () => {
    await expect(service.interact(waitingWorkflow.id, { type: "message", text: "把第二个镜头改成俯拍" })).resolves.toEqual({ accepted: true, intent: "revise" });
  });
});
