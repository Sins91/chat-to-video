import {
  CinematicDurationSecondsSchema,
  CinematicArtifactSchema,
  CinematicGenerativeStageSchema,
  VideoModelSchema,
  VideoWorkflowInteractionSchema,
  type CinematicGenerativeStage,
} from "@chat-to-video/contracts";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import type { VideoWorkflowOperations } from "../video-workflow/video-workflow.operations.js";

export const CINEMATIC_WORKFLOW_ID = "cinematic-production";
export const CINEMATIC_DIRECTOR_STEP_ID = "cinematic-director";

export const CinematicWorkflowInputSchema = z.object({
  workflowId: z.string().uuid(),
  requestId: z.string().uuid(),
  initialPrompt: z.string().trim().min(1).max(8_000),
  videoModel: VideoModelSchema,
  durationSeconds: CinematicDurationSecondsSchema,
}).strict();

const CinematicWorkflowOutputSchema = z.object({
  workflowId: z.string().uuid(),
  status: z.literal("queued"),
}).strict();

const CinematicWorkflowPhaseSchema = z.enum([
  "initial",
  "proposal_review",
  "script_review",
  "scene_plan_review",
  "assets_review",
  "queued",
]);

const CinematicWorkflowStateSchema = z.object({
  phase: CinematicWorkflowPhaseSchema,
  version: z.number().int().nonnegative(),
  currentArtifact: CinematicArtifactSchema.nullable(),
  revisionRequest: z.string().trim().min(1).max(2_000).nullable(),
}).strict();

const CinematicSuspensionSchema = z.object({
  workflowId: z.string().uuid(),
  stage: CinematicGenerativeStageSchema,
  version: z.number().int().positive(),
}).strict();

export type CinematicWorkflowInput = z.infer<typeof CinematicWorkflowInputSchema>;
export type CinematicWorkflowState = z.infer<typeof CinematicWorkflowStateSchema>;

export const initialCinematicState = (): CinematicWorkflowState => ({
  phase: "initial",
  version: 0,
  currentArtifact: null,
  revisionRequest: null,
});

const phaseStage = (
  phase: Exclude<CinematicWorkflowState["phase"], "initial" | "queued">,
): CinematicGenerativeStage => {
  const stages = {
    proposal_review: "proposal",
    script_review: "script",
    scene_plan_review: "scene_plan",
    assets_review: "assets",
  } as const;
  return stages[phase];
};

const nextReview = (
  phase: Exclude<CinematicWorkflowState["phase"], "initial" | "queued">,
): {
  stage: Exclude<CinematicGenerativeStage, "research" | "proposal" | "edit">;
  phase: Exclude<CinematicWorkflowState["phase"], "initial" | "proposal_review" | "queued">;
} | null => {
  if (phase === "proposal_review") return { stage: "script", phase: "script_review" };
  if (phase === "script_review") return { stage: "scene_plan", phase: "scene_plan_review" };
  if (phase === "scene_plan_review") return { stage: "assets", phase: "assets_review" };
  return null;
};

export const createCinematicWorkflow = (operations: VideoWorkflowOperations) => {
  const directorStep = createStep({
    id: CINEMATIC_DIRECTOR_STEP_ID,
    inputSchema: CinematicWorkflowInputSchema,
    outputSchema: CinematicWorkflowOutputSchema,
    stateSchema: CinematicWorkflowStateSchema,
    resumeSchema: VideoWorkflowInteractionSchema,
    suspendSchema: CinematicSuspensionSchema,
    retries: 0,
    execute: async (context) => {
      const { inputData, resumeData, state } = context;
      try {
        if (state.phase === "queued") {
          if (state.currentArtifact?.stage !== "edit" || state.version < 1) {
            throw new Error("Queued cinematic workflow state is incomplete.");
          }
          await operations.enqueueCinematicVideo({
            ...inputData,
            version: state.version,
            edit: state.currentArtifact,
          });
          return { workflowId: inputData.workflowId, status: "queued" as const };
        }

        if (state.phase === "initial") {
          const research = await operations.generateCinematicArtifact({
            ...inputData,
            stage: "research",
            version: 1,
          });
          await operations.activateCinematicArtifact({
            ...inputData,
            version: 1,
            artifact: research,
            requiresApproval: false,
          });
          const proposal = await operations.generateCinematicArtifact({
            ...inputData,
            stage: "proposal",
            version: 2,
          });
          await operations.activateCinematicArtifact({
            ...inputData,
            version: 2,
            artifact: proposal,
            requiresApproval: true,
          });
          const nextState: CinematicWorkflowState = {
            phase: "proposal_review",
            version: 2,
            currentArtifact: proposal,
            revisionRequest: null,
          };
          await context.setState(nextState);
          return context.suspend({
            workflowId: inputData.workflowId,
            stage: "proposal",
            version: 2,
          });
        }

        const currentStage = phaseStage(state.phase);
        if (!resumeData) {
          return context.suspend({
            workflowId: inputData.workflowId,
            stage: currentStage,
            version: state.version,
          });
        }

        if (resumeData.type === "scene_durations") {
          if (state.phase !== "scene_plan_review") {
            throw new Error("Scene durations can only be edited during scene plan review.");
          }
          const version = state.version + 1;
          const revised = await operations.applySceneDurations({
            ...inputData,
            version,
            scenes: resumeData.scenes,
          });
          const revisionRequest = "Per-scene final durations updated; model generation tiers rounded up.";
          await operations.activateCinematicArtifact({
            ...inputData,
            version,
            artifact: revised,
            revisionRequest,
            requiresApproval: true,
          });
          await context.setState({
            ...state,
            version,
            currentArtifact: revised,
            revisionRequest,
          });
          return context.suspend({
            workflowId: inputData.workflowId,
            stage: "scene_plan",
            version,
          });
        }

        if (resumeData.type === "message") {
          const version = state.version + 1;
          const revised = await operations.generateCinematicArtifact({
            ...inputData,
            stage: currentStage,
            version,
            previousArtifact: state.currentArtifact ?? undefined,
            revisionRequest: resumeData.text,
          });
          await operations.activateCinematicArtifact({
            ...inputData,
            version,
            artifact: revised,
            revisionRequest: resumeData.text,
            requiresApproval: true,
          });
          await context.setState({
            ...state,
            version,
            currentArtifact: revised,
            revisionRequest: resumeData.text,
          });
          return context.suspend({
            workflowId: inputData.workflowId,
            stage: currentStage,
            version,
          });
        }

        const next = nextReview(state.phase);
        if (next) {
          const version = state.version + 1;
          const artifact = await operations.generateCinematicArtifact({
            ...inputData,
            stage: next.stage,
            version,
          });
          await operations.activateCinematicArtifact({
            ...inputData,
            version,
            artifact,
            requiresApproval: true,
          });
          await context.setState({
            phase: next.phase,
            version,
            currentArtifact: artifact,
            revisionRequest: null,
          });
          return context.suspend({
            workflowId: inputData.workflowId,
            stage: next.stage,
            version,
          });
        }

        const version = state.version + 1;
        const edit = await operations.generateCinematicArtifact({
          ...inputData,
          stage: "edit",
          version,
        });
        if (edit.stage !== "edit") throw new Error("Cinematic edit artifact is invalid.");
        await operations.activateCinematicArtifact({
          ...inputData,
          version,
          artifact: edit,
          requiresApproval: false,
        });
        await context.setState({
          phase: "queued",
          version,
          currentArtifact: edit,
          revisionRequest: null,
        });
        await operations.enqueueCinematicVideo({
          ...inputData,
          version,
          edit,
        });
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
  }).then(directorStep).commit();
};
