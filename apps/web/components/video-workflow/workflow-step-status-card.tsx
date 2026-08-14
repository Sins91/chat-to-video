"use client";

import type { WorkflowStepProgress } from "@chat-to-video/contracts";
import {
  CheckIcon,
  CircleIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { memo } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { VideoOutputEstimate } from "@/lib/video-output-estimate";

const DEFAULT_WORKFLOW_STEP_LABELS = [
  "理解需求",
  "创作研究",
  "创意方案",
  "脚本生成",
  "分镜写作",
  "素材规划",
  "剪辑方案",
  "视频生成",
] as const;

const stateLabel = {
  running: "进行中",
  awaiting_input: "等待确认",
  completed: "已完成",
  failed: "失败",
} as const;

const stateTone = {
  running: "border-border bg-muted text-muted-foreground",
  awaiting_input: "border-warning/30 bg-warning-muted text-warning-foreground",
  completed: "border-border bg-muted text-muted-foreground",
  failed: "border-border bg-muted text-muted-foreground",
} as const;

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
  videoOutputEstimate,
}: {
  readonly compact?: boolean;
  readonly progress: WorkflowStepProgress;
  readonly videoOutputEstimate: VideoOutputEstimate;
}) {
  const currentStepLabel = progress.stepTotal === DEFAULT_WORKFLOW_STEP_LABELS.length
    ? DEFAULT_WORKFLOW_STEP_LABELS[progress.stepIndex - 1] ?? progress.stepLabel
    : progress.stepLabel;
  const getStepLabel = (stepNumber: number): string => {
    if (stepNumber === progress.stepIndex) return currentStepLabel;
    if (progress.stepTotal !== DEFAULT_WORKFLOW_STEP_LABELS.length) {
      return `步骤 ${stepNumber}`;
    }
    return DEFAULT_WORKFLOW_STEP_LABELS[stepNumber - 1] ?? `步骤 ${stepNumber}`;
  };

  return (
    <section
      aria-label="Agent 流程进度"
      aria-live="polite"
      className={
        "rounded-xl border border-border bg-card text-card-foreground shadow-sm " +
        (compact ? "px-4 py-3" : "p-5")
      }
      role="status"
    >
      <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-sans text-sm font-medium text-foreground">
              {currentStepLabel}
            </p>
            <span className={
              "rounded-full border px-2 py-0.5 text-[10px] " +
              stateTone[progress.stepState]
            }>
              {stateLabel[progress.stepState]}
            </span>
            <div className="ml-auto flex items-center gap-2 font-numeric text-[10px] tabular-nums text-muted-foreground">
              <span>时长 {videoOutputEstimate.duration} · {videoOutputEstimate.resolution}</span>
              {!compact ? <span>{progress.stepIndex} / {progress.stepTotal}</span> : null}
            </div>
          </div>
          {progress.stepState === "running" ? (
            <div
              aria-label="Agent 思考状态"
              className="mt-2 flex min-h-[62px] items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              </span>
              <div className="min-w-0">
                <p className="font-sans text-xs font-medium text-foreground">Agent 正在思考</p>
                <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
                  正在处理当前步骤，期间可切换至其他会话再回来。
                </p>
              </div>
            </div>
          ) : progress.toolActivity ? (
            <div
              aria-label={"\u5de5\u5177\u8fd0\u884c\u4fe1\u606f"}
              className="mt-2 flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
            >
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <ToolActivityIcon state={progress.toolActivity.state} />
              </span>
              <div className="min-w-0">
                <p className="truncate font-sans text-xs font-medium text-foreground">
                  {progress.toolActivity.toolLabel}
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {progress.toolActivity.summary}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{progress.message}</p>
          )}
      </div>

      {!compact ? (
        <TooltipProvider delay={250}>
          <div
            className="mt-4 grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(" + progress.stepTotal + ", minmax(0, 1fr))" }}
          >
            <span
              aria-label={
                "流程步骤 " + progress.stepIndex + " / " + progress.stepTotal
              }
              aria-valuemax={progress.stepTotal}
              aria-valuemin={1}
              aria-valuenow={progress.stepIndex}
              className="sr-only"
              role="progressbar"
            />
            {Array.from({ length: progress.stepTotal }, (_, index) => {
              const stepNumber = index + 1;
              const stepLabel = getStepLabel(stepNumber);
              const isBefore = stepNumber < progress.stepIndex;
              const isCurrent = stepNumber === progress.stepIndex;
              const tone = isBefore ||
                  (isCurrent && progress.stepState === "completed")
                ? "bg-success"
                : isCurrent && progress.stepState === "failed"
                  ? "bg-destructive"
                  : isCurrent && progress.stepState === "awaiting_input"
                    ? "bg-warning"
                    : isCurrent
                      ? "animate-pulse bg-primary"
                      : "bg-muted";
              return (
                <Tooltip key={stepNumber}>
                  <TooltipTrigger
                    aria-label={`步骤 ${stepNumber}：${stepLabel}`}
                    render={
                      <span
                        className={"relative h-1.5 rounded-full transition-colors before:absolute before:-inset-x-0.5 before:-inset-y-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + tone}
                        tabIndex={0}
                      />
                    }
                  />
                  <TooltipContent>{stepLabel}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      ) : null}

      {!compact ? (
        <div className="mt-3 flex items-center gap-2 font-numeric text-[10px] tabular-nums text-muted-foreground">
          <CircleIcon className="size-2.5 fill-current" />
          <span>当前步骤 {progress.stepIndex} / {progress.stepTotal}</span>
        </div>
      ) : null}
    </section>
  );
});
