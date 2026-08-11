"use client";

import type { CinematicArtifactVersion, VideoModel } from "@chat-to-video/contracts";
import { ClapperboardIcon, Clock3Icon } from "lucide-react";

import { CinematicArtifactVisualization } from "./cinematic-artifact-visualization";
import { SceneDurationEditor } from "./scene-duration-editor";

const stageLabel = {
  research: "创作研究",
  proposal: "创意方案",
  script: "脚本",
  scene_plan: "场景规划",
  assets: "素材规划",
  edit: "剪辑方案",
} as const;

const artifactSummary = (version: CinematicArtifactVersion): string => {
  const artifact = version.artifact;
  if (artifact.stage === "research") return artifact.data.summary;
  if (artifact.stage === "proposal") {
    const selected = artifact.data.directions.find(
      (direction) => direction.id === artifact.data.recommendedDirectionId,
    );
    return selected?.logline ?? artifact.data.deliveryPromise;
  }
  if (artifact.stage === "script") return `${artifact.data.title} · ${artifact.data.beats.length} 个叙事节拍`;
  if (artifact.stage === "scene_plan") return `${artifact.data.scenes.length} 个场景 · ${artifact.data.aspectRatio}`;
  if (artifact.stage === "assets") {
    return `${artifact.data.assets.length} 项素材 · 预计 $${artifact.data.totalEstimatedCostUsd.toFixed(2)}`;
  }
  return `${artifact.data.timeline.length} 个剪辑段落 · FFmpeg 合成`;
};

const artifactDuration = (version: CinematicArtifactVersion): number | null => {
  const artifact = version.artifact;
  if (artifact.stage === "research" || artifact.stage === "assets") return null;
  return artifact.data.durationSeconds;
};

export function CinematicArtifactCard({
  canReview,
  isSubmitting,
  onSceneDurationsSubmit,
  version,
  videoModel,
}: {
  readonly canReview: boolean;
  readonly isSubmitting: boolean;
  readonly onSceneDurationsSubmit: (
    scenes: ReadonlyArray<{ order: number; durationSeconds: number }>,
  ) => void;
  readonly version: CinematicArtifactVersion;
  readonly videoModel: VideoModel;
}) {
  const durationSeconds = artifactDuration(version);
  return (
    <article className="rounded-2xl border border-amber-400/15 bg-[#121418] p-5 text-zinc-200">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
          <ClapperboardIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-amber-300/80">
              电影化创作 · {stageLabel[version.artifact.stage]} V{version.version}
            </p>
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500">
              <Clock3Icon className="size-3" />{durationSeconds ?? "\u2014"}s
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{artifactSummary(version)}</p>
        </div>
      </div>
      {version.revisionRequest ? (
        <div className="mt-4 rounded-xl border border-sky-400/15 bg-sky-400/[0.05] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.12em] text-sky-300/70">本次修改要求</p>
          <p className="mt-1.5 text-xs leading-5 text-zinc-400">{version.revisionRequest}</p>
        </div>
      ) : null}
      <div className="mt-5">
        <CinematicArtifactVisualization artifact={version.artifact} />
      </div>
      {canReview && version.artifact.stage === "scene_plan" ? (
        <SceneDurationEditor
          disabled={isSubmitting}
          onSubmit={onSceneDurationsSubmit}
          scenePlan={version.artifact.data}
          videoModel={videoModel}
        />
      ) : null}
      <details className="mt-4 rounded-xl border border-white/8 bg-black/15 px-4 py-3">
        <summary className="cursor-pointer text-xs text-zinc-400">查看原始 JSON</summary>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-6 text-zinc-400">
          {JSON.stringify(version.artifact.data, null, 2)}
        </pre>
      </details>
      {canReview ? (
        <p className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs leading-5 text-amber-100">
          当前方案等待确认。你可以直接回复修改意见，或回复“确认生成”继续下一阶段。
        </p>
      ) : null}
    </article>
  );
}
