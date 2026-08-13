"use client";

import type { CinematicAssetBatch } from "@chat-to-video/contracts";

export function CinematicAssetReviewCard({
  batch,
  canReview,
}: {
  readonly batch: CinematicAssetBatch;
  readonly canReview: boolean;
}) {
  return (
    <article className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-numeric text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            素材执行结果 · V{batch.planVersion}
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
              <div className="grid aspect-video place-items-center text-xs text-muted-foreground">
                {asset.status === "failed" ? asset.errorMessage ?? "生成失败" : "素材生成中"}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-muted-foreground">
              <span>{asset.kind === "music" ? "背景音乐" : `镜头 ${asset.sceneOrder ?? "—"}`}</span>
              <span>{asset.status}</span>
            </div>
          </section>
        ))}
      </div>
      {canReview ? (
        <p className="mt-4 rounded-lg border border-warning/30 bg-warning-muted px-4 py-3 text-xs leading-5 text-warning-foreground">
          请检查画面、运动、标题文字和音乐。确认后回复“确认”；如需重做，请明确要求从素材阶段重新生成。
        </p>
      ) : null}
    </article>
  );
}
