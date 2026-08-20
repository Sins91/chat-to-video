"use client";

import { ImageIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type AttachmentData = {
  id: string;
  filename: string;
  mediaType: string;
  url: string | null;
  status?: "uploading" | "validating" | "ready" | "rejected";
};

type AttachmentsProps = HTMLAttributes<HTMLDivElement> & { variant?: "grid" | "inline" | "list" };
export const Attachments = ({ className, variant = "grid", ...props }: AttachmentsProps) => (
  <div
    className={cn(
      variant === "grid" ? "grid grid-cols-2 gap-2 sm:grid-cols-4" : "flex flex-wrap gap-2",
      className,
    )}
    {...props}
  />
);

type AttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: AttachmentData;
  onRemove?: () => void;
};

export const Attachment = ({ children, className, data, onRemove, ...props }: AttachmentProps) => (
  <div
    className={cn("group/attachment relative overflow-hidden rounded-lg border border-border bg-muted/30", className)}
    data-filename={data.filename}
    data-media-type={data.mediaType}
    data-remove={onRemove ? "available" : "unavailable"}
    {...props}
  >
    {children}
  </div>
);

export const AttachmentPreview = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex aspect-square min-h-14 items-center justify-center overflow-hidden bg-muted", className)} {...props} />
);

export const AttachmentImage = ({ alt, className, ...props }: ComponentProps<"img">) => (
  // User-selected and short-lived signed object URLs are not compatible with Next image optimization.
  // oxlint-disable-next-line nextjs/no-img-element
  <img alt={alt} className={cn("size-full object-cover", className)} {...props} />
);

export const AttachmentImageLightbox = ({ alt, children, src }: {
  readonly alt: string;
  readonly children: ReactNode;
  readonly src: string;
}) => (
  <Dialog>
    <DialogTrigger
      render={<button
        aria-label={`放大查看图片：${alt}`}
        className="block w-full cursor-zoom-in rounded-t-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        type="button"
      />}
    >
      {children}
    </DialogTrigger>
    <DialogContent className="w-auto max-w-[calc(100vw-2rem)] gap-0 bg-background/95 p-2 shadow-2xl sm:max-w-[calc(100vw-4rem)]">
      <DialogHeader className="sr-only">
        <DialogTitle>{alt}</DialogTitle>
        <DialogDescription>参考图片放大预览，按 Esc 或使用关闭按钮退出。</DialogDescription>
      </DialogHeader>
      <AttachmentImage
        alt={alt}
        className="h-auto max-h-[calc(100dvh-4rem)] w-auto max-w-[calc(100vw-3rem)] rounded-lg object-contain sm:max-w-[calc(100vw-5rem)]"
        src={src}
      />
    </DialogContent>
  </Dialog>
);

export const AttachmentFallback = () => <ImageIcon className="size-5 text-muted-foreground" />;

export const AttachmentInfo = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("max-w-32 truncate px-2 py-1 text-[11px] text-muted-foreground", className)} {...props} />
);

export const AttachmentStatus = ({ status }: { status?: AttachmentData["status"] }) => status && status !== "ready" ? (
  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-background/85 px-1 py-0.5 text-[10px] text-muted-foreground">
    {status !== "rejected" ? <LoaderCircleIcon className="size-3 animate-spin" /> : null}
    {status === "uploading" ? "上传中" : status === "validating" ? "校验中" : "上传失败"}
  </span>
) : null;

export const AttachmentRemove = ({ className, ...props }: ComponentProps<typeof Button>) => (
  <Button
    aria-label="移除参考图"
    className={cn("absolute right-1 top-1 size-6 rounded-full bg-background/85 opacity-100 shadow-sm sm:opacity-0 sm:group-hover/attachment:opacity-100", className)}
    size="icon"
    type="button"
    variant="ghost"
    {...props}
  >
    <XIcon className="size-3.5" />
  </Button>
);
