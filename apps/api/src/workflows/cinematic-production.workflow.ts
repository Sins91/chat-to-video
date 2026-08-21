import {
  CINEMATIC_PIPELINE_DEFINITION,
  CinematicArtifactSchema,
  CinematicDurationSecondsSchema,
  CinematicGenerativeStageSchema,
  VideoModelSchema,
  VideoWorkflowInteractionSchema,
  type CinematicGenerativeStage,
  type VideoWorkflowInteraction,
} from "@chat-to-video/contracts";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import type { VideoWorkflowOperations } from "../video-workflow/video-workflow.operations.js";
import { createPipelineStepDefinition } from "./pipeline-stage-control.js";
import { assertCinematicRuntimeRegistration } from "./cinematic-runtime-adapters.js";

export const CINEMATIC_WORKFLOW_ID = "cinematic-production";

const CinematicRestartStageSchema = CinematicGenerativeStageSchema.refine(
  (stage) => CINEMATIC_PIPELINE_DEFINITION.stages.some(
    (definition) => definition.id === stage && definition.isRestartable,
  ),
  "Stage is not restartable in the cinematic pipeline.",
);

export const CinematicWorkflowInputSchema = z.object({
  workflowId: z.string().uuid(),
  requestId: z.string().uuid(),
  initialPrompt: z.string().trim().min(1).max(8_000),
  videoModel: VideoModelSchema,
  durationSeconds: CinematicDurationSecondsSchema,
  restart: z.object({
    restartRequestId: z.string().uuid(),
    targetStage: CinematicRestartStageSchema,
    text: z.string().trim().min(1).max(2_000),
    previousArtifactVersion: z.number().int().positive().nullable(),
  }).strict().optional(),
  continuation: z.object({
    kind: z.literal("stage_execution_approved"),
    stageId: z.enum(["consistency_reference", "assets"]),
    baseVersion: z.number().int().positive(),
  }).strict().optional(),
}).strict().superRefine((input, context) => {
  if (input.restart && input.continuation) {
    context.addIssue({
      code: "custom",
      message: "Workflow restart and continuation cannot be requested together.",
      path: ["continuation"],
    });
  }
});

const CinematicWorkflowCursorSchema = CinematicWorkflowInputSchema.extend({
  version: z.number().int().nonnegative(),
}).strict();

const CinematicWorkflowStateSchema = z.object({
  workflowId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  startStage: CinematicGenerativeStageSchema.nullable(),
  currentArtifact: z.object({
    stage: CinematicGenerativeStageSchema,
    version: z.number().int().positive(),
  }).strict().nullable(),
  handoff: z.enum(["none", "consistency_reference_queued", "consistency_reference_blocked", "assets_queued"]),
}).strict();

export const CinematicWorkflowSuspensionSchema = z.object({
  workflowId: z.string().uuid(),
  stage: CinematicGenerativeStageSchema,
  version: z.number().int().positive(),
}).strict();

const CinematicWorkflowOutputSchema = z.object({
  workflowId: z.string().uuid(),
  status: z.literal("queued"),
}).strict();

type CinematicWorkflowCursor = z.infer<typeof CinematicWorkflowCursorSchema>;
export type CinematicWorkflowInput = z.infer<typeof CinematicWorkflowInputSchema>;
export type CinematicWorkflowState = z.infer<typeof CinematicWorkflowStateSchema>;
export type CinematicWorkflowDomainAdapter = Pick<VideoWorkflowOperations,
  | "generateCinematicArtifact"
  | "activateCinematicArtifact"
  | "applySceneDurations"
  | "preflightStageExecution"
  | "enqueueConsistencyReferenceBatch"
  | "enqueueCinematicAssetBatch"
  | "enqueueCinematicVideoVersion"
  | "fail"
>;

export const initialCinematicState = (
  input: CinematicWorkflowInput,
  version = 0,
  explicitStartStage?: CinematicGenerativeStage | null,
): CinematicWorkflowState => ({
  workflowId: input.workflowId,
  version,
  startStage: explicitStartStage === undefined
    ? input.restart?.targetStage ?? (input.continuation
      ? input.continuation.stageId === "consistency_reference" ? "assets" : "edit"
      : null)
    : explicitStartStage,
  currentArtifact: null,
  handoff: "none",
});

const workflowCursor = (
  input: CinematicWorkflowInput | CinematicWorkflowCursor,
  version: number,
): CinematicWorkflowCursor => ({ ...input, version });

const previousArtifactVersion = (
  input: CinematicWorkflowCursor,
  stage: CinematicGenerativeStage,
): number | undefined => input.restart?.targetStage === stage
  ? input.restart.previousArtifactVersion ?? undefined
  : undefined;

