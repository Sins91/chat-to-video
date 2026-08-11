import type { VideoModel } from "@chat-to-video/contracts";

export type VideoModelPresentation = {
  id: VideoModel;
  name: string;
  description: string;
};

export const VIDEO_MODELS: readonly VideoModelPresentation[] = [
  { id: "MiniMax-Hailuo-2.3", name: "Hailuo 2.3", description: "单镜头最长 10 秒 · 768p" },
  { id: "doubao-seedance-2.0", name: "Seedance 2.0", description: "单镜头最长 15 秒 · 720p · 16:9 · 有声" },
];

const VIDEO_MODEL_BY_ID = new Map(VIDEO_MODELS.map((model) => [model.id, model]));

export const getVideoModelPresentation = (model: VideoModel): VideoModelPresentation => {
  const presentation = VIDEO_MODEL_BY_ID.get(model);
  if (!presentation) throw new Error(`Unsupported video model: ${model}`);
  return presentation;
};
