"use client";

import { LoaderCircleIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

import { Button } from "@/components/ui/button";
import { useVideoWorkflow } from "@/components/video-workflow/video-workflow-provider";
import { VideoDownloadContextMenu } from "@/components/video-workflow/video-download-context-menu";
import { getCachedGeneratedVideos, listGeneratedVideos, type GeneratedVideoItem } from "@/lib/generated-video-client";
import { cn } from "@/lib/utils";

const FILM_PERFORATIONS = Array.from({ length: 10 }, (_, index) => index);
const HORIZONTAL_DRAG_THRESHOLD_PX = 4;
const WHEEL_SCROLL_SPEED_FACTOR = 0.6;
const WHEEL_SCROLL_EASING_FACTOR = 0.18;
const WHEEL_SCROLL_SETTLE_DISTANCE_PX = 0.5;

type HorizontalDragState = {
  readonly pointerId: number;
  readonly startScrollLeft: number;
  readonly startX: number;
  hasDragged: boolean;
};

const FilmPerforations = ({ position }: { readonly position: "bottom" | "top" }) => <span
  aria-hidden="true"
  className={cn("absolute inset-x-1 flex justify-between", position === "top" ? "top-1" : "bottom-1")}
>
  {FILM_PERFORATIONS.map((index) => <span className="h-1 w-2 rounded-[1px] bg-stone-500/70 shadow-[inset_0_1px_1px_rgb(255_255_255/0.12),0_0_3px_rgb(245_158_11/0.08)]" key={index} />)}
</span>;

const GeneratedVideoCard = memo(function GeneratedVideoCard({
  isSwitching,
  onSelect,
  video,
}: {
  readonly isSwitching: boolean;
  readonly onSelect: (video: GeneratedVideoItem) => void;
  readonly video: GeneratedVideoItem;
}) {
  return <VideoDownloadContextMenu triggerClassName="w-40 shrink-0" video={video}>
      <button
        aria-label={`打开视频：${video.title}`}
        aria-busy={isSwitching}
        className="group w-full cursor-pointer text-left disabled:cursor-pointer"
        disabled={isSwitching}
        onClick={() => onSelect(video)}
        title={video.title}
        type="button"
      >
        <span className="relative block bg-gradient-to-b from-stone-800 via-[#090909] to-stone-950 px-1.5 py-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.04),inset_0_-1px_0_rgb(255_255_255/0.04)]">
          <FilmPerforations position="top" />
          <span className="relative block aspect-video overflow-hidden bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
            <video aria-hidden="true" className="size-full object-cover contrast-[1.08] saturate-[0.82] brightness-[0.88] sepia-[0.08] transition-[filter,transform] duration-500 group-hover:scale-[1.02] group-hover:brightness-100" muted playsInline preload="metadata" src={video.playbackUrl} />
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-black/45" />
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 bg-black/45" />
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 shadow-[inset_0_0_24px_8px_rgb(0_0_0/0.52)]" />
            <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/15">
              {isSwitching ? <LoaderCircleIcon className="size-5 animate-spin text-amber-100" /> : <span className="grid size-8 place-items-center rounded-full bg-black/55 text-amber-50 opacity-0 shadow-lg backdrop-blur-[2px] transition-opacity group-hover:opacity-100"><PlayIcon className="ml-0.5 size-3.5 fill-current" /></span>}
            </span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-end bg-gradient-to-t from-black via-black/70 to-transparent px-2 pb-2 pt-8 text-[9px] leading-none text-stone-100">
              <span className="shrink-0 font-numeric text-[8px] tabular-nums tracking-[0.04em] text-amber-50/75">{video.durationSeconds === null ? "--:--" : `00:${String(video.durationSeconds).padStart(2, "0")}`} · {video.resolution}</span>
            </span>
          </span>
          <FilmPerforations position="bottom" />
        </span>
      </button>
  </VideoDownloadContextMenu>;
});

export function GeneratedVideoShelf() {
  const { openGeneratedVideo, snapshot } = useVideoWorkflow();
  const [videos, setVideos] = useState<readonly GeneratedVideoItem[]>(getCachedGeneratedVideos);
  const [isLoading, setIsLoading] = useState(() => getCachedGeneratedVideos().length === 0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [switchingConversationId, setSwitchingConversationId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const loadSequenceRef = useRef(0);
  const dragStateRef = useRef<HorizontalDragState | null>(null);
  const shouldSuppressClickRef = useRef(false);
  const wheelAnimationFrameRef = useRef<number | null>(null);
  const wheelTargetScrollLeftRef = useRef<number | null>(null);

  const stopWheelScrollAnimation = useCallback(() => {
    if (wheelAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(wheelAnimationFrameRef.current);
    }
    wheelAnimationFrameRef.current = null;
    wheelTargetScrollLeftRef.current = null;
  }, []);

  const startHorizontalDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    stopWheelScrollAnimation();
    dragStateRef.current = {
      hasDragged: false,
      pointerId: event.pointerId,
      startScrollLeft: event.currentTarget.scrollLeft,
      startX: event.clientX,
    };
  }, [stopWheelScrollAnimation]);

  const moveHorizontalDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      dragStateRef.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    const distanceX = event.clientX - dragState.startX;
    if (!dragState.hasDragged && Math.abs(distanceX) < HORIZONTAL_DRAG_THRESHOLD_PX) return;
    if (!dragState.hasDragged) {
      dragState.hasDragged = true;
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.currentTarget.scrollLeft = dragState.startScrollLeft - distanceX;
    event.preventDefault();
  }, []);

  const finishHorizontalDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    const shouldSuppressClick = event.type === "pointerup" && dragState.hasDragged;
    shouldSuppressClickRef.current = shouldSuppressClick;
    if (shouldSuppressClick) {
      window.setTimeout(() => {
        shouldSuppressClickRef.current = false;
      }, 0);
    }
    dragStateRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const suppressClickAfterDrag = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!shouldSuppressClickRef.current) return;
    shouldSuppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const scrollHorizontallyWithWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    const scrollContainer = event.currentTarget;
    const maximumScrollLeft = scrollContainer.scrollWidth - scrollContainer.clientWidth;
    const currentTargetScrollLeft = wheelTargetScrollLeftRef.current ?? scrollContainer.scrollLeft;
    const nextTargetScrollLeft = Math.min(maximumScrollLeft, Math.max(0, currentTargetScrollLeft + delta * WHEEL_SCROLL_SPEED_FACTOR));
    if (nextTargetScrollLeft === currentTargetScrollLeft && scrollContainer.scrollLeft === nextTargetScrollLeft) return;
    wheelTargetScrollLeftRef.current = nextTargetScrollLeft;

    if (wheelAnimationFrameRef.current === null) {
      const animateWheelScroll = () => {
        const targetScrollLeft = wheelTargetScrollLeftRef.current;
        if (targetScrollLeft === null) {
          wheelAnimationFrameRef.current = null;
          return;
        }
        const distance = targetScrollLeft - scrollContainer.scrollLeft;
        if (Math.abs(distance) <= WHEEL_SCROLL_SETTLE_DISTANCE_PX) {
          scrollContainer.scrollLeft = targetScrollLeft;
          wheelAnimationFrameRef.current = null;
          wheelTargetScrollLeftRef.current = null;
          return;
        }
        scrollContainer.scrollLeft += distance * WHEEL_SCROLL_EASING_FACTOR;
        wheelAnimationFrameRef.current = window.requestAnimationFrame(animateWheelScroll);
      };
      wheelAnimationFrameRef.current = window.requestAnimationFrame(animateWheelScroll);
    }
    event.preventDefault();
  }, []);

  useEffect(() => stopWheelScrollAnimation, [stopWheelScrollAnimation]);

  const load = useCallback(async () => {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    if (getCachedGeneratedVideos().length === 0) setIsLoading(true);
    try {
      const nextVideos = await listGeneratedVideos();
      if (loadSequenceRef.current !== loadSequence) return;
      setVideos(nextVideos);
      setErrorMessage(null);
    } catch (error: unknown) {
      if (loadSequenceRef.current !== loadSequence) return;
      setErrorMessage(error instanceof Error ? error.message : "已生成视频加载失败。");
    } finally {
      if (loadSequenceRef.current === loadSequence) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completedJobId = snapshot?.status === "succeeded" && snapshot.videoJob?.status === "succeeded"
    ? snapshot.videoJob.jobId
    : null;
  useEffect(() => {
    if (completedJobId) void load();
  }, [completedJobId, load]);

  const selectVideo = useCallback(async (video: GeneratedVideoItem) => {
    setSwitchingConversationId(video.conversationId);
    await openGeneratedVideo(video);
    setSwitchingConversationId(null);
  }, [openGeneratedVideo]);

  return <section
    aria-label="已生成视频胶片"
    className="relative z-50 h-[130px] shrink-0 overflow-hidden border-t border-stone-700/40 bg-[radial-gradient(circle_at_50%_0%,rgb(68_56_45/0.22),transparent_48%),linear-gradient(180deg,#151310_0%,#070707_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.025),0_-10px_30px_rgb(0_0_0/0.32)]"
  >
    <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1 z-10 h-0.5 w-10 -translate-x-1/2 rounded-full bg-stone-400/45 shadow-[0_1px_4px_rgb(0_0_0/0.8)]" />
    <div
      className={cn(
        "overflow-x-auto px-3 py-2 [scrollbar-color:rgb(87_83_78/0.65)_transparent]",
        isDragging ? "cursor-grabbing select-none" : "cursor-grab",
      )}
      onClickCapture={suppressClickAfterDrag}
      onLostPointerCapture={finishHorizontalDrag}
      onPointerCancel={finishHorizontalDrag}
      onPointerDown={startHorizontalDrag}
      onPointerMove={moveHorizontalDrag}
      onPointerUp={finishHorizontalDrag}
      onWheel={scrollHorizontallyWithWheel}
    >
      <div className="flex min-w-max gap-1.5">
        {videos.map((video) => <GeneratedVideoCard
          isSwitching={video.conversationId === switchingConversationId}
          key={video.id}
          onSelect={(item) => void selectVideo(item)}
          video={video}
        />)}
        {errorMessage ? <Button aria-label="重新加载已生成视频" className="h-[114px] w-40 shrink-0 text-zinc-500" onClick={() => void load()} title={errorMessage} type="button" variant="ghost"><RefreshCwIcon />重新加载</Button> : null}
        {isLoading && videos.length === 0 ? Array.from({ length: 3 }, (_, index) => <div aria-hidden="true" className="h-[114px] w-40 shrink-0 animate-pulse bg-zinc-900" key={index} />) : null}
        {!isLoading && videos.length === 0 ? <p className="py-5 text-xs text-zinc-500">生成完成的视频会从左到右排列在这里。</p> : null}
      </div>
    </div>
  </section>;
}
