import type { ConversationDetail, GeneratedVideoPromptTrace } from "@chat-to-video/contracts";

import { getConversation, listConversations } from "@/lib/conversation-client";

export type GeneratedVideoItem = {
  conversationId: string;
  createdAt: string;
  durationSeconds: number | null;
  id: string;
  playbackUrl: string;
  promptTrace: GeneratedVideoPromptTrace;
  resolution: string;
  themeName: string;
  title: string;
};

let generatedVideosCache: GeneratedVideoItem[] = [];
let generatedVideosRequest: Promise<GeneratedVideoItem[]> | null = null;

export const getCachedGeneratedVideos = (): readonly GeneratedVideoItem[] => generatedVideosCache;

const findGeneratedVideoMetadata = (
  conversation: ConversationDetail,
  workflowId: string,
  version: number,
): Pick<GeneratedVideoItem, "durationSeconds" | "themeName" | "title"> => {
  let durationSeconds: number | null = null;
  let durationVersion = 0;
  let themeName: string | null = null;
  let titleVersion = 0;
  for (const entry of conversation.entries) {
    if (entry.type === "storyboard" && entry.workflowId === workflowId && entry.storyboard.version === version) {
      return {
        durationSeconds: entry.storyboard.storyboard.shots.reduce(
          (total, shot) => total + shot.durationSeconds,
          0,
        ),
        themeName: entry.storyboard.storyboard.title,
        title: entry.storyboard.storyboard.title,
      };
    }
    if (entry.type !== "cinematic_artifact" || entry.workflowId !== workflowId || entry.artifact.version > version) continue;
    if (entry.artifact.artifact.stage === "edit" && entry.artifact.version >= durationVersion) {
      durationSeconds = entry.artifact.artifact.data.durationSeconds;
      durationVersion = entry.artifact.version;
    }
    if (entry.artifact.artifact.stage === "script" && entry.artifact.version >= titleVersion) {
      themeName = entry.artifact.artifact.data.title;
      titleVersion = entry.artifact.version;
    }
  }
  return {
    durationSeconds,
    themeName: themeName ?? "视频成片",
    title: themeName ?? "视频成片",
  };
};

export const generatedVideosFromConversation = (
  conversation: ConversationDetail,
): GeneratedVideoItem[] => {
  const videos: GeneratedVideoItem[] = conversation.entries.flatMap((entry) => {
    if (entry.type !== "archived_video") return [];
    const metadata = findGeneratedVideoMetadata(conversation, entry.workflowId, entry.storyboardVersion);
    return [{
        conversationId: conversation.conversationId,
        createdAt: entry.createdAt,
        durationSeconds: metadata.durationSeconds,
        id: entry.jobId,
        playbackUrl: entry.playbackUrl,
        promptTrace: entry.promptTrace,
        resolution: "720p",
        themeName: metadata.themeName,
        title: entry.videoTitle ?? metadata.title,
      }];
  });
  const workflow = conversation.videoWorkflow;
  if (
    workflow?.status === "succeeded"
    && workflow.videoJob?.status === "succeeded"
    && workflow.videoJob.playbackUrl
  ) {
    const metadata = findGeneratedVideoMetadata(
      conversation,
      workflow.workflowId,
      workflow.currentVersion,
    );
    videos.push({
      conversationId: conversation.conversationId,
      createdAt: workflow.updatedAt,
      durationSeconds: workflow.durationSeconds,
      id: workflow.videoJob.jobId,
      playbackUrl: workflow.videoJob.playbackUrl,
      promptTrace: workflow.promptTrace,
      resolution: "720p",
      themeName: metadata.themeName,
      title: workflow.videoJob.videoTitle ?? metadata.title,
    });
  }
  return videos;
};

export const conversationHasGeneratedVideo = (conversation: ConversationDetail): boolean =>
  generatedVideosFromConversation(conversation).length > 0;

export const listGeneratedVideos = async (): Promise<GeneratedVideoItem[]> => {
  if (generatedVideosRequest) return generatedVideosRequest;
  generatedVideosRequest = (async () => {
    const videos = new Map<string, GeneratedVideoItem>();
    const visitedCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await listConversations(cursor);
      const details = await Promise.all(
        page.items.map((item) => getConversation(item.conversationId)),
      );
      for (const detail of details) {
        for (const video of generatedVideosFromConversation(detail)) {
          videos.set(video.id, video);
        }
      }
      const nextCursor = page.nextCursor ?? undefined;
      if (nextCursor && visitedCursors.has(nextCursor)) throw new Error("会话分页游标重复，无法完整加载历史视频。");
      if (nextCursor) visitedCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);
    generatedVideosCache = [...videos.values()].toSorted((left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt)
    );
    return generatedVideosCache;
  })();
  try {
    return await generatedVideosRequest;
  } finally {
    generatedVideosRequest = null;
  }
};
