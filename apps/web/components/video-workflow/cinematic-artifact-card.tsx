"use client";

import type { CinematicArtifactVersion } from "@chat-to-video/contracts";
import { ChevronDownIcon, Clock3Icon } from "lucide-react";
import { useId, useState } from "react";

import {
  getCinematicStageLabel,
  getCinematicArtifactDuration,
  getCinematicArtifactSummary,
} from "./cinematic-artifact-presentation";
import { CinematicArtifactVisualization } from "./cinematic-artifact-visualization";

export function CinematicArtifactCard({
  canReview,
  version,
}: {
  readonly canReview: boolean;
  readonly version: CinematicArtifactVersion;
}) {
  const durationSeconds = getCinematicArtifactDuration(version);
  const sectionsId = useId();
  const [areSectionsExpanded, setAreSectionsExpanded] = useState(false);

  return (
    <article className="rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm">
      <button
        aria-controls={sectionsId}
        aria-expanded={areSectionsExpanded}
        aria-label={areSectionsExpanded ? "折叠全部规划区域" : "展开全部规划区域"}
        className="group flex w-full cursor-pointer items-start gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        onClick={() => setAreSectionsExpanded((isExpanded) => !isExpanded)}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-sans text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              电影化创作 · {getCinematicStageLabel(version.artifact.stage)}
            </p>
            <span className="ml-auto inline-flex items-center gap-1 font-numeric text-[10px] tabular-nums text-muted-foreground">
              <Clock3Icon className="size-3" />{durationSeconds ?? "\u2014"}s
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180" />
          </div>
          <p className="mt-2 text-sm leading-6 text-foreground">{getCinematicArtifactSummary(version)}</p>
        </div>
      </button>
      {version.revisionRequest ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="font-sans text-[10px] uppercase tracking-[0.12em] text-muted-foreground">本次修改要求</p>
          <p className="mt-1.5 text-xs leading-5 text-foreground">{version.revisionRequest}</p>
        </div>
      ) : null}
      <div className="mt-5" id={sectionsId}>
        <CinematicArtifactVisualization areSectionsExpanded={areSectionsExpanded} artifact={version.artifact} />
      </div>
      {canReview ? (
        <p className="mt-5 rounded-lg border border-warning/30 bg-warning-muted px-4 py-3 text-xs leading-5 text-warning-foreground">
          当前方案等待确认。如需调整时长或内容，请在左侧对话中直接说明；确认后可回复“确认生成”继续下一阶段。
        </p>
      ) : null}
    </article>
  );
}
