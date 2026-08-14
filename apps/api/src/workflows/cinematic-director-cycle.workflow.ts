import {
  CinematicDurationSecondsSchema,
  VideoModelSchema,
  VideoWorkflowInteractionSchema,
} from "@chat-to-video/contracts";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import {
  DIRECTOR_ACTION_LIMIT,
  type WorkflowDirectorService,
} from "../video-workflow/workflow-director.service.js";
import {
  WorkflowDirectorTriggerSchema,
} from "../video-workflow/workflow-director-trigger.js";

export const CINEMATIC_DIRECTOR_WORKFLOW_ID = "cinematic-director-cycle";

export const CinematicDirectorWorkflowInputSchema = z.object({
  workflowId: z.string().uuid(),
  cycleId: z.string().uuid(),
  requestId: z.string().uuid(),
  initialPrompt: z.string().trim().min(1).max(8_000),
  videoModel: VideoModelSchema,
  durationSeconds: CinematicDurationSecondsSchema,
}).strict();

const DirectorLoopSchema = z.object({
  workflowId: z.string().uuid(),
  cycleId: z.string().uuid(),
  iteration: z.number().int().min(0).max(DIRECTOR_ACTION_LIMIT + 1),
  outcome: z.enum(["continue", "suspend", "external_wait", "terminal"]),
  actionId: z.string().uuid().nullable(),
  stateVersion: z.number().int().nonnegative(),
  stage: z.string().trim().min(1).max(64),
  artifactVersion: z.number().int().nonnegative(),
  policyRejection: z.object({
    code: z.string().trim().min(1).max(64),
    reason: z.string().trim().min(1).max(2_000),
  }).strict().nullable(),
  trigger: WorkflowDirectorTriggerSchema.nullable(),
}).strict();

const CinematicDirectorResumeSchema = z.object({
  interaction: VideoWorkflowInteractionSchema,
  trigger: WorkflowDirectorTriggerSchema.nullable(),
}).strict();

export const CinematicDirectorSuspensionSchema = z.object({
  workflowId: z.string().uuid(),
  cycleId: z.string().uuid(),
  actionId: z.string().uuid(),
  stage: z.string().trim().min(1).max(64),
  artifactVersion: z.number().int().nonnegative(),
  stateVersion: z.number().int().nonnegative(),
  nextIteration: z.number().int().min(1).max(DIRECTOR_ACTION_LIMIT + 1),
}).strict();

const DirectorOutputSchema = z.object({
  workflowId: z.string().uuid(),
  status: z.enum(["external_wait", "terminal"]),
}).strict();

export type CinematicDirectorWorkflowInput = z.infer<typeof CinematicDirectorWorkflowInputSchema>;

export const createCinematicDirectorWorkflow = (director: WorkflowDirectorService) => {
  const loadContext = createStep({
    id: "load-director-context",
    inputSchema: CinematicDirectorWorkflowInputSchema,
    outputSchema: DirectorLoopSchema,
    retries: 0,
    execute: ({ inputData }) => Promise.resolve({
      workflowId: inputData.workflowId,
      cycleId: inputData.cycleId,
      iteration: 0,
      outcome: "continue" as const,
      actionId: null,
      stateVersion: 0,
      stage: "research",
      artifactVersion: 0,
      policyRejection: null,
      trigger: null,
    }),
  });

  const directorCycle = createStep({
    id: "director-cycle",
    inputSchema: DirectorLoopSchema,
    outputSchema: DirectorLoopSchema,
    resumeSchema: CinematicDirectorResumeSchema,
    suspendSchema: CinematicDirectorSuspensionSchema,
    retries: 0,
    execute: async (context) => {
      const suspension = context.resumeData
        ? CinematicDirectorSuspensionSchema.parse(context.suspendData)
        : null;
      const iteration = suspension?.nextIteration ?? context.inputData.iteration + 1;
      const trigger = context.resumeData?.trigger ?? context.inputData.trigger;
      const result = await director.runCycle({
        workflowId: context.inputData.workflowId,
        cycleId: context.inputData.cycleId,
        iteration,
        ...(context.resumeData ? { interaction: context.resumeData.interaction } : {}),
        ...(trigger ? { trigger } : {}),
        ...(context.inputData.policyRejection
          ? { previousPolicyRejection: context.inputData.policyRejection }
          : {}),
      });
      if (result.outcome === "suspend") {
        if (!result.actionId) throw new Error("A suspended Director cycle must reference an action.");
        return context.suspend({
          workflowId: result.workflowId,
          cycleId: result.cycleId,
          actionId: result.actionId,
          stage: result.stage,
          artifactVersion: result.artifactVersion,
          stateVersion: result.stateVersion,
          nextIteration: Math.min(DIRECTOR_ACTION_LIMIT + 1, result.iteration + 1),
        });
      }
      return {
        ...result,
        trigger: result.policyRejection ? trigger : null,
      };
    },
  });

  const finalize = createStep({
    id: "finalize-director-run",
    inputSchema: DirectorLoopSchema,
    outputSchema: DirectorOutputSchema,
    retries: 0,
    execute: ({ inputData }) => Promise.resolve({
      workflowId: inputData.workflowId,
      status: inputData.outcome === "terminal" ? "terminal" as const : "external_wait" as const,
    }),
  });

  return createWorkflow({
    id: CINEMATIC_DIRECTOR_WORKFLOW_ID,
    inputSchema: CinematicDirectorWorkflowInputSchema,
    outputSchema: DirectorOutputSchema,
    retryConfig: { attempts: 0, delay: 0 },
  })
    .then(loadContext)
    .dountil(directorCycle, ({ inputData }) => Promise.resolve(inputData.outcome !== "continue"))
    .then(finalize)
    .commit();
};
