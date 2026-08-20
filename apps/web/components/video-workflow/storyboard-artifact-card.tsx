"use client";

import type { StoryboardVersion } from "@chat-to-video/contracts";
import { ChevronDownIcon, Clock3Icon } from "lucide-react";
import { useId, useState } from "react";

import { collapseExpandedDetails } from "@/lib/collapsible-details";

export function StoryboardArtifactCard({ canReview, version }: {
  readonly canReview: boolean;
  readonly version: StoryboardVersion;
}) {
  const shotsId = useId();
  const [areShotsExpanded, setAreShotsExpanded] = useState(false);

  return (
    <article className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <button
        aria-controls={shotsId}
        aria-expanded={areShotsExpanded}
        aria-label={areShotsExpanded ? "折叠全部分镜区域" : "展开全部分镜区域"}
        className="group flex w-full cursor-pointer items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        onClick={() => setAreShotsExpanded((isExpanded) => !isExpanded)}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <p className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted-foreground">分镜方案</p>
          <h2 className="mt-1 font-sans text-lg font-semibold text-foreground">{version.storyboard.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{version.storyboard.creativeSummary}</p>
        </div>
        <ChevronDownIcon className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180" />
      </button>
      <ol className="mt-5 space-y-3" id={shotsId}>
        {version.storyboard.shots.map((shot) => (
          <li key={shot.order}>
            <details className="group rounded-lg border border-border bg-muted/40" open={areShotsExpanded}>
              <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
                <div className="flex items-center gap-2">
                  <span className="font-numeric text-[10px] font-semibold tabular-nums uppercase tracking-[0.08em] text-foreground">镜头 {shot.order}</span>
                  <span className="ml-auto inline-flex items-center gap-1 font-numeric text-[11px] tabular-nums text-muted-foreground"><Clock3Icon className="size-3" />{shot.durationSeconds}s</span>
                  <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
                </div>
              </summary>
              <div className="cursor-pointer border-t border-border px-4 pb-4 pt-3" onClick={collapseExpandedDetails}>
                <p className="text-sm leading-6 text-foreground">{shot.scene}：{shot.subjectAction}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">运镜：{shot.camera} · 视觉：{shot.visualStyle} · 声音：{shot.audio}</p>
              </div>
            </details>
          </li>
        ))}
      </ol>
      {canReview ? (
        <p className="mt-5 rounded-lg border border-warning/30 bg-warning-muted px-4 py-3 text-xs leading-5 text-warning-foreground">
          当前方案等待确认。如需调整时长或内容，请在左侧对话中直接说明；确认后可回复“确认生成”继续下一阶段。
        </p>
      ) : null}
    </article>
  );
}
