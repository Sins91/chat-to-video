import {
  VideoWorkflowCompletionSchema,
  VideoWorkflowInteractionSchema,
  type Storyboard,
  type VideoWorkflowInteraction,
} from "@chat-to-video/contracts";
import { createHook } from "workflow";

import {
  activateStoryboardStep,
  completeWorkflowStep,
  enqueueVideoStep,
  failWorkflowStep,
  generateStoryboardStep,
} from "./video-creation.steps.js";

export type VideoCreationWorkflowInput = {
  workflowId: string;
  requestId: string;
  initialPrompt: string;
};

export async function videoCreationWorkflow(input: VideoCreationWorkflowInput): Promise<{ workflowId: string; status: "succeeded" | "failed" }> {
  "use workflow";

  let version = 1;
  let previousStoryboard: Storyboard | undefined;
  let revisionRequest: string | undefined;

  try {
    while (true) {
      const storyboard = await generateStoryboardStep({ ...input, version, previousStoryboard, revisionRequest });
      using reviewHook = createHook<VideoWorkflowInteraction>({ token: `video-workflow:${input.workflowId}:review:${version}` });
      const conflict = await reviewHook.getConflict();
      if (conflict) throw new Error("A review hook is already active for this storyboard version.");
      await activateStoryboardStep({ ...input, version, storyboard, revisionRequest });
      const interaction = VideoWorkflowInteractionSchema.parse(await reviewHook);
      if (interaction.type === "approve") {
        previousStoryboard = storyboard;
        break;
      }
      previousStoryboard = storyboard;
      revisionRequest = interaction.text;
      version += 1;
    }

    const jobId = `${input.workflowId}-v${version}`;
    using completionHook = createHook({ token: `video-workflow:${input.workflowId}:video:${jobId}` });
    const conflict = await completionHook.getConflict();
    if (conflict) throw new Error("A completion hook is already active for this video job.");
    await enqueueVideoStep({
      workflowId: input.workflowId,
      requestId: input.requestId,
      jobId,
      storyboardVersion: version,
      videoPrompt: previousStoryboard.videoPrompt,
      objectKey: `tenant/demo/project/demo/render/${jobId}/video.mp4`,
    });
    const completion = VideoWorkflowCompletionSchema.parse(await completionHook);
    await completeWorkflowStep({ ...input, completion });
    return { workflowId: input.workflowId, status: completion.status };
  } catch (error: unknown) {
    await failWorkflowStep({ ...input, message: error instanceof Error ? error.message : "视频工作流执行失败" });
    return { workflowId: input.workflowId, status: "failed" };
  }
}
