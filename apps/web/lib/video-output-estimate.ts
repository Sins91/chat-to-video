import {
  getRequestedVideoOutputResolution,
  type VideoOutputResolution,
} from "@chat-to-video/contracts";

export type VideoOutputEstimate = {
  duration: string;
  resolution: string;
};

export const getVideoOutputEstimate = (
  durationSeconds?: number | null,
  initialPrompt?: string | null,
  revisionPrompts: readonly string[] = [],
  outputResolution?: VideoOutputResolution | null,
): VideoOutputEstimate => ({
  duration: durationSeconds === null || durationSeconds === undefined ? "待确认" : `${durationSeconds} 秒`,
  resolution: outputResolution ?? getRequestedVideoOutputResolution(
    [initialPrompt, ...revisionPrompts].filter((prompt): prompt is string => Boolean(prompt)).join("\n"),
  ),
});
