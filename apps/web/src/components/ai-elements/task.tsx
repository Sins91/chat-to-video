"use client";

import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  PauseCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type TaskStatus =
  | "awaiting_input"
  | "completed"
  | "failed"
  | "pending"
  | "running";

export type TaskActivity = {
  label: string;
  state: "active" | "stalled";
};

const TASK_STATUS_ICON = {
  awaiting_input: PauseCircleIcon,
  completed: CheckCircle2Icon,
  failed: CircleAlertIcon,
  pending: CircleDashedIcon,
  running: LoaderCircleIcon,
} as const;

const TASK_STATUS_CLASS = {
  awaiting_input: "text-warning-foreground",
  completed: "text-success",
  failed: "text-destructive",
  pending: "text-muted-foreground",
  running: "animate-spin text-primary motion-reduce:animate-none",
} as const;

export const Task = ({
  className,
  defaultOpen = true,
  ...props
}: ComponentProps<typeof Collapsible>) => (
  <Collapsible
    className={cn("group/task w-full", className)}
    defaultOpen={defaultOpen}
    {...props}
  />
);

export type TaskTriggerProps = Omit<
  ComponentProps<typeof CollapsibleTrigger>,
  "children" | "title"
> & {
  activity?: TaskActivity;
  progress?: { current: number; total: number };
  status?: TaskStatus;
  title: ReactNode;
};

export const TaskTrigger = ({
  activity,
  className,
  progress,
  status = "pending",
  title,
  ...props
}: TaskTriggerProps) => {
  const StatusIcon = TASK_STATUS_ICON[status];
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-lg py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    >
      <StatusIcon
        aria-hidden="true"
        className={cn("size-4 shrink-0", TASK_STATUS_CLASS[status])}
      />
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      {activity ? (
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            activity.state === "stalled"
              ? "border-warning/35 bg-warning/10 text-warning-foreground"
              : "border-success/30 bg-success/10 text-success",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              activity.state === "stalled"
                ? "bg-warning"
                : "animate-pulse bg-success motion-reduce:animate-none",
            )}
          />
          {activity.label}
        </span>
      ) : null}
      {progress ? (
        <span className="shrink-0 font-numeric text-xs tabular-nums text-muted-foreground">
          {progress.current}/{progress.total}
        </span>
      ) : null}
      <ChevronDownIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/task:rotate-180"
      />
    </CollapsibleTrigger>
  );
};

export const TaskContent = ({
  className,
  ...props
}: ComponentProps<typeof CollapsibleContent>) => (
  <CollapsibleContent
    className={cn("ml-2 border-l border-border/70 pl-6", className)}
    {...props}
  />
);

export const TaskItem = ({
  className,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn("py-1 text-xs leading-5 text-muted-foreground", className)}
    {...props}
  />
);

export const TaskItemFile = ({
  className,
  ...props
}: ComponentProps<"span">) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]",
      className,
    )}
    {...props}
  />
);
