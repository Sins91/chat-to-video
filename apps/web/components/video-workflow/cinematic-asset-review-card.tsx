"use client";

import type { CinematicAssetBatch } from "@chat-to-video/contracts";

const assetStatusText = (status: CinematicAssetBatch["assets"][number]["status"]): string => ({
  queued: "等待中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
})[status];

export function CinematicAssetReviewCard({
  batch,
}: {
  readonly batch: CinematicAssetBatch;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            素材执行结果
          </p>
          <h2 className="mt-1 text-sm font-medium text-foreground">
            {batch.status === "awaiting_approval" ? "实际素材等待确认" : "实际素材"}
          </h2>
        </div>
        <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] text-muted-foreground">
          {batch.assets.length} 项
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {batch.assets.map((asset) => (
          <section className="overflow-hidden rounded-lg border border-border bg-muted/30" key={asset.assetId}>
            {asset.reviewUrl && asset.kind === "video" ? (
              <video className="aspect-video w-full bg-black object-contain" controls preload="metadata" src={asset.reviewUrl} />
            ) : asset.reviewUrl && (asset.kind === "image" || asset.kind === "title_card") ? (
              <img alt={`镜头 ${asset.sceneOrder ?? "—"} 素材`} className="aspect-video w-full bg-black object-contain" src={asset.reviewUrl} />
            ) : asset.reviewUrl && asset.kind === "music" ? (
              <div className="p-4"><audio className="w-full" controls preload="metadata" src={asset.reviewUrl} /></div>
            ) : (
              <div className="grid aspect-video place-items-center px-6 text-xs text-muted-foreground">
                <div className="w-full max-w-48 text-center">
                  <p>{asset.status === "failed" ? asset.errorMessage ?? "生成失败" : assetStatusText(asset.status)}</p>
                  {asset.status === "running" ? <>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/70">
                      <div
                        className="h-full rounded-full bg-primary transition-[width]"
                        style={{ width: `${asset.progress}%` }}
                      />
                    </div>
                    <p className="mt-2 font-numeric tabular-nums">{asset.progress}%</p>
                  </> : null}
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-muted-foreground">
              <span>{asset.kind === "music" ? "全片背景音乐" : asset.kind === "video" ? `镜头 ${asset.sceneOrder ?? "—"} · 可试听场景声音` : `镜头 ${asset.sceneOrder ?? "—"} · 无声素材`}</span>
              <span>{asset.status === "running" ? `${assetStatusText(asset.status)} ${asset.progress}%` : assetStatusText(asset.status)}</span>
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
