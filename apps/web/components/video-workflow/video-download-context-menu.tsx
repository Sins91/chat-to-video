"use client";

import { ContextMenu } from "@base-ui/react/context-menu";
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import { downloadGeneratedVideo } from "@/lib/video-download";

type DownloadableVideo = {
  id: string;
  playbackUrl: string;
  title: string;
};

export function VideoDownloadContextMenu({
  children,
  onOpenChange,
  triggerClassName,
  video,
}: {
  children: ReactNode;
  onOpenChange?: (isOpen: boolean) => void;
  triggerClassName?: string;
  video: DownloadableVideo;
}) {
  const [downloadState, setDownloadState] = useState<"error" | "idle" | "loading">("idle");
  const downloadVideo = useCallback(async () => {
    setDownloadState("loading");
    try {
      await downloadGeneratedVideo(video);
      setDownloadState("idle");
    } catch {
      setDownloadState("error");
    }
  }, [video.id, video.playbackUrl, video.title]);

  return <ContextMenu.Root onOpenChange={onOpenChange}>
    <ContextMenu.Trigger className={triggerClassName}>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Positioner className="isolate z-50 outline-none">
        <ContextMenu.Popup className="min-w-36 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
          <ContextMenu.Item className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50" disabled={downloadState === "loading"} onClick={() => void downloadVideo()}>
            {downloadState === "loading" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
            {downloadState === "loading" ? "正在下载…" : downloadState === "error" ? "下载失败，重试" : "下载视频…"}
          </ContextMenu.Item>
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  </ContextMenu.Root>;
}
