"use client";

import type { WorkflowStepProgress } from "@chat-to-video/contracts";
import {
  CheckIcon,
  CircleIcon,
  CirclePauseIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { memo } from "react";

const stateLabel = {
  running: "进行中",
  awaiting_input: "等待确认",
  completed: "已完成",
  failed: "失败",
} as const;

const stateTone = {
  running: "border-violet-400/20 bg-violet-400/10 text-violet-200",
  awaiting_input: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  completed: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  failed: "border-red-400/20 bg-red-400/10 text-red-200",
} as const;

const StateIcon = ({ state }: { readonly state: WorkflowStepProgress["stepState"] }) => {
  if (state === "running") return <LoaderCircleIcon className="size-4 animate-spin" />;
  if (state === "awaiting_input") return <CirclePauseIcon className="size-4" />;
  if (state === "completed") return <CheckIcon className="size-4" />;
  return <XIcon className="size-4" />;
};

const ToolActivityIcon = ({
  state,
}: {
  readonly state: NonNullable<WorkflowStepProgress["toolActivity"]>["state"];
}) => {
  if (state === "running") return <LoaderCircleIcon className="size-3.5 animate-spin" />;
  if (state === "completed") return <CheckIcon className="size-3.5" />;
  return <TriangleAlertIcon className="size-3.5" />;
};

export const WorkflowStepStatusCard = memo(function WorkflowStepStatusCard({
  compact = false,
  progress,
}: {
  readonly compact?: boolean;
  readonly progress: WorkflowStepProgress;
}) {
  const completedSteps = Math.min(
    progress.stepTotal,
    progress.stepIndex - 1 + (progress.stepState === "completed" ? 1 : 0),
  );

  return (
    <section
      aria-label="Agent 流程进度"
      aria-live="polite"
      className={
        "rounded-2xl border border-white/10 bg-[#121418] text-zinc-200 " +
        (compact ? "px-4 py-3" : "p-5")
      }
      role="status"
    >
      <div className="flex items-center gap-3">
        <span className={
          "grid size-9 shrink-0 place-items-center rounded-xl border " +
          stateTone[progress.stepState]
        }>
          <StateIcon state={progress.stepState} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-zinc-100">
              {progress.stepLabel}
            </p>
            <span className={
              "rounded-full border px-2 py-0.5 text-[10px] " +
              stateTone[progress.stepState]
            }>
              {stateLabel[progress.stepState]}
            </span>
            {!compact ? (
              <span className="ml-auto text-[11px] text-zinc-500">
                {completedSteps} / {progress.stepTotal}
              </span>
            ) : null}
          </div>
          {progress.toolActivity ? (
            <div
              aria-label={"\u5de5\u5177\u8fd0\u884c\u4fe1\u606f"}
              className="mt-2 flex items-start gap-2.5 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5"
            >
              <span className={
                "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md " +
                (progress.toolActivity.state === "running"
                  ? "bg-violet-400/10 text-violet-300"
                  : progress.toolActivity.state === "completed"
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-amber-400/10 text-amber-300")
              }>
                <ToolActivityIcon state={progress.toolActivity.state} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-zinc-200">
                  {progress.toolActivity.toolLabel}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-zinc-400">
                  {progress.toolActivity.summary}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs leading-5 text-zinc-400">{progress.message}</p>
          )}
        </div>
      </div>

      {!compact ? (
        <div
          aria-label={
            "流程步骤 " + progress.stepIndex + " / " + progress.stepTotal
          }
          aria-valuemax={progress.stepTotal}
          aria-valuemin={1}
          aria-valuenow={progress.stepIndex}
          className="mt-4 grid gap-1.5"
          role="progressbar"
          style={{ gridTemplateColumns: "repeat(" + progress.stepTotal + ", minmax(0, 1fr))" }}
        >
          {Array.from({ length: progress.stepTotal }, (_, index) => {
            const stepNumber = index + 1;
            const isBefore = stepNumber < progress.stepIndex;
            const isCurrent = stepNumber === progress.stepIndex;
            const tone = isBefore ||
                (isCurrent && progress.stepState === "completed")
              ? "bg-emerald-400"
              : isCurrent && progress.stepState === "failed"
                ? "bg-red-400"
                : isCurrent && progress.stepState === "awaiting_input"
                  ? "bg-amber-300"
                  : isCurrent
                    ? "animate-pulse bg-violet-400"
                    : "bg-white/10";
            return (
              <span
                aria-hidden="true"
                className={"h-1.5 rounded-full transition-colors " + tone}
                key={stepNumber}
              />
            );
          })}
        </div>
      ) : null}

      {!compact ? (
        <div className="mt-3 flex items-center gap-2 text-[10px] text-zinc-600">
          <CircleIcon className="size-2.5 fill-current" />
          <span>当前步骤 {progress.stepIndex} / {progress.stepTotal}</span>
        </div>
      ) : null}
    </section>
  );
});