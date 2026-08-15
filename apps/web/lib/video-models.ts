import type { VideoModel } from "@chat-to-video/contracts";

export type VideoModelPresentation = {
  id: VideoModel;
  name: string;
  description: string;
};

export const VIDEO_MODELS: readonly VideoModelPresentation[] = [
  { id: "doubao-seedance-2.0", name: "Seedance 2.0", description: "单镜头最长 15 秒 · 720p · 16:9 · 有声" },
];

const VIDEO_MODEL_BY_ID = new Map<VideoModel, VideoModelPresentation>([
  ...VIDEO_MODELS.map((model) => [model.id, model] as const),
  ["MiniMax-Hailuo-2.3", {
    id: "MiniMax-Hailuo-2.3",
    name: "Hailuo 2.3（历史）",
    description: "历史工作流模型 · 不再用于新视频",
  }],
]);

export const getVideoModelPresentation = (model: VideoModel): VideoModelPresentation => {
  const presentation = VIDEO_MODEL_BY_ID.get(model);
  if (!presentation) throw new Error(`Unsupported video model: ${model}`);
  return presentation;
};
