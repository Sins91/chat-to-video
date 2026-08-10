"use client";

import { CircleAlertIcon, FilmIcon, LoaderCircleIcon, MonitorPlayIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVideoWorkflow } from "./video-workflow-provider";

export function VideoPreview() {
  const { snapshot, refresh } = useVideoWorkflow();
  const job = snapshot?.videoJob;

  if (snapshot?.status === "succeeded" && job?.playbackUrl) {
    return <aside className="flex h-full min-w-0 flex-col bg-[#090a0b]" aria-labelledby="preview-title">
      <header className="flex h-14 shrink-0 items-center border-b border-white/10 px-5"><FilmIcon className="size-4 text-violet-300" /><h2 className="ml-2 text-sm font-medium text-zinc-200" id="preview-title">生成结果</h2><span className="ml-auto text-xs text-emerald-400">已完成</span></header>
      <div className="checkerboard grid min-h-0 flex-1 place-items-center p-6"><video className="max-h-full max-w-full rounded-xl bg-black shadow-2xl" controls onError={() => void refresh()} playsInline src={job.playbackUrl}>你的浏览器不支持视频播放。</video></div>
    </aside>;
  }

  if (snapshot?.status === "failed") {
    return <aside className="checkerboard grid h-full min-w-0 place-items-center p-6" aria-labelledby="preview-title"><div className="max-w-sm rounded-2xl border border-red-950 bg-[#111315]/95 p-6 text-center"><CircleAlertIcon className="mx-auto size-7 text-red-400" /><h2 className="mt-4 text-sm font-medium text-zinc-200" id="preview-title">视频生成失败</h2><p className="mt-2 text-xs leading-5 text-zinc-500">{snapshot.errorMessage ?? job?.errorMessage ?? "请检查任务日志后重试。"}</p><Button className="mt-4" onClick={() => void refresh()} size="sm" type="button" variant="outline"><RefreshCwIcon />刷新状态</Button></div></aside>;
  }

  if (snapshot?.status === "queued" || snapshot?.status === "running") {
    const progress = job?.progress ?? 0;
    return <aside className="checkerboard grid h-full min-w-0 place-items-center p-6" aria-labelledby="preview-title"><div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111315]/95 p-6"><div className="flex items-center"><span className="grid size-10 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><LoaderCircleIcon className="size-5 animate-spin" /></span><div className="ml-3"><h2 className="text-sm font-medium text-zinc-200" id="preview-title">{snapshot.status === "queued" ? "视频已进入队列" : "Seedance 正在生成"}</h2><p className="mt-1 text-xs text-zinc-500">10 秒 · 720p · 16:9 · 有声</p></div><span className="ml-auto text-sm font-semibold text-zinc-300">{progress}%</span></div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-blue-500 transition-[width]" style={{ width: `${progress}%` }} /></div><p className="mt-3 text-[11px] leading-5 text-zinc-500">生成通常需要数分钟，可以保留当前链接稍后继续查看。</p></div></aside>;
  }

  return <aside className="checkerboard grid h-full min-w-0 place-items-center" aria-labelledby="preview-title"><div className="flex items-center gap-4 text-zinc-500"><span className="grid size-12 place-items-center rounded-xl border border-white/10 bg-[#111315]"><MonitorPlayIcon className="size-5" /></span><div><h2 className="text-sm font-medium text-zinc-400" id="preview-title">视频工作区</h2><p className="mt-1 text-xs">确认分镜后，生成进度和成片将在这里显示</p></div></div></aside>;
}
