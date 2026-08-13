import {
  CINEMATIC_PIPELINE_DEFINITION,
  findWorkflowStage,
  type CinematicArtifactVersion,
} from "@chat-to-video/contracts";

export const getCinematicStageLabel = (stageId: string): string =>
  findWorkflowStage(CINEMATIC_PIPELINE_DEFINITION, stageId)?.label ?? stageId;

export const getCinematicArtifactSummary = (version: CinematicArtifactVersion): string => {
  const artifact = version.artifact;
  if (artifact.stage === "research") return artifact.data.summary;
  if (artifact.stage === "proposal") {
    const selected = artifact.data.directions.find(
      (direction) => direction.id === artifact.data.recommendedDirectionId,
    );
    return selected?.logline ?? artifact.data.deliveryPromise;
  }
  if (artifact.stage === "script") return `${artifact.data.title} · ${artifact.data.beats.length} 个叙事节拍`;
  if (artifact.stage === "scene_plan") return `${artifact.data.scenes.length} 个场景 · ${artifact.data.aspectRatio}`;
  if (artifact.stage === "assets") {
    return `${artifact.data.assets.length} 项素材 · 预计 $${artifact.data.totalEstimatedCostUsd.toFixed(2)}`;
  }
  return `${artifact.data.timeline.length} 个剪辑段落 · FFmpeg 合成`;
};

export const getCinematicArtifactDuration = (version: CinematicArtifactVersion): number | null => {
  const artifact = version.artifact;
  if (artifact.stage === "research" || artifact.stage === "assets") return null;
  return artifact.data.durationSeconds;
};
