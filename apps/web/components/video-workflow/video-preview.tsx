"use client";

import { CircleAlertIcon, FilmIcon, LoaderCircleIcon, LogOutIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { presentVideoFailure } from "@/lib/video-failure";
import { getVideoModelPresentation } from "@/lib/video-models";
import { getVideoOutputEstimate } from "@/lib/video-output-estimate";
import { CinematicArtifactCard } from "./cinematic-artifact-card";
import { CinematicAssetReviewCard } from "./cinematic-asset-review-card";
import { StoryboardArtifactCard } from "./storyboard-artifact-card";
import { VideoDownloadContextMenu } from "./video-download-context-menu";
import { useVideoWorkflow } from "./video-workflow-provider";
import { WorkflowStepStatusCard } from "./workflow-step-status-card";
const isQueuedStatus = (status: string): boolean => status === "queued";
const PREVIEW_LOADING_DELAY_MS = 200;

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


export function VideoWorkflowVisualization() {
  const { isLoading, previewVideo, refresh, returnToCurrentVideo, snapshot, stepProgress } = useVideoWorkflow();

  if (isLoading) {
    return <VisualizationLoading />;
  }
  const job = snapshot?.videoJob;
  const videoOutputEstimate = getVideoOutputEstimate(snapshot?.durationSeconds);

  if (snapshot?.status === "cancelled") {
    return <aside className="checkerboard grid h-full min-w-0 place-items-center p-6" aria-labelledby="visualization-title"><div className="flex max-w-sm items-center gap-4 text-zinc-500"><span className="grid size-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#111315]"><LogOutIcon className="size-5" /></span><div><h2 className="font-sans text-sm font-medium text-zinc-400" id="visualization-title">工作流已退出</h2><p className="mt-1 text-xs leading-5">当前预览已关闭，可以在左侧新建对话重新开始。</p></div></div></aside>;
  }

  if (previewVideo) {
    return <aside className="flex h-full min-w-0 flex-col bg-[#090a0b]" aria-labelledby="visualization-title">
      <header className="flex h-14 shrink-0 items-center border-b border-white/10 px-5"><FilmIcon className="size-4 text-violet-300" /><h2 className="ml-2 font-sans text-sm font-medium text-zinc-200" id="visualization-title">可视化结果</h2><span className="ml-auto text-xs text-zinc-400">视频 · 回看</span><Button className="ml-2 h-7 border-white/10 bg-transparent px-2 text-xs text-zinc-300 hover:bg-white/5 hover:text-white" onClick={() => void returnToCurrentVideo()} size="sm" type="button" variant="outline">返回当前</Button></header>
      <div className="checkerboard grid min-h-0 flex-1 place-items-center p-6"><DownloadablePreviewVideo key={previewVideo.id} video={previewVideo} /></div>
    </aside>;
  }

  if (snapshot?.status === "succeeded" && job?.playbackUrl) {
    return <aside className="flex h-full min-w-0 flex-col bg-[#090a0b]" aria-labelledby="visualization-title">
      <header className="flex h-14 shrink-0 items-center border-b border-white/10 px-5"><FilmIcon className="size-4 text-violet-300" /><h2 className="ml-2 font-sans text-sm font-medium text-zinc-200" id="visualization-title">可视化结果</h2><span className="ml-auto text-xs text-emerald-400">视频 · 已完成</span></header>
      <div className="checkerboard grid min-h-0 flex-1 place-items-center p-6"><DownloadablePreviewVideo onError={() => void refresh()} video={{ id: job.jobId, playbackUrl: job.playbackUrl, title: job.videoTitle ?? "视频成片" }} /></div>
    </aside>;
  }

  if (snapshot?.status === "failed") {
    const failure = presentVideoFailure(snapshot.errorMessage ?? job?.errorMessage ?? null);
    return <aside className="checkerboard grid h-full min-w-0 place-items-center p-6" aria-labelledby="visualization-title"><div className="max-w-sm rounded-xl border border-red-950 bg-[#111315]/95 p-6 text-center"><CircleAlertIcon className="mx-auto size-7 text-red-400" /><h2 className="mt-4 font-sans text-sm font-medium text-zinc-200" id="visualization-title">{failure.stage ? <>失败环节：{failure.stage}</> : "视频生成失败"}</h2><p className="mt-2 text-xs leading-5 text-zinc-500">{failure.detail}</p><Button className="mt-4" onClick={() => void refresh()} size="sm" type="button" variant="outline"><RefreshCwIcon />刷新状态</Button></div></aside>;
  }

  if (snapshot && isQueuedStatus(snapshot.status)) {
    const queueAhead = job?.queueAhead ?? null;
    const model = getVideoModelPresentation(snapshot.videoModel);
    const queueMessage = queueAhead === null
      ? "\u6b63\u5728\u83b7\u53d6\u5b9e\u65f6\u6392\u961f\u4f4d\u7f6e\u2026"
      : queueAhead === 0
        ? "\u524d\u65b9\u6ca1\u6709\u7b49\u5f85\u4efb\u52a1\uff0c\u5373\u5c06\u5f00\u59cb\u751f\u6210\u3002"
        : `\u524d\u65b9\u8fd8\u6709 ${queueAhead} \u4e2a\u4efb\u52a1\u3002`;
    return (
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
    );
  }

  if (snapshot?.status === "queued" || snapshot?.status === "running") {
    const progress = job?.progress ?? 0;
    const model = getVideoModelPresentation(snapshot.videoModel);
    const generationMessage = stepProgress?.stepId === "video-generation"
      ? stepProgress.message
      : "正在等待最新的视频生成状态。";
    return <aside className="checkerboard grid h-full min-w-0 place-items-center p-6" aria-labelledby="visualization-title"><div className="w-full max-w-md rounded-xl border border-white/10 bg-[#111315]/95 p-6"><div className="flex items-center"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><LoaderCircleIcon className="size-5 animate-spin" /></span><div className="ml-3 min-w-0"><h2 className="truncate font-sans text-sm font-medium text-zinc-200" id="visualization-title">{snapshot.status === "queued" ? `${model.name} 已进入队列` : `${model.name} 正在生成`}</h2><p className="mt-1 truncate text-xs text-zinc-500">{model.description} · 预计成片 {videoOutputEstimate.duration} · {videoOutputEstimate.resolution}</p></div><span className="ml-auto shrink-0 pl-3 font-numeric text-sm font-semibold tabular-nums text-zinc-300">{progress}%</span></div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-blue-500 transition-[width]" style={{ width: `${progress}%` }} /></div><p className="mt-3 text-xs font-medium leading-5 text-zinc-300" aria-live="polite">{generationMessage}</p><p className="mt-1 text-[11px] leading-5 text-zinc-500">生成通常需要数分钟，可以保留当前链接稍后继续查看。</p></div></aside>;
  }

  if (snapshot?.assetBatch || snapshot?.currentArtifact || snapshot?.storyboard) {
    const canReview = snapshot.status === "awaiting_input";
    return (
      <aside aria-label="结构化创作工作区" className="checkerboard h-full min-w-0 overflow-hidden">
        <ScrollArea className="h-full min-w-0">
          <div className="mx-auto min-h-full w-full max-w-3xl space-y-4 p-6">
            {stepProgress ? <WorkflowStepStatusCard progress={stepProgress} videoOutputEstimate={videoOutputEstimate} /> : null}
            {snapshot.assetBatch ? (
              <CinematicAssetReviewCard
                batch={snapshot.assetBatch}
                canReview={canReview && snapshot.assetBatch.status === "awaiting_approval"}
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
    );
  }

  if (stepProgress) {
    return (
      <aside
        aria-label="视频工作流进度"
        className="checkerboard h-full min-w-0 overflow-hidden"
      >
        <ScrollArea className="h-full min-w-0">
          <div className="grid min-h-full place-items-center p-6">
            <div className="w-full max-w-xl">
              <WorkflowStepStatusCard progress={stepProgress} videoOutputEstimate={videoOutputEstimate} />
            </div>
          </div>
        </ScrollArea>
      </aside>
    );
  }

  return <aside className="checkerboard grid h-full min-w-0 place-items-center" aria-labelledby="visualization-title"><div className="flex max-w-sm items-center gap-4 text-zinc-500"><span className="grid size-12 shrink-0 place-items-center rounded-xl border border-white/10 bg-[#111315]"><SparklesIcon className="size-5" /></span><div><h2 className="font-sans text-sm font-medium text-zinc-400" id="visualization-title">可视化工作区</h2><p className="mt-1 text-xs leading-5">Agent 生成的分镜、流程状态和媒体结果将在这里呈现</p></div></div></aside>;
}
