"use client";

import { CINEMATIC_PIPELINE_DEFINITION, type GeneratedVideoPromptTrace, type GeneratedVideoPromptTraceItem } from "@chat-to-video/contracts";
import { CheckIcon, CircleAlertIcon, CopyIcon, FilmIcon, LoaderCircleIcon, LogOutIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { presentVideoFailure } from "@/lib/video-failure";
import { getVideoModelPresentation } from "@/lib/video-models";
import { getVideoOutputEstimate } from "@/lib/video-output-estimate";
import {
  getCurrentWorkflowNodeLabel,
  getWorkflowPreviewHistoryNodes,
  type WorkflowPreviewHistoryNode,
} from "@/lib/workflow-preview-history";
import { CinematicArtifactCard } from "./cinematic-artifact-card";
import { CinematicAssetReviewCard } from "./cinematic-asset-review-card";
import { ConsistencyReferenceReviewCard } from "./consistency-reference-review-card";
import { StoryboardArtifactCard } from "./storyboard-artifact-card";
import { VideoDownloadContextMenu } from "./video-download-context-menu";
import { useVideoWorkflow } from "./video-workflow-provider";
import { WorkflowStepStatusCard } from "./workflow-step-status-card";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/src/components/ai-elements/task";
const isQueuedStatus = (status: string): boolean => status === "queued";
const PREVIEW_LOADING_DELAY_MS = 200;

const DEFAULT_PROMPT_TRACE_HEIGHT_PX = 288;
const MIN_PROMPT_TRACE_HEIGHT_PX = 160;
const PROMPT_TRACE_RESIZE_STEP_PX = 16;
const PROMPT_TRACE_TOP_GAP_PX = 24;

const CURRENT_WORKFLOW_NODE_VALUE = "current";

function WorkflowPreviewShell({
  children,
  contextLabel = "节点回看",
  currentLabel,
  historyNodes,
  onNodeChange,
  selectedNodeId,
}: {
  readonly children: ReactNode;
  readonly contextLabel?: string;
  readonly currentLabel: string;
  readonly historyNodes: readonly WorkflowPreviewHistoryNode[];
  readonly onNodeChange: (nodeId: string | null) => void;
  readonly selectedNodeId: string | null;
}) {
  const selectedValue = selectedNodeId ?? CURRENT_WORKFLOW_NODE_VALUE;
  const selectedNode = selectedNodeId
    ? historyNodes.find((node) => node.id === selectedNodeId) ?? null
    : null;
  const selectedNodeLabel = selectedNode
    ? "\u5df2\u5b8c\u6210 \u00b7 " + selectedNode.label
    : "\u5f53\u524d\u8282\u70b9 \u00b7 " + currentLabel;
  return (
    <aside aria-label={"\u7ed3\u6784\u5316\u521b\u4f5c\u5de5\u4f5c\u533a"} className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center border-b border-border px-5">
        <FilmIcon className="size-4 text-primary" />
        <h2 className="ml-2 font-sans text-sm font-medium text-foreground">{"\u53ef\u89c6\u5316\u7ed3\u679c"}</h2>
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">{contextLabel}</span>
        <Select
          disabled={historyNodes.length === 0}
          onValueChange={(value) => onNodeChange(
            value === null || value === CURRENT_WORKFLOW_NODE_VALUE ? null : value,
          )}
          value={selectedValue}
        >
          <SelectTrigger aria-label={"\u56de\u770b\u5de5\u4f5c\u6d41\u8282\u70b9"} className="ml-2 w-[min(15rem,55vw)]" size="sm">
            <SelectValue>{selectedNodeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value={CURRENT_WORKFLOW_NODE_VALUE}>{"\u5f53\u524d\u8282\u70b9 \u00b7 "}{currentLabel}</SelectItem>
            {historyNodes.length > 0 ? <SelectSeparator /> : null}
            {historyNodes.map((node) => (
              <SelectItem key={node.id} value={node.id}>{"\u5df2\u5b8c\u6210 \u00b7 "}{node.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>
      <div className="checkerboard min-h-0 flex-1 overflow-hidden">{children}</div>
    </aside>
  );
}

function VisualizationLoading() {
  const [isSpinnerVisible, setIsSpinnerVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsSpinnerVisible(true), PREVIEW_LOADING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return <aside aria-busy="true" aria-label="正在加载可视化内容" className="checkerboard grid h-full min-h-0 min-w-0 place-items-center overflow-hidden" role="status">
    {isSpinnerVisible ? <span className="animate-spin text-zinc-500"><LoaderCircleIcon className="size-5" /></span> : null}
  </aside>;
}

function DownloadablePreviewVideo({
  onError,
  video,
}: {
  onError?: () => void;
  video: { id: string; playbackUrl: string; title: string };
}) {
  return <VideoDownloadContextMenu
    triggerClassName="block min-h-0 max-h-full max-w-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    video={video}
  >
    <video className="max-h-full max-w-full cursor-pointer rounded-xl bg-black shadow-2xl" controls onError={onError} playsInline src={video.playbackUrl}>
      你的浏览器不支持视频播放。
    </video>
  </VideoDownloadContextMenu>;
}

function PromptTraceItem({ item }: { readonly item: GeneratedVideoPromptTraceItem }) {
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">("idle");
  const copyLabel = copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制提示词";

  const copyPrompt = () => {
    if (!navigator.clipboard) {
      setCopyState("failed");
      return;
    }
    void navigator.clipboard.writeText(item.content).then(
      () => setCopyState("copied"),
      () => setCopyState("failed"),
    );
  };

  return <Task className="border-b border-white/5 last:border-b-0" defaultOpen={item.kind === "video_model_input"}>
    <TaskTrigger
      className={item.kind === "video_model_input" ? "text-violet-200" : "text-zinc-400"}
      status="completed"
      title={item.label}
    />
    <TaskContent className="mb-2 mt-1 border-white/10">
      <TaskItem className="flex items-start gap-3 py-2">
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-sans text-xs leading-5 text-zinc-400">{item.content}</pre>
        <Button aria-live="polite" className="h-7 shrink-0 px-2 text-xs" onClick={copyPrompt} size="sm" type="button" variant="ghost">
          {copyState === "copied" ? <CheckIcon className="size-3.5 text-emerald-400" /> : <CopyIcon className="size-3.5" />}
          {copyLabel}
        </Button>
      </TaskItem>
    </TaskContent>
  </Task>;
}

function PromptTraceReview({ trace }: { readonly trace: GeneratedVideoPromptTrace }) {
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">("idle");
  const [isOpen, setIsOpen] = useState(false);
  const [panelHeightPx, setPanelHeightPx] = useState(DEFAULT_PROMPT_TRACE_HEIGHT_PX);
  const dragStartRef = useRef<{ heightPx: number; pointerId: number; pointerY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const copyLabel = copyState === "copied" ? "已复制全部" : copyState === "failed" ? "复制失败" : "复制全部";
  const clampPanelHeight = (heightPx: number): number => {
    const containerHeightPx = panelRef.current?.parentElement?.clientHeight ?? DEFAULT_PROMPT_TRACE_HEIGHT_PX;
    const maxHeightPx = Math.max(MIN_PROMPT_TRACE_HEIGHT_PX, containerHeightPx - PROMPT_TRACE_TOP_GAP_PX);
    return Math.min(Math.max(heightPx, MIN_PROMPT_TRACE_HEIGHT_PX), maxHeightPx);
  };
  const copyAll = () => {
    if (!navigator.clipboard) {
      setCopyState("failed");
      return;
    }
    const text = trace.map((item) => `${item.label}\n${item.content}`).join("\n\n");
    void navigator.clipboard.writeText(text).then(
      () => setCopyState("copied"),
      () => setCopyState("failed"),
    );
  };
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      heightPx: panelRef.current?.getBoundingClientRect().height ?? panelHeightPx,
      pointerId: event.pointerId,
      pointerY: event.clientY,
    };
  };
  const resizePanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    setPanelHeightPx(clampPanelHeight(dragStart.heightPx + dragStart.pointerY - event.clientY));
  };
  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1;
    setPanelHeightPx((heightPx) => clampPanelHeight(heightPx + direction * PROMPT_TRACE_RESIZE_STEP_PX));
  };

  return <div
    className="absolute inset-x-0 bottom-0 z-30"
    ref={panelRef}
    style={isOpen ? {
      height: panelHeightPx,
      maxHeight: `calc(100% - ${PROMPT_TRACE_TOP_GAP_PX}px)`,
      minHeight: MIN_PROMPT_TRACE_HEIGHT_PX,
    } : undefined}
  >
    {isOpen ? <div
      aria-label="调整提示词演进高度"
      aria-orientation="horizontal"
      aria-valuemin={MIN_PROMPT_TRACE_HEIGHT_PX}
      aria-valuenow={Math.round(panelHeightPx)}
      className="absolute inset-x-0 top-0 z-40 flex h-3 -translate-y-1/2 cursor-ns-resize touch-none items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={resizeWithKeyboard}
      onPointerCancel={finishResize}
      onPointerDown={startResize}
      onPointerMove={resizePanel}
      onPointerUp={finishResize}
      role="separator"
      tabIndex={0}
    >
      <span aria-hidden="true" className="h-1 w-10 rounded-full bg-zinc-500/80 shadow-sm" />
    </div> : null}
    <Task className="relative z-30 flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#111315]/95 px-4 py-2" onOpenChange={setIsOpen} open={isOpen}>
      <div className="flex items-center gap-2">
        <TaskTrigger className="min-w-0 flex-1 text-zinc-300" status="completed" title={`提示词演进 · ${trace.length} 项`} />
        <Button aria-live="polite" className="h-7 shrink-0 px-2 text-xs" onClick={copyAll} size="sm" type="button" variant="ghost">
          {copyState === "copied" ? <CheckIcon className="size-3.5 text-emerald-400" /> : <CopyIcon className="size-3.5" />}
          {copyLabel}
        </Button>
      </div>
      <TaskContent className="min-h-0 flex-1 overflow-y-auto border-white/10 pr-2">
        {trace.map((item) => <PromptTraceItem item={item} key={item.id} />)}
      </TaskContent>
    </Task>
  </div>;
}

function CompletedVideoReview({
  onError,
  promptTrace,
  video,
}: {
  readonly onError?: () => void;
  readonly promptTrace: GeneratedVideoPromptTrace;
  readonly video: { id: string; playbackUrl: string; title: string };
}) {
  return <div className="relative size-full min-h-0 max-w-4xl">
    <div className="grid size-full min-h-0 place-items-center">
      <DownloadablePreviewVideo onError={onError} video={video} />
    </div>
    <PromptTraceReview trace={promptTrace} />
  </div>;
}


export function VideoWorkflowVisualization() {
  const { entries, isLoading, previewVideo, refresh, returnToCurrentVideo, snapshot, stepProgress } = useVideoWorkflow();
  const [historySelection, setHistorySelection] = useState<{ nodeId: string; workflowId: string } | null>(null);
  const historyWorkflowId = previewVideo?.workflowId ?? snapshot?.workflowId ?? null;
  const historyPipeline = previewVideo?.workflowSnapshot.pipeline ?? snapshot?.pipeline ?? CINEMATIC_PIPELINE_DEFINITION.id;
  const historyCurrentStage = previewVideo ? null : snapshot?.currentStage ?? null;
  const historySnapshot = previewVideo?.workflowSnapshot ?? snapshot;
  const historyNodes = useMemo(
    () => historyWorkflowId && historyPipeline
      ? getWorkflowPreviewHistoryNodes(entries, {
          currentStage: historyCurrentStage,
          pipeline: historyPipeline,
          workflowId: historyWorkflowId,
        })
      : [],
    [entries, historyCurrentStage, historyPipeline, historyWorkflowId],
  );
  const selectedHistoryNodeId = historySelection &&
      historySelection.workflowId === historyWorkflowId
    ? historySelection.nodeId
    : null;
  const selectedHistoryNode = historyNodes.find((node) => node.id === selectedHistoryNodeId) ?? null;
  const currentNodeLabel = previewVideo
    ? "视频成片"
    : snapshot
      ? getCurrentWorkflowNodeLabel(snapshot)
      : stepProgress?.stepLabel ?? "current";
  const selectHistoryNode = (nodeId: string | null) => {
    setHistorySelection(nodeId && historyWorkflowId
      ? { nodeId, workflowId: historyWorkflowId }
      : null);
  };

  if (isLoading) {
    return <VisualizationLoading />;
  }
  const job = snapshot?.videoJob;
  const videoOutputEstimate = getVideoOutputEstimate(
    snapshot?.durationSeconds,
    snapshot?.initialPrompt,
    entries.flatMap((entry) => entry.type === "text" && entry.role === "user" ? [entry.content] : []),
    snapshot?.outputResolution,
  );

  if (historyWorkflowId && selectedHistoryNode) {
    return (
      <WorkflowPreviewShell
        currentLabel={currentNodeLabel}
        historyNodes={historyNodes}
        onNodeChange={selectHistoryNode}
        selectedNodeId={selectedHistoryNode.id}
      >
        <ScrollArea className="h-full min-w-0">
          <div className="mx-auto min-h-full w-full max-w-3xl space-y-4 p-6">
            {historySnapshot?.workflowId === historyWorkflowId &&
                selectedHistoryNode.version.artifact.stage === "consistency_reference" &&
                historySnapshot.consistencyReferenceBatch?.planVersion === selectedHistoryNode.version.version ? (
              <ConsistencyReferenceReviewCard
                artifact={selectedHistoryNode.version.artifact}
                batch={historySnapshot.consistencyReferenceBatch}
              />
            ) : null}
            {historySnapshot?.workflowId === historyWorkflowId &&
                selectedHistoryNode.version.artifact.stage === "assets" &&
                historySnapshot.assetBatch?.planVersion === selectedHistoryNode.version.version ? (
              <CinematicAssetReviewCard
                batch={historySnapshot.assetBatch}
              />
            ) : null}
            <CinematicArtifactCard
              canReview={false}
              key={selectedHistoryNode.id}
              version={selectedHistoryNode.version}
            />
          </div>
        </ScrollArea>
      </WorkflowPreviewShell>
    );
  }

  if (snapshot?.status === "cancelled") {
    return <WorkflowPreviewShell currentLabel={currentNodeLabel} historyNodes={historyNodes} onNodeChange={selectHistoryNode} selectedNodeId={null}>
      <aside className="grid h-full min-w-0 place-items-center p-6" aria-labelledby="visualization-title"><div className="flex max-w-sm items-center gap-4 text-zinc-500"><span className="grid size-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#111315]"><LogOutIcon className="size-5" /></span><div><h2 className="font-sans text-sm font-medium text-zinc-400" id="visualization-title">工作流已退出</h2><p className="mt-1 text-xs leading-5">当前预览已关闭，可以在左侧新建对话重新开始。</p></div></div></aside>
    </WorkflowPreviewShell>;
  }

  if (previewVideo) {
    return <WorkflowPreviewShell contextLabel="视频 · 回看" currentLabel={currentNodeLabel} historyNodes={historyNodes} onNodeChange={selectHistoryNode} selectedNodeId={null}>
      <div className="relative grid h-full min-h-0 place-items-center p-6">
        <CompletedVideoReview key={previewVideo.id} promptTrace={previewVideo.promptTrace} video={previewVideo} />
        <Button className="absolute right-4 top-4 z-20 h-7 border-white/10 bg-background/80 px-2 text-xs backdrop-blur hover:bg-background" onClick={() => void returnToCurrentVideo()} size="sm" type="button" variant="outline">返回当前</Button>
      </div>
    </WorkflowPreviewShell>;
  }

  if (snapshot?.status === "succeeded" && job?.playbackUrl) {
    return <WorkflowPreviewShell contextLabel="视频 · 已完成" currentLabel={currentNodeLabel} historyNodes={historyNodes} onNodeChange={selectHistoryNode} selectedNodeId={null}>
      <div className="grid h-full min-h-0 place-items-center p-6"><CompletedVideoReview onError={() => void refresh()} promptTrace={snapshot.promptTrace} video={{ id: job.jobId, playbackUrl: job.playbackUrl, title: job.videoTitle ?? "视频成片" }} /></div>
    </WorkflowPreviewShell>;
  }

  if (snapshot?.status === "failed") {
    const failure = presentVideoFailure(snapshot.errorMessage ?? job?.errorMessage ?? null);
    return <WorkflowPreviewShell currentLabel={currentNodeLabel} historyNodes={historyNodes} onNodeChange={selectHistoryNode} selectedNodeId={null}>
      <aside className="grid h-full min-w-0 place-items-center p-6" aria-labelledby="visualization-title"><div className="max-w-sm rounded-xl border border-red-950 bg-[#111315]/95 p-6 text-center"><CircleAlertIcon className="mx-auto size-7 text-red-400" /><h2 className="mt-4 font-sans text-sm font-medium text-zinc-200" id="visualization-title">{failure.stage ? <>失败环节：{failure.stage}</> : "视频生成失败"}</h2><p className="mt-2 text-xs leading-5 text-zinc-500">{failure.detail}</p><Button className="mt-4" onClick={() => void refresh()} size="sm" type="button" variant="outline"><RefreshCwIcon />刷新状态</Button></div></aside>
    </WorkflowPreviewShell>;
  }

  if (snapshot && job && isQueuedStatus(snapshot.status)) {
    const queueAhead = job.queueAhead ?? null;
    const model = getVideoModelPresentation(snapshot.videoModel);
    const queueMessage = queueAhead === null
      ? "\u6b63\u5728\u83b7\u53d6\u5b9e\u65f6\u6392\u961f\u4f4d\u7f6e\u2026"
      : queueAhead === 0
        ? "\u524d\u65b9\u6ca1\u6709\u7b49\u5f85\u4efb\u52a1\uff0c\u5373\u5c06\u5f00\u59cb\u751f\u6210\u3002"
        : `\u524d\u65b9\u8fd8\u6709 ${queueAhead} \u4e2a\u4efb\u52a1\u3002`;
    return (
      <WorkflowPreviewShell
        currentLabel={currentNodeLabel}
        historyNodes={historyNodes}
        onNodeChange={selectHistoryNode}
        selectedNodeId={null}
      >
      <aside
        aria-labelledby="visualization-title"
        className="checkerboard grid h-full min-w-0 place-items-center p-6"
      >
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111315]/95 p-6">
          <div className="flex items-center">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
              <LoaderCircleIcon className="size-5 animate-spin" />
            </span>
            <div className="ml-3 min-w-0">
              <h2 className="truncate font-sans text-sm font-medium text-zinc-200" id="visualization-title">
                {`${model.name} \u5df2\u8fdb\u5165\u961f\u5217`}
              </h2>
              <p className="mt-1 truncate text-xs text-zinc-500">{model.description} · 预计成片 {videoOutputEstimate.duration} · {videoOutputEstimate.resolution}</p>
            </div>
            <span className="ml-auto shrink-0 pl-3 font-numeric text-sm font-semibold tabular-nums text-zinc-300">
              {queueAhead === null ? "\u6392\u961f\u4e2d" : `\u524d\u65b9 ${queueAhead}`}
            </span>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-0 rounded-full bg-gradient-to-r from-fuchsia-500 to-blue-500" />
          </div>
          <p className="mt-3 text-xs font-medium text-zinc-300">{queueMessage}</p>
          <p className="mt-1 text-[11px] leading-5 text-zinc-500">
            {"\u6392\u961f\u4f4d\u7f6e\u6bcf\u0020\u0035\u0020\u79d2\u5237\u65b0\uff0c\u4efb\u52a1\u5f00\u59cb\u540e\u4f1a\u81ea\u52a8\u5207\u6362\u4e3a\u751f\u6210\u8fdb\u5ea6\u3002"}
          </p>
        </div>
      </aside>
      </WorkflowPreviewShell>
    );
  }

  if (job && snapshot?.status === "running") {
    const progress = job.progress ?? 0;
    const model = getVideoModelPresentation(snapshot.videoModel);
    const generationMessage = stepProgress?.stepId === "video-generation"
      ? stepProgress.message
      : "\u6b63\u5728\u7b49\u5f85\u6700\u65b0\u7684\u89c6\u9891\u751f\u6210\u72b6\u6001\u3002";
    return (
      <WorkflowPreviewShell
        currentLabel={currentNodeLabel}
        historyNodes={historyNodes}
        onNodeChange={selectHistoryNode}
        selectedNodeId={null}
      >
        <aside
          aria-labelledby="visualization-title"
          className="grid h-full min-w-0 place-items-center p-6"
        >
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111315]/95 p-6">
            <div className="flex items-center">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
                <LoaderCircleIcon className="size-5 animate-spin" />
              </span>
              <div className="ml-3 min-w-0">
                <h2 className="truncate font-sans text-sm font-medium text-zinc-200" id="visualization-title">
                  {`${model.name} \u6b63\u5728\u751f\u6210`}
                </h2>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {model.description}{" \u00b7 \u9884\u8ba1\u6210\u7247 "}{videoOutputEstimate.duration}{" \u00b7 "}{videoOutputEstimate.resolution}
                </p>
              </div>
              <span className="ml-auto shrink-0 pl-3 font-numeric text-sm font-semibold tabular-nums text-zinc-300">{progress}%</span>
            </div>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-blue-500 transition-[width]" style={{ width: `${progress}%` }} />
            </div>
            <p aria-live="polite" className="mt-3 text-xs font-medium leading-5 text-zinc-300">{generationMessage}</p>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500">{"\u751f\u6210\u901a\u5e38\u9700\u8981\u6570\u5206\u949f\uff0c\u53ef\u4ee5\u4fdd\u7559\u5f53\u524d\u94fe\u63a5\u7a0d\u540e\u7ee7\u7eed\u67e5\u770b\u3002"}</p>
          </div>
        </aside>
      </WorkflowPreviewShell>
    );
  }

  if (snapshot?.consistencyReferenceBatch || snapshot?.assetBatch || snapshot?.currentArtifact || snapshot?.storyboard) {
    const canReview = snapshot.status === "awaiting_input";
    return (
      <WorkflowPreviewShell
        currentLabel={currentNodeLabel}
        historyNodes={historyNodes}
        onNodeChange={selectHistoryNode}
        selectedNodeId={null}
      >
      <aside aria-label="结构化创作工作区" className="checkerboard h-full min-w-0 overflow-hidden">
        <ScrollArea className="h-full min-w-0">
          <div className="mx-auto min-h-full w-full max-w-3xl space-y-4 p-6">
            {stepProgress ? <WorkflowStepStatusCard pipelineId={snapshot.pipeline} progress={stepProgress} videoOutputEstimate={videoOutputEstimate} /> : null}
            {snapshot.consistencyReferenceBatch && snapshot.currentArtifact?.artifact.stage === "consistency_reference" ? (
              <ConsistencyReferenceReviewCard
                artifact={snapshot.currentArtifact.artifact}
                batch={snapshot.consistencyReferenceBatch}
              />
            ) : null}
            {snapshot.assetBatch ? (
              <CinematicAssetReviewCard
                batch={snapshot.assetBatch}
              />
            ) : null}
            {snapshot.currentArtifact ? (
              <CinematicArtifactCard
                canReview={canReview}
                version={snapshot.currentArtifact}
              />
            ) : snapshot.storyboard ? (
              <StoryboardArtifactCard canReview={canReview} version={snapshot.storyboard} />
            ) : null}
          </div>
        </ScrollArea>
      </aside>
      </WorkflowPreviewShell>
    );
  }

  if (stepProgress) {
    return (
      <WorkflowPreviewShell
        currentLabel={currentNodeLabel}
        historyNodes={historyNodes}
        onNodeChange={selectHistoryNode}
        selectedNodeId={null}
      >
      <aside
        aria-label="视频工作流进度"
        className="checkerboard h-full min-w-0 overflow-hidden"
      >
        <ScrollArea className="h-full min-w-0">
          <div className="grid min-h-full place-items-center p-6">
            <div className="w-full max-w-xl">
              <WorkflowStepStatusCard pipelineId={snapshot?.pipeline} progress={stepProgress} videoOutputEstimate={videoOutputEstimate} />
            </div>
          </div>
        </ScrollArea>
      </aside>
      </WorkflowPreviewShell>
    );
  }

  return <aside className="checkerboard grid h-full min-w-0 place-items-center" aria-labelledby="visualization-title"><div className="flex max-w-sm items-center gap-4 text-zinc-500"><span className="grid size-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#111315]"><SparklesIcon className="size-5" /></span><div><h2 className="font-sans text-sm font-medium text-zinc-400" id="visualization-title">可视化工作区</h2><p className="mt-1 text-xs leading-5">管线编排生成的规划、流程状态和媒体结果将在这里呈现</p></div></div></aside>;
}
