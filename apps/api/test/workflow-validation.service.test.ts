import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const workflowApi = vi.hoisted(() => ({
  getRun: vi.fn(),
  start: vi.fn(),
}));

vi.mock("workflow/api", () => workflowApi);

import { WorkflowValidationService } from "../src/workflow-validation.service.js";

describe("WorkflowValidationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts the validation workflow without waiting for completion", async () => {
    workflowApi.start.mockResolvedValue({ runId: "run-1" });
    const service = new WorkflowValidationService();

    const response = await service.start("hello");

    expect(response.runId).toBe("run-1");
    expect(response.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(workflowApi.start).toHaveBeenCalledOnce();
  });

  it("returns a running status without waiting for a result", async () => {
    workflowApi.getRun.mockReturnValue({
      exists: Promise.resolve(true),
      status: Promise.resolve("running"),
    });
    const service = new WorkflowValidationService();

    await expect(service.getRun("run-1")).resolves.toEqual({
      runId: "run-1",
      status: "running",
    });
  });

  it("returns and validates the completed result", async () => {
    const result = {
      requestId: "6bb22fe5-3cd7-4e20-b5f5-2da99928f84d",
      message: "hello",
      checkpointId: "131ebff2-380f-48c8-b942-ecc34f83bfd2",
      preparedAt: "2026-08-09T00:00:00.000Z",
      completedAt: "2026-08-09T00:00:30.000Z",
    };
    workflowApi.getRun.mockReturnValue({
      exists: Promise.resolve(true),
      status: Promise.resolve("completed"),
      returnValue: Promise.resolve(result),
    });
    const service = new WorkflowValidationService();

    await expect(service.getRun("run-1")).resolves.toEqual({
      runId: "run-1",
      status: "completed",
      result,
    });
  });

  it("maps an unknown run to the public 404 error", async () => {
    workflowApi.getRun.mockReturnValue({ exists: Promise.resolve(false) });
    const service = new WorkflowValidationService();

    await expect(service.getRun("missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
