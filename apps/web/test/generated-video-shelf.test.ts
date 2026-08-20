import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("generated video shelf", () => {
  it("renders a single horizontally scrolling filmstrip below the preview", async () => {
    const [workspace, shelf, downloadMenu] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/agent-workspace.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/generated-video-shelf.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-download-context-menu.tsx"), "utf8"),
    ]);
    expect(workspace).toContain("<GeneratedVideoShelf />");
    expect(workspace.indexOf("<GeneratedVideoShelf />")).toBeGreaterThan(workspace.indexOf("<VideoWorkflowVisualization />"));
    expect(workspace).toContain("relative h-full min-h-0");
    expect(workspace).toContain('id="agent-preview"');
    expect(shelf).toContain("overflow-x-auto");
    expect(shelf).toContain("cursor-grabbing select-none");
    expect(shelf).toContain("onPointerDown={startHorizontalDrag}");
    expect(shelf).toContain("event.currentTarget.scrollLeft = dragState.startScrollLeft - distanceX");
    expect(shelf).toContain("onClickCapture={suppressClickAfterDrag}");
    expect(shelf).toContain("onWheel={scrollHorizontallyWithWheel}");
    expect(shelf).toContain("currentTargetScrollLeft + delta");
    expect(shelf).toContain("const WHEEL_SCROLL_SPEED_FACTOR = 0.6");
    expect(shelf).toContain("delta * WHEEL_SCROLL_SPEED_FACTOR");
    expect(shelf).toContain("const WHEEL_SCROLL_EASING_FACTOR = 0.18");
    expect(shelf).toContain("window.requestAnimationFrame(animateWheelScroll)");
    expect(shelf).toContain("scrollContainer.scrollLeft += distance * WHEEL_SCROLL_EASING_FACTOR");
    expect(shelf).toContain("useEffect(() => stopWheelScrollAnimation");
    expect(shelf).toContain("if (nextTargetScrollLeft === currentTargetScrollLeft");
    expect(shelf).toContain("flex min-w-max gap-1.5");
    expect(shelf).toContain('isExpanded ? "h-[130px]" : "h-5"');
    expect(shelf).toContain("transition-[height,box-shadow] duration-300");
    expect(shelf).toContain("onPointerEnter={expandShelf}");
    expect(shelf).toContain("onPointerLeave={scheduleShelfCollapse}");
    expect(shelf).toContain("onContextMenuOpenChange={handleContextMenuOpenChange}");
    expect(shelf).toContain("w-40 shrink-0");
    expect(shelf).toContain("h-[114px]");
    expect(shelf).not.toContain("h-[72px]");
    expect(shelf).not.toContain("h-16 w-24 shrink-0");
    expect(shelf).toContain("FilmPerforations");
    expect(shelf).toContain('aria-label="已生成视频胶片"');
    expect(shelf).not.toContain("<header");
    expect(shelf).not.toContain("GENERATED_VIDEO_DATE_FORMAT");
    expect(shelf).not.toContain("ring-primary");
    expect(shelf).toContain("getCachedGeneratedVideos");
    expect(shelf).not.toContain("video.themeName");
    expect(shelf).toContain("video.durationSeconds");
    expect(shelf).toContain("video.resolution");
    expect(shelf).toContain("absolute inset-x-0 bottom-0");
    expect(shelf).toContain("bottom-0 z-50 overflow-hidden");
    expect(shelf).not.toContain("bottom-0 z-20 overflow-hidden");
    expect(shelf).toContain("contrast-[1.08]");
    expect(shelf).toContain("saturate-[0.82]");
    expect(shelf).not.toContain("font-serif font-semibold");
    expect(shelf).toContain("font-numeric text-[8px] tabular-nums");
    expect(shelf).toContain("shadow-[inset_0_0_24px_8px_rgb(0_0_0/0.52)]");
    expect(shelf).not.toContain("ring-1 ring-white/10");
    expect(shelf).toContain("await openGeneratedVideo(video)");
    expect(shelf).not.toContain("if (video.conversationId === conversationId) return");
    expect(shelf).toContain("<VideoDownloadContextMenu");
    expect(downloadMenu).toContain("<ContextMenu.Root");
    expect(downloadMenu).toContain("<ContextMenu.Trigger");
    expect(downloadMenu).toContain("downloadGeneratedVideo(video)");
    expect(downloadMenu).toContain("下载视频…");
  });

  it("downloads a generated video to a user-selected location with a browser fallback", async () => {
    const download = await readFile(resolve(webRoot, "lib/video-download.ts"), "utf8");
    expect(download).toContain("showSaveFilePicker");
    expect(download).toContain("handle.createWritable()");
    expect(download).toContain("await writable.write(blob)");
    expect(download).toContain('error.name === "AbortError"');
    expect(download).toContain("fallbackDownload");
    expect(download).toContain('anchor.download = filename');
  });

  it("offers the same download action for archived videos in the conversation", async () => {
    const conversation = await readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8");
    expect(conversation).toContain("const ArchivedVideoMessage");
    expect(conversation).toContain("<VideoDownloadContextMenu");
    expect(conversation).toContain("video={{ id: entry.jobId, playbackUrl: entry.playbackUrl, title }}");
    expect(conversation).toContain('title={entry.videoTitle ?? "视频成片"}');
  });

  it("scrolls to a selected video's chat position and restores the previous conversation viewport", async () => {
    const [conversation, panel, provider] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
    ]);
    expect(provider).toContain("chatVideoFocusSequenceRef.current += 1");
    expect(provider).toContain("setChatVideoFocusRequest({ requestId: chatVideoFocusSequenceRef.current, videoId })");
    expect(provider).toContain("chatViewportControllerRef.current?.capture()");
    expect(provider).toContain("previewReturnLocationRef.current");
    expect(provider).toContain("await prepareConversationSwitch(returnLocation.conversationId)");
    expect(provider).toContain("setChatScrollRestoreRequest({");
    expect(provider.indexOf("chatViewportControllerRef.current?.capture()")).toBeLessThan(provider.indexOf("await prepareConversationSwitch(video.conversationId)"));
    expect(panel).toContain("scrollRestoreRequest={workflow.chatScrollRestoreRequest}");
    expect(panel).toContain("onViewportControllerChange={workflow.registerChatViewportController}");
    expect(conversation).toContain("data-chat-video-id={entry.jobId}");
    expect(conversation).toContain("data-chat-video-id={completedVideoJobId ?? undefined}");
    expect(conversation).toContain('querySelectorAll<HTMLElement>("[data-chat-video-id]")');
    expect(conversation).toContain("conversationContextRef.current?.stopScroll()");
    expect(conversation).toContain('initial={hasFocusedVideo ? false : "instant"}');
    expect(conversation).toContain("getChatVideoFocusScrollTop({");
    expect(conversation).toContain("scrollElement.scrollTop = getChatVideoFocusScrollTop");
    expect(conversation).not.toContain("scrollIntoView");
    expect(conversation).toContain("scrollElement.scrollTop = scrollRestoreRequest.location.scrollTop");
  });

  it("collects current and archived generated videos from conversation details", async () => {
    const client = await readFile(resolve(webRoot, "lib/generated-video-client.ts"), "utf8");
    expect(client).toContain('entry.type === "archived_video"');
    expect(client).toContain('workflow?.status === "succeeded"');
    expect(client).toContain("Promise.all(");
    expect(client).toContain("toSorted");
    expect(client).toContain("do {");
    expect(client).toContain("page.nextCursor");
    expect(client).toContain("visitedCursors");
    expect(client).toContain("generatedVideosCache");
    expect(client).toContain("generatedVideosRequest");
    expect(client).toContain('resolution: "720p"');
    expect(client).toContain("promptTrace: entry.promptTrace");
    expect(client).toContain("promptTrace: workflow.promptTrace");
    expect(client).toContain("storyboard.storyboard.title");
    expect(client).toContain("entry.artifact.version > version");
    expect(client).toContain("title: workflow.videoJob.videoTitle ?? metadata.title");
    expect(client).toContain("workflowId: entry.workflowId");
    expect(client).toContain("workflowId: workflow.workflowId");
  });

  it("shows and copies the originating prompt while reviewing a completed video", async () => {
    const [preview, provider] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
    ]);

    expect(preview).toContain("PromptTraceReview");
    expect(preview).toContain("提示词演进");
    expect(preview).toContain("navigator.clipboard.writeText(item.content)");
    expect(preview).toContain("promptTrace={previewVideo.promptTrace}");
    expect(preview).toContain("promptTrace={snapshot.promptTrace}");
    expect(preview).toContain("const MIN_PROMPT_TRACE_HEIGHT_PX = 160");
    expect(preview).toContain('className="absolute inset-x-0 bottom-0 z-30"');
    expect(preview).toContain("minHeight: MIN_PROMPT_TRACE_HEIGHT_PX");
    expect(preview).toContain("dragStart.heightPx + dragStart.pointerY - event.clientY");
    expect(preview).toContain("cursor-ns-resize touch-none");
    expect(preview).toContain('aria-label="调整提示词演进高度"');
    expect(preview).toContain("onPointerDown={startResize}");
    expect(preview).toContain("onKeyDown={resizeWithKeyboard}");
    expect(preview).not.toContain("ResizablePanelGroup");
    expect(preview.indexOf("<DownloadablePreviewVideo onError={onError} video={video} />")).toBeLessThan(
      preview.indexOf("<PromptTraceReview trace={promptTrace} />"),
    );
    expect(provider).toContain("promptTrace: video.promptTrace");
  });
});
