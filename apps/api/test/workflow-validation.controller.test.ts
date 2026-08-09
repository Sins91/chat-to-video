import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { WorkflowValidationController } from "../src/workflow-validation.controller.js";
import { WorkflowValidationService } from "../src/workflow-validation.service.js";

const createService = () => ({
  start: vi.fn(),
  getRun: vi.fn(),
});

describe("WorkflowValidationController", () => {
  it("publishes its service dependency for Nest injection", () => {
    expect(
      Reflect.getMetadata("design:paramtypes", WorkflowValidationController),
    ).toEqual([WorkflowValidationService]);
  });

  it("starts a workflow with the trimmed message", async () => {
    const service = createService();
    service.start.mockResolvedValue({
      runId: "run-1",
      requestId: "6bb22fe5-3cd7-4e20-b5f5-2da99928f84d",
    });
    const controller = new WorkflowValidationController(service);

    await expect(controller.start({ message: "  hello  " })).resolves.toEqual({
      runId: "run-1",
      requestId: "6bb22fe5-3cd7-4e20-b5f5-2da99928f84d",
    });
    expect(service.start).toHaveBeenCalledWith("hello");
  });

  it("rejects malformed input before starting a workflow", async () => {
    const service = createService();
    const controller = new WorkflowValidationController(service);

    await expect(controller.start({ message: "" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.start).not.toHaveBeenCalled();
  });

  it("returns the service run status", async () => {
    const service = createService();
    service.getRun.mockResolvedValue({ runId: "run-1", status: "running" });
    const controller = new WorkflowValidationController(service);

    await expect(controller.getRun("run-1")).resolves.toEqual({
      runId: "run-1",
      status: "running",
    });
  });
});