const assertReviewInteraction = (
  interaction: VideoWorkflowInteraction,
  stage: CinematicGenerativeStage,
): "approve" | "revise" => {
  if (interaction.type === "approve") return "approve";
  if (interaction.type === "message") return "revise";
  if (interaction.type === "scene_durations" && stage === "scene_plan") return "revise";
  throw new Error(`Interaction ${interaction.type} is not valid while reviewing ${stage}.`);
};

type ReviewStage = "proposal" | "script" | "scene_plan" | "consistency_reference" | "assets";
type ExecutionReviewResult = { handoff: CinematicWorkflowState["handoff"]; shouldSuspend: boolean };

export const createCinematicWorkflow = (operations: CinematicWorkflowDomainAdapter) => {
  assertCinematicRuntimeRegistration();
  const executionReviewHandlers: Partial<Record<
    ReviewStage,
    (input: CinematicWorkflowCursor) => Promise<ExecutionReviewResult>
  >> = {
    consistency_reference: async (input) => {
      const result = await operations.enqueueConsistencyReferenceBatch(input);
      return {
        handoff: result === "queued" ? "consistency_reference_queued" : "none",
        shouldSuspend: result === "blocked",
      };
    },
    assets: async (input) => {
      if (!await operations.preflightStageExecution({ ...input, stage: "assets" })) {
        return { handoff: "none", shouldSuspend: true };
      }
      await operations.enqueueCinematicAssetBatch(input);
      return { handoff: "assets_queued", shouldSuspend: false };
    },
  };

  const researchDefinition = createPipelineStepDefinition(CINEMATIC_PIPELINE_DEFINITION, "research");
  const researchStep = createStep({
    id: researchDefinition.stepId,
    inputSchema: CinematicWorkflowInputSchema,
    outputSchema: CinematicWorkflowCursorSchema,
    stateSchema: CinematicWorkflowStateSchema,
    retries: 0,
    execute: async (context) => {
      const { inputData, state } = context;
      try {
        if (!researchDefinition.shouldExecuteFrom(state.startStage)) {
          return workflowCursor(inputData, state.version);
        }
        const version = state.version + 1;
        const artifact = await operations.generateCinematicArtifact({
          ...inputData,
          stage: "research",
          version,
        });
        await operations.activateCinematicArtifact({
          ...inputData,
          version,
          artifact,
          requiresApproval: false,
        });
        await context.setState({
          ...state,
          version,
          currentArtifact: { stage: "research", version },
        });
        return workflowCursor(inputData, version);
      } catch (error: unknown) {
        await operations.fail(inputData, error);
        throw error;
      }
    },
  });

  const createReviewStep = (stage: ReviewStage) => {
    const definition = createPipelineStepDefinition(CINEMATIC_PIPELINE_DEFINITION, stage);
    return createStep({
      id: definition.stepId,
      inputSchema: CinematicWorkflowCursorSchema,
      outputSchema: CinematicWorkflowCursorSchema,
      stateSchema: CinematicWorkflowStateSchema,
      resumeSchema: VideoWorkflowInteractionSchema,
      suspendSchema: CinematicWorkflowSuspensionSchema,
      retries: 0,
      execute: async (context) => {
        const { inputData, resumeData, suspendData, state } = context;
        try {
          if (state.handoff === "consistency_reference_queued") return inputData;
          if (!definition.shouldExecuteFrom(state.startStage)) return inputData;
          if (resumeData) {
            const interactionKind = assertReviewInteraction(resumeData, stage);
            definition.assertInteractionAllowed(interactionKind);
            const suspension = CinematicWorkflowSuspensionSchema.parse(suspendData);
            if (suspension.workflowId !== inputData.workflowId || suspension.stage !== stage) {
              throw new Error(`Suspended workflow state does not match ${stage}.`);
            }
            if (interactionKind === "approve") {
              const executionReview = executionReviewHandlers[stage];
              if (definition.executionReview && !executionReview) {
                throw new Error(`Workflow stage ${stage} has no execution-review handler.`);
              }
              const result = executionReview
                ? await executionReview(workflowCursor(inputData, suspension.version))
                : { handoff: "none" as const, shouldSuspend: false };
              if (result.shouldSuspend) {
                return context.suspend({
                  workflowId: inputData.workflowId,
                  stage,
                  version: suspension.version,
                });
              }
              await context.setState({
                ...state,
                version: suspension.version,
                currentArtifact: { stage, version: suspension.version },
                handoff: result.handoff,
              });
              return workflowCursor(inputData, suspension.version);
            }
            const version = suspension.version + 1;
            const artifact = resumeData.type === "scene_durations"
              ? await operations.applySceneDurations({
                  ...inputData,
                  version,
                  scenes: resumeData.scenes,
                })
              : resumeData.type === "message"
                ? await operations.generateCinematicArtifact({
                  ...inputData,
                  stage,
                  version,
                  previousArtifactVersion: suspension.version,
                  revisionRequest: resumeData.text,
                })
                : (() => { throw new Error(`Interaction ${resumeData.type} cannot revise ${stage}.`); })();
            const revisionRequest = resumeData.type === "message"
              ? resumeData.text
              : "Per-scene final durations updated; model generation tiers rounded up.";
            await operations.activateCinematicArtifact({
              ...inputData,
              version,
              artifact,
              revisionRequest,
              requiresApproval: true,
            });
            await context.setState({ ...state, version, currentArtifact: { stage, version } });
            return context.suspend({ workflowId: inputData.workflowId, stage, version });
          }

          const version = inputData.version + 1;
          const artifact = await operations.generateCinematicArtifact({
            ...inputData,
            stage,
            version,
            previousArtifactVersion: previousArtifactVersion(inputData, stage),
            revisionRequest: inputData.restart?.targetStage === stage
              ? inputData.restart.text
              : undefined,
          });
          await operations.activateCinematicArtifact({
            ...inputData,
            version,
            artifact,
            revisionRequest: inputData.restart?.targetStage === stage
              ? inputData.restart.text
              : undefined,
            requiresApproval: true,
          });
          await context.setState({ ...state, version, currentArtifact: { stage, version } });
          return context.suspend({ workflowId: inputData.workflowId, stage, version });
        } catch (error: unknown) {
          await operations.fail(inputData, error);
          throw error;
        }
      },
    });
  };

  const proposalStep = createReviewStep("proposal");
  const scriptStep = createReviewStep("script");
  const scenePlanStep = createReviewStep("scene_plan");
  const consistencyReferenceStep = createReviewStep("consistency_reference");
  const assetsStep = createReviewStep("assets");
  const editDefinition = createPipelineStepDefinition(CINEMATIC_PIPELINE_DEFINITION, "edit");
  const editStep = createStep({
    id: editDefinition.stepId,
    inputSchema: CinematicWorkflowCursorSchema,
    outputSchema: CinematicWorkflowCursorSchema,
    stateSchema: CinematicWorkflowStateSchema,
    retries: 0,
    execute: async (context) => {
      const { inputData, state } = context;
      try {
        if (state.handoff !== "none") return inputData;
        const version = inputData.version + 1;
        const artifact = CinematicArtifactSchema.parse(
          await operations.generateCinematicArtifact({ ...inputData, stage: "edit", version }),
        );
        if (artifact.stage !== "edit") throw new Error("Cinematic edit artifact is invalid.");
        await operations.activateCinematicArtifact({
          ...inputData,
          version,
          artifact,
          requiresApproval: false,
        });
        await context.setState({
          ...state,
          version,
          currentArtifact: { stage: "edit", version },
        });
        return workflowCursor(inputData, version);
      } catch (error: unknown) {
        await operations.fail(inputData, error);
        throw error;
      }
    },
  });

  const generationDefinition = createPipelineStepDefinition(CINEMATIC_PIPELINE_DEFINITION, "compose");
  const videoGenerationStep = createStep({
    id: generationDefinition.stepId,
    inputSchema: CinematicWorkflowCursorSchema,
    outputSchema: CinematicWorkflowOutputSchema,
    stateSchema: CinematicWorkflowStateSchema,
    retries: 0,
    execute: async ({ inputData, state }) => {
      try {
        if (state.handoff !== "none") {
          return { workflowId: inputData.workflowId, status: "queued" as const };
        }
        await operations.enqueueCinematicVideoVersion({ ...inputData, version: inputData.version });
        return { workflowId: inputData.workflowId, status: "queued" as const };
      } catch (error: unknown) {
        await operations.fail(inputData, error);
        throw error;
      }
    },
  });

  return createWorkflow({
    id: CINEMATIC_WORKFLOW_ID,
    inputSchema: CinematicWorkflowInputSchema,
    outputSchema: CinematicWorkflowOutputSchema,
    stateSchema: CinematicWorkflowStateSchema,
    retryConfig: { attempts: 0, delay: 0 },
  })
    .then(researchStep)
    .then(proposalStep)
    .then(scriptStep)
    .then(scenePlanStep)
    .then(consistencyReferenceStep)
    .then(assetsStep)
    .then(editStep)
    .then(videoGenerationStep)
    .commit();
};
