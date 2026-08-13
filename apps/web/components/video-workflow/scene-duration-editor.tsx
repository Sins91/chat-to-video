"use client";

import {
  VIDEO_MODEL_DURATION_OPTIONS,
  roundVideoModelDurationSeconds,
  type CinematicArtifact,
  type VideoModel,
} from "@chat-to-video/contracts";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type ScenePlan = Extract<CinematicArtifact, { stage: "scene_plan" }>["data"];

export function SceneDurationEditor({
  disabled,
  onSubmit,
  scenePlan,
  videoModel,
}: {
  readonly disabled: boolean;
  readonly onSubmit: (
    scenes: ReadonlyArray<{ order: number; durationSeconds: number }>,
  ) => void;
  readonly scenePlan: ScenePlan;
  readonly videoModel: VideoModel;
}) {
  const [durations, setDurations] = useState(
    () => scenePlan.scenes.map((scene) => scene.durationSeconds),
  );

  useEffect(() => {
    setDurations(scenePlan.scenes.map((scene) => scene.durationSeconds));
  }, [scenePlan]);

  const maxDurationSeconds =
    VIDEO_MODEL_DURATION_OPTIONS[videoModel].at(-1) ?? 15;
  const totalDurationSeconds = durations.reduce(
    (total, duration) => total + duration,
    0,
  );
  const roundedDurations = useMemo(
    () => durations.map((duration) =>
      Number.isInteger(duration) && duration >= 1 && duration <= maxDurationSeconds
        ? roundVideoModelDurationSeconds(videoModel, duration)
        : null),
    [durations, maxDurationSeconds, videoModel],
  );
  const isValid =
    totalDurationSeconds === scenePlan.durationSeconds &&
    roundedDurations.every((duration) => duration !== null);

  return (
    <section className="mt-5 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h3 className="text-sm font-medium text-amber-100">逐镜头设置成片时长</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-400">
            模型不支持的秒数会向上圆整到可生成档位，确认后仍按你设置的成片时长裁切。
          </p>
        </div>
        <span className={
          "ml-auto rounded-full px-2.5 py-1 font-numeric text-xs tabular-nums " +
          (totalDurationSeconds === scenePlan.durationSeconds
            ? "bg-emerald-400/10 text-emerald-300"
            : "bg-red-400/10 text-red-300")
        }>
          合计 {totalDurationSeconds} / {scenePlan.durationSeconds} 秒
        </span>
      </div>
      <div className="mt-4 grid gap-2">
        {scenePlan.scenes.map((scene, index) => (
          <label
            className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-3 rounded-md border border-white/8 bg-black/15 px-3 py-2"
            key={scene.order}
          >
            <span className="truncate font-numeric text-xs tabular-nums text-zinc-300">
              镜头 {scene.order} · {scene.narrativeBeat}
            </span>
            <span className="flex items-center gap-1">
              <input
                aria-label={"镜头 " + scene.order + " 成片时长"}
                className="w-16 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-right font-numeric text-sm tabular-nums text-zinc-100 outline-none focus:border-amber-300/50"
                disabled={disabled}
                max={maxDurationSeconds}
                min={1}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDurations((current) =>
                    current.map((duration, durationIndex) =>
                      durationIndex === index ? value : duration,
                    ),
                  );
                }}
                step={1}
                type="number"
                value={durations[index] ?? ""}
              />
              <span className="text-xs text-zinc-500">秒</span>
            </span>
            <span className="min-w-24 text-right font-numeric text-[11px] tabular-nums text-zinc-500">
              模型档位 {roundedDurations[index] ?? "—"} 秒
            </span>
          </label>
        ))}
      </div>
      {!isValid ? (
        <p className="mt-3 text-xs text-red-300">
          每个镜头需为 1–{maxDurationSeconds} 秒的整数，且总和必须保持 {scenePlan.durationSeconds} 秒。
        </p>
      ) : null}
      <Button
        className="mt-4"
        disabled={disabled || !isValid}
        onClick={() => onSubmit(scenePlan.scenes.map((scene, index) => ({
          order: scene.order,
          durationSeconds: durations[index] ?? scene.durationSeconds,
        })))}
        size="sm"
        type="button"
      >
        应用时长并重新确认
      </Button>
    </section>
  );
}
