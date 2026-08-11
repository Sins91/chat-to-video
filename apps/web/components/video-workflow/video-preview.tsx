"use client";

import { CircleAlertIcon, FilmIcon, LoaderCircleIcon, MonitorPlayIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { presentVideoFailure } from "@/lib/video-failure";
import { getVideoModelPresentation } from "@/lib/video-models";
import { useVideoWorkflow } from "./video-workflow-provider";
const isQueuedStatus = (status: string): boolean => status === "queued";


export function VideoPreview() {
  const { isLoading, snapshot, stepProgress, refresh } = useVideoWorkflow();

  if (isLoading) {
    return <aside aria-busy="true" className="checkerboard h-full min-h-0 min-w-0 overflow-hidden" />;
  }
  const job = snapshot?.videoJob;

  if (snapshot?.status === "succeeded" && job?.playbackUrl) {
    return <aside className="flex h-full min-w-0 flex-col bg-[#090a0b]" aria-labelledby="preview-title">
      <header className="flex h-14 shrink-0 items-center border-b border-white/10 px-5"><FilmIcon className="size-4 text-violet-300" /><h2 className="ml-2 text-sm font-medium text-zinc-200" id="preview-title">生成结果</h2><span className="ml-auto text-xs text-emerald-400">已完成</span></header>
      <div className="checkerboard grid min-h-0 flex-1 place-items-center p-6"><video className="max-h-full max-w-full rounded-xl bg-black shadow-2xl" controls onError={() => void refresh()} playsInline src={job.playbackUrl}>你的浏览器不支持视频播放。</video></div>
    </aside>;
  }

  if (snapshot?.status === "failed") {
    const failure = presentVideoFailure(snapshot.errorMessage ?? job?.errorMessage ?? null);
    return <aside className="checkerboard grid h-full min-w-0 place-items-center p-6" aria-labelledby="preview-title"><div className="max-w-sm rounded-2xl border border-red-950 bg-[#111315]/95 p-6 text-center"><CircleAlertIcon className="mx-auto size-7 text-red-400" /><h2 className="mt-4 text-sm font-medium text-zinc-200" id="preview-title">{failure.stage ? <>失败环节：{failure.stage}</> : "视频生成失败"}</h2><p className="mt-2 text-xs leading-5 text-zinc-500">{failure.detail}</p><Button className="mt-4" onClick={() => void refresh()} size="sm" type="button" variant="outline"><RefreshCwIcon />刷新状态</Button></div></aside>;
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
        aria-labelledby="preview-title"
        className="checkerboard grid h-full min-w-0 place-items-center p-6"
      >
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111315]/95 p-6">
          <div className="flex items-center">
            <span className="grid size-10 place-items-center rounded-xl bg-violet-500/15 text-violet-300">
              <LoaderCircleIcon className="size-5 animate-spin" />
            </span>
            <div className="ml-3">
              <h2 className="text-sm font-medium text-zinc-200" id="preview-title">
                {`${model.name} \u5df2\u8fdb\u5165\u961f\u5217`}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">{model.description}</p>
            </div>
            <span className="ml-auto text-sm font-semibold text-zinc-300">
              {queueAhead === null ? "\u6392\u961f\u4e2d" : `\u524d\u65b9 ${queueAhead}`}
            </span>
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-0 rounded-full bg-gradient-to-r from-fuchsia-500 to-blue-500" />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/5 p-3"><div><dt className="text-[10px] text-zinc-500">目标时长</dt><dd className="mt-1 text-xs font-medium text-zinc-300">{snapshot.durationSeconds} 秒</dd></div><div><dt className="text-[10px] text-zinc-500">生成进度</dt><dd className="mt-1 text-xs font-medium text-zinc-300">等待开始</dd></div></dl>
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
    return <aside className="checkerboard grid h-full min-w-0 place-items-center p-6" aria-labelledby="preview-title"><div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111315]/95 p-6"><div className="flex items-center"><span className="grid size-10 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><LoaderCircleIcon className="size-5 animate-spin" /></span><div className="ml-3"><h2 className="text-sm font-medium text-zinc-200" id="preview-title">{snapshot.status === "queued" ? `${model.name} 已进入队列` : `${model.name} 正在生成`}</h2><p className="mt-1 text-xs text-zinc-500">{model.description}</p></div><span className="ml-auto text-sm font-semibold text-zinc-300">{progress}%</span></div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-blue-500 transition-[width]" style={{ width: `${progress}%` }} /></div><dl className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/5 p-3"><div><dt className="text-[10px] text-zinc-500">目标时长</dt><dd className="mt-1 text-xs font-medium text-zinc-300">{snapshot.durationSeconds} 秒</dd></div><div><dt className="text-[10px] text-zinc-500">生成进度</dt><dd className="mt-1 text-xs font-medium text-zinc-300">{progress}%</dd></div></dl><p className="mt-3 text-xs font-medium leading-5 text-zinc-300" aria-live="polite">{generationMessage}</p><p className="mt-1 text-[11px] leading-5 text-zinc-500">生成通常需要数分钟，可以保留当前链接稍后继续查看。</p></div></aside>;
  }

  return <aside className="checkerboard grid h-full min-w-0 place-items-center" aria-labelledby="preview-title"><div className="flex items-center gap-4 text-zinc-500"><span className="grid size-12 place-items-center rounded-xl border border-white/10 bg-[#111315]"><MonitorPlayIcon className="size-5" /></span><div><h2 className="text-sm font-medium text-zinc-400" id="preview-title">视频工作区</h2><p className="mt-1 text-xs">确认分镜后，生成进度和成片将在这里显示</p></div></div></aside>;
}
