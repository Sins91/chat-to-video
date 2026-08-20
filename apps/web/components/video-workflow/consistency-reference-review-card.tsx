"use client";

import type { CinematicArtifactVersion, CinematicAssetBatch } from "@chat-to-video/contracts";

type ReferenceArtifact = Extract<CinematicArtifactVersion["artifact"], { stage: "consistency_reference" }>;

const kindLabel = { character: "人物", product: "产品", element: "元素", environment: "环境", style: "视觉风格" } as const;
const statusLabel = { queued: "等待生成", running: "生成中", succeeded: "已完成", failed: "生成失败", cancelled: "已取消" } as const;

export function ConsistencyReferenceReviewCard({ batch, artifact }: {
  readonly batch: CinematicAssetBatch;
  readonly artifact: ReferenceArtifact;
}) {
  const groups = artifact.data.groups;
  return (
    <article className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted-foreground">一致性参考图</p>
          <h2 className="mt-1 text-sm font-medium text-foreground">
            {batch.status === "awaiting_approval" ? "锚点图等待确认" : "锚点图生成结果"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">批准后，关联镜头的图片与视频任务会携带这些锚点；不会降级为重复提示词。</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{groups.length} 组</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {groups.map((group) => {
          const asset = batch.assets.find((candidate) => candidate.referenceGroupId === group.id);
          return (
            <section className="overflow-hidden rounded-lg border border-border bg-muted/30" key={group.id}>
              {asset?.reviewUrl ? (
                <img alt={`${group.label} 一致性参考图`} className="aspect-video w-full bg-black object-contain" src={asset.reviewUrl} />
              ) : (
                <div className="grid aspect-video place-items-center px-6 text-center text-xs text-muted-foreground">
                  <div className="w-full max-w-48">
                    <p>{asset ? statusLabel[asset.status] : "等待任务创建"}</p>
                    {asset?.status === "running" ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/70"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${asset.progress}%` }} /></div> : null}
                    {asset?.errorMessage ? <p className="mt-2 text-destructive">{asset.errorMessage}</p> : null}
                  </div>
                </div>
              )}
              <div className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-3 text-xs"><strong className="font-medium text-foreground">{group.label}</strong><span className="text-muted-foreground">{kindLabel[group.kind]}</span></div>
                <p className="text-[11px] leading-5 text-muted-foreground">关联镜头 {group.sceneOrders.join("、")} · 预计 ${group.estimatedCostUsd.toFixed(2)}</p>
                <p className="line-clamp-3 text-[11px] leading-5 text-muted-foreground" title={group.prompt}>{group.prompt}</p>
              </div>
            </section>
          );
        })}
      </div>
      {batch.status === "awaiting_approval" ? <p className="mt-4 text-xs text-muted-foreground">请在对话中选择全部批准，或带反馈重启“一致性参考图”阶段；未批准前不会创建普通素材批次。</p> : null}
    </article>
  );
}
