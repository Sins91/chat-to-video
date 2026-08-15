import {
  CINEMATIC_PIPELINE_DEFINITION,
  CinematicArtifactSchema,
  CinematicGenerativeStageSchema,
  GeneratedVideoPromptTraceSchema,
  type CinematicArtifact,
  type GeneratedVideoPromptTrace,
  type Storyboard,
} from "@chat-to-video/contracts";

type ArtifactCandidate = {
  artifact: unknown;
  revisionRequest?: string | null;
  version: number;
};

const structuredContent = (value: unknown): string => JSON.stringify(value, null, 2);

export const buildGeneratedVideoPromptTrace = (input: {
  artifacts: readonly ArtifactCandidate[];
  initialPrompt: string;
  maxVersion: number;
  storyboard?: { storyboard: Storyboard; version: number } | null;
}): GeneratedVideoPromptTrace => {
  const trace: GeneratedVideoPromptTrace = [{
    id: "user-input",
    kind: "user_input",
    stageId: null,
    label: "用户原始输入",
    content: input.initialPrompt,
  }];
  const latestByStage = new Map<CinematicArtifact["stage"], {
    artifact: CinematicArtifact;
    revisionRequest: string | null;
    version: number;
  }>();
  for (const candidate of input.artifacts) {
    if (candidate.version > input.maxVersion) continue;
    const artifact = CinematicArtifactSchema.parse(candidate.artifact);
    const current = latestByStage.get(artifact.stage);
    if (!current || candidate.version > current.version) {
      latestByStage.set(artifact.stage, {
        artifact,
        revisionRequest: candidate.revisionRequest ?? null,
        version: candidate.version,
      });
    }
  }

  for (const stage of CINEMATIC_PIPELINE_DEFINITION.stages) {
    const parsedStage = CinematicGenerativeStageSchema.safeParse(stage.id);
    if (!stage.producesArtifact || !parsedStage.success) continue;
    const selected = latestByStage.get(parsedStage.data);
    if (!selected) continue;
    if (selected.revisionRequest) {
      trace.push({
        id: `revision-${stage.id}-v${selected.version}`,
        kind: "user_input",
        stageId: stage.id,
        label: `${stage.label} · 用户修改要求`,
        content: selected.revisionRequest,
      });
    }
    trace.push({
      id: `stage-${stage.id}-v${selected.version}`,
      kind: "stage_output",
      stageId: stage.id,
      label: `${stage.label}扩展 · V${selected.version}`,
      content: structuredContent(selected.artifact.data),
    });
    if (selected.artifact.stage === "assets") {
      selected.artifact.data.assets.forEach((asset, index) => {
        if (asset.kind !== "video" || asset.sourceMode !== "generate") return;
        trace.push({
          id: `video-model-scene-${asset.sceneOrder}-${index}`,
          kind: "video_model_input",
          stageId: "assets",
          label: `镜头 ${asset.sceneOrder} · 视频模型实际输入`,
          content: asset.prompt,
        });
      });
    }
    if (selected.artifact.stage === "edit") {
      trace.push({
        id: `compose-v${selected.version}`,
        kind: "compose_instruction",
        stageId: "edit",
        label: "最终合成提示词 · 未直接提交视频模型",
        content: selected.artifact.data.renderPrompt,
      });
    }
  }

  if (input.storyboard && input.storyboard.version <= input.maxVersion && latestByStage.size === 0) {
    trace.push({
      id: `stage-storyboard-v${input.storyboard.version}`,
      kind: "stage_output",
      stageId: "scene_plan",
      label: `分镜扩展 · V${input.storyboard.version}`,
      content: structuredContent(input.storyboard.storyboard),
    }, {
      id: `video-model-storyboard-v${input.storyboard.version}`,
      kind: "video_model_input",
      stageId: "scene_plan",
      label: "视频模型实际输入",
      content: input.storyboard.storyboard.videoPrompt,
    });
  }

  return GeneratedVideoPromptTraceSchema.parse(trace);
};
