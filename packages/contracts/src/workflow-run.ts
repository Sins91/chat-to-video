import { z } from "zod";

import { CinematicGenerativeStageSchema } from "./cinematic.js";

export const WorkflowRunAttemptKindSchema = z.enum([
  "start",
  "restart",
  "continuation",
]);

export const WorkflowRunAttemptStatusSchema = z.enum([
  "pending",
  "claimed",
  "started",
  "completed",
  "failed",
  "superseded",
]);

export const WorkflowRunAttemptContextSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("start"),
    baseVersion: z.number().int().nonnegative(),
    expectedStateVersion: z.number().int().nonnegative(),
    startStage: CinematicGenerativeStageSchema.nullable(),
  }).strict(),
  z.object({
    kind: z.literal("restart"),
    restartRequestId: z.string().uuid(),
    targetStage: CinematicGenerativeStageSchema,
    text: z.string().trim().min(1).max(2_000),
    baseVersion: z.number().int().nonnegative(),
    expectedStateVersion: z.number().int().nonnegative(),
    previousArtifactVersion: z.number().int().positive().nullable(),
  }).strict(),
  z.object({
    kind: z.literal("continuation"),
    sourceStage: z.enum(["consistency_reference", "assets"]),
    targetStage: z.enum(["assets", "edit"]),
    baseVersion: z.number().int().positive(),
    expectedStateVersion: z.number().int().positive(),
  }).strict().superRefine((context, refinement) => {
    const expectedTarget = context.sourceStage === "consistency_reference" ? "assets" : "edit";
    if (context.targetStage !== expectedTarget) {
      refinement.addIssue({
        code: "custom",
        message: `Continuation from ${context.sourceStage} must target ${expectedTarget}.`,
        path: ["targetStage"],
      });
    }
  }),
]);

export type WorkflowRunAttemptKind = z.infer<typeof WorkflowRunAttemptKindSchema>;
export type WorkflowRunAttemptStatus = z.infer<typeof WorkflowRunAttemptStatusSchema>;
export type WorkflowRunAttemptContext = z.infer<typeof WorkflowRunAttemptContextSchema>;
