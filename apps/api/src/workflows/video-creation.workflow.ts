import {
  StoryboardSchema,
  VideoModelSchema,
  VideoWorkflowInteractionSchema,
} from "@chat-to-video/contracts";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

import type { VideoWorkflowOperations } from "../video-workflow/video-workflow.operations.js";

export const VIDEO_CREATION_WORKFLOW_ID = "video-creation";
export const VIDEO_REVIEW_STEP_ID = "storyboard-review";

export const VideoCreationWorkflowInputSchema = z.object({
  workflowId: z.string().uuid(),
  requestId: z.string().uuid(),
  initialPrompt: z.string().trim().min(1).max(4_000),
  videoModel: VideoModelSchema,
}).strict();

const VideoCreationWorkflowOutputSchema = z.object({
  workflowId: z.string().uuid(),
  status: z.literal("queued"),
}).strict();

const VideoCreationWorkflowStateSchema = z.object({
  phase: z.enum(["initial", "awaiting_review", "queued"]),
  version: z.number().int().nonnegative(),
  storyboard: StoryboardSchema.nullable(),
  revisionRequest: z.string().trim().min(1).max(2_000).nullable(),
}).strict();

const ReviewSuspensionSchema = z.object({
  workflowId: z.string().uuid(),
  version: z.number().int().positive(),
}).strict();

export type VideoCreationWorkflowInput = z.infer<typeof VideoCreationWorkflowInputSchema>;
export type VideoCreationWorkflowState = z.infer<typeof VideoCreationWorkflowStateSchema>;

export const initialVideoCreationState = (): VideoCreationWorkflowState => ({
  phase: "initial",
  version: 0,
  storyboard: null,
  revisionRequest: null,
});

export const createVideoCreationWorkflow = (operations: VideoWorkflowOperations) => {
  const reviewStep = createStep({
    id: VIDEO_REVIEW_STEP_ID,
    inputSchema: VideoCreationWorkflowInputSchema,
    outputSchema: VideoCreationWorkflowOutputSchema,
    stateSchema: VideoCreationWorkflowStateSchema,
    resumeSchema: VideoWorkflowInteractionSchema,
    suspendSchema: ReviewSuspensionSchema,
    retries: 0,
    execute: async (context) => {
      const { inputData, resumeData, state } = context;
      try {
        if (state.phase === "queued") {
          if (!state.storyboard || state.version < 1) throw new Error("Queued workflow state is incomplete.");
          await operations.enqueueVideo({ ...inputData, version: state.version, storyboard: state.storyboard });
          return { workflowId: inputData.workflowId, status: "queued" as const };
        }

        if (state.phase === "awaiting_review" && resumeData?.type === "approve") {
          if (!state.storyboard || state.version < 1) throw new Error("Review workflow state is incomplete.");
          await context.setState({ ...state, phase: "queued" });
          await operations.enqueueVideo({ ...inputData, version: state.version, storyboard: state.storyboard });
          return { workflowId: inputData.workflowId, status: "queued" as const };
        }

        if (state.phase === "awaiting_review" && !resumeData) {
          return context.suspend({ workflowId: inputData.workflowId, version: state.version });
        }

        const version = state.phase === "initial" ? 1 : state.version + 1;
        const revisionRequest = resumeData?.type === "message" ? resumeData.text : undefined;
        const storyboard = await operations.generateStoryboard({
          ...inputData,
          version,
          previousStoryboard: state.storyboard ?? undefined,
          revisionRequest,
        });
        const nextState: VideoCreationWorkflowState = {
          phase: "awaiting_review",
          version,
          storyboard,
          revisionRequest: revisionRequest ?? null,
        };
        await operations.activateStoryboard({ ...inputData, version, storyboard, revisionRequest });
        await context.setState(nextState);
        return context.suspend({ workflowId: inputData.workflowId, version });
      } catch (error: unknown) {
        await operations.fail(inputData, error);
        throw error;
      }
    },
  });

  return createWorkflow({
    id: VIDEO_CREATION_WORKFLOW_ID,
    inputSchema: VideoCreationWorkflowInputSchema,
    outputSchema: VideoCreationWorkflowOutputSchema,
    stateSchema: VideoCreationWorkflowStateSchema,
    retryConfig: { attempts: 0, delay: 0 },
  }).then(reviewStep).commit();
};
