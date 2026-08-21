import { describe, expect, it, vi } from "vitest";

import { WorkflowRunLauncher } from "../src/video-workflow/workflow-run-launcher.service.js";

const workflow = {
  id: "00000000-0000-4000-8000-000000000001",
  requestId: "00000000-0000-4000-8000-000000000002",
  initialPrompt: "生成一支品牌短片",
  videoModel: "doubao-seedance-2.0",
  durationSeconds: 10,
  status: "drafting",
  currentVersion: 0,
  stateVersion: 0,
  pipelineDefinitionVersion: 5,
};

const attempt = {
  id: "00000000-0000-4000-8000-000000000003",
  workflowId: workflow.id,
  mastraRunId: "00000000-0000-4000-8000-000000000003",
  runContext: {
    kind: "start" as const,
    baseVersion: 0,
    expectedStateVersion: 0,
    startStage: null,
  },
};

const setup = (runState: "missing" | "active" | "suspended" | "success" = "missing") => {
  const repository = {
    claimWorkflowRunAttempt: vi.fn().mockResolvedValue(attempt),
    findWorkflow: vi.fn().mockResolvedValue(workflow),
    finishClaimedWorkflowRunAttempt: vi.fn().mockResolvedValue(true),
    markWorkflowRunAttemptStarted: vi.fn().mockResolvedValue(true),
    completeWorkflowRunAttempt: vi.fn().mockResolvedValue(undefined),
    releaseWorkflowRunAttempt: vi.fn().mockResolvedValue(true),
  };
  const runtime = {
    inspectRun: vi.fn().mockResolvedValue(runState),
    launchAttempt: vi.fn().mockResolvedValue(undefined),
    restartActiveRun: vi.fn().mockResolvedValue(undefined),
  };
  return {
    launcher: new WorkflowRunLauncher(repository as never, runtime as never),
    repository,
    runtime,
  };
};

describe("WorkflowRunLauncher", () => {
  it("uses the durable attempt id as the deterministic Mastra run id", async () => {
    const { launcher, repository, runtime } = setup("missing");

    await expect(launcher.launchAttempt(attempt.id)).resolves.toBe(true);

    expect(runtime.launchAttempt).toHaveBeenCalledWith(expect.objectContaining({
      runId: attempt.id,
      baseVersion: 0,
      startStage: null,
    }));
    expect(repository.markWorkflowRunAttemptStarted).toHaveBeenCalledOnce();
  });

  it("recovers an existing active run instead of creating another run", async () => {
    const { launcher, runtime } = setup("active");

    await expect(launcher.launchAttempt(attempt.id)).resolves.toBe(true);

    expect(runtime.launchAttempt).not.toHaveBeenCalled();
    expect(runtime.restartActiveRun).toHaveBeenCalledWith(attempt.mastraRunId);
  });

  it("leaves transient launch failures pending for a later recovery scan", async () => {
    const { launcher, repository, runtime } = setup("missing");
    runtime.launchAttempt.mockRejectedValueOnce(new Error("Redis unavailable"));

    await expect(launcher.launchAttempt(attempt.id)).resolves.toBe(false);

    expect(repository.releaseWorkflowRunAttempt).toHaveBeenCalledWith(
      attempt.id,
      expect.any(String),
      "RUN_LAUNCH_RETRYABLE",
    );
  });

  it("supersedes an unstarted attempt when the persisted workflow version changed", async () => {
    const { launcher, repository, runtime } = setup("missing");
    repository.findWorkflow.mockResolvedValueOnce({ ...workflow, stateVersion: 1 });

    await expect(launcher.launchAttempt(attempt.id)).resolves.toBe(false);

    expect(runtime.launchAttempt).not.toHaveBeenCalled();
    expect(repository.finishClaimedWorkflowRunAttempt).toHaveBeenCalledWith(
      attempt.id,
      expect.any(String),
      "superseded",
      "WORKFLOW_VERSION_CHANGED",
    );
  });
});
