import {
  type CinematicArtifactVersion,
  type ConversationEntry,
} from "@chat-to-video/contracts";
import { describe, expect, it } from "vitest";

import { getWorkflowPreviewHistoryNodes } from "@/lib/workflow-preview-history";

const WORKFLOW_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_WORKFLOW_ID = "00000000-0000-4000-8000-000000000002";
const CREATED_AT = "2026-08-18T00:00:00.000Z";

const researchVersion = (
  version: number,
  isSuperseded = false,
): CinematicArtifactVersion => ({
  version,
  revisionRequest: null,
  artifact: {
    stage: "research",
    data: {
      summary: `Research version ${version}`,
      sourceMode: "generated",
      moodKeywords: ["cinematic", "quiet", "rainy"],
      visualReferences: [
        { title: "Reference A", description: "Description A", url: null },
        { title: "Reference B", description: "Description B", url: null },
        { title: "Reference C", description: "Description C", url: null },
      ],
      musicDirection: "Minimal strings",
      productionConstraints: ["Keep the subject readable"],
    },
  },
  isSuperseded,
  supersededAt: isSuperseded ? CREATED_AT : null,
  createdAt: CREATED_AT,
});

const artifactEntry = (
  id: string,
  workflowId: string,
  version: CinematicArtifactVersion,
): ConversationEntry => ({
  id,
  type: "cinematic_artifact",
  workflowId,
  artifact: version,
  createdAt: CREATED_AT,
});

describe("workflow preview history", () => {
  it("keeps the latest valid artifact from each previous stage", () => {
    const nodes = getWorkflowPreviewHistoryNodes([
      artifactEntry("research-v1", WORKFLOW_ID, researchVersion(1)),
      artifactEntry("research-v2", WORKFLOW_ID, researchVersion(2)),
      artifactEntry("research-v3", WORKFLOW_ID, researchVersion(3, true)),
      artifactEntry("other-workflow", OTHER_WORKFLOW_ID, researchVersion(4)),
    ], {
      workflowId: WORKFLOW_ID,
      pipeline: "cinematic",
      currentStage: "proposal",
    });

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: "research-v2",
      stage: "research",
      version: { version: 2 },
    });
  });

  it("does not expose the current or future stage as history", () => {
    expect(getWorkflowPreviewHistoryNodes([
      artifactEntry("research-current", WORKFLOW_ID, researchVersion(1)),
    ], {
      workflowId: WORKFLOW_ID,
      pipeline: "cinematic",
      currentStage: "research",
    })).toEqual([]);
  });
});
