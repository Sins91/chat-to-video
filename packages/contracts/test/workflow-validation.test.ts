import { describe, expect, it } from "vitest";

import {
  WorkflowValidationRunResponseSchema,
  WorkflowValidationStartRequestSchema,
} from "../src/index.js";

describe("WorkflowValidationStartRequestSchema", () => {
  it("trims and accepts a valid message", () => {
    expect(
      WorkflowValidationStartRequestSchema.parse({ message: "  hello  " }),
    ).toEqual({ message: "hello" });
  });

  it.each([
    { message: "" },
    { message: " ".repeat(3) },
    { message: "a".repeat(201) },
    { message: "hello", unexpected: true },
  ])("rejects invalid input %#", (input) => {
    expect(WorkflowValidationStartRequestSchema.safeParse(input).success).toBe(
      false,
    );
  });
});

describe("WorkflowValidationRunResponseSchema", () => {
  it("accepts active and terminal responses", () => {
    expect(
      WorkflowValidationRunResponseSchema.parse({
        runId: "run-1",
        status: "running",
      }),
    ).toEqual({ runId: "run-1", status: "running" });

    expect(
      WorkflowValidationRunResponseSchema.parse({
        runId: "run-1",
        status: "cancelled",
      }),
    ).toEqual({ runId: "run-1", status: "cancelled" });
  });

  it("requires a result for completed responses", () => {
    expect(
      WorkflowValidationRunResponseSchema.safeParse({
        runId: "run-1",
        status: "completed",
      }).success,
    ).toBe(false);
  });
});
