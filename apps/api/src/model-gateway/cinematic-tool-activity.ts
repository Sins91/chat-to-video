import type { WorkflowToolActivity } from "@chat-to-video/contracts";

type CinematicToolPresenter = {
  readonly toolLabel: string;
  readonly summaries?: Partial<
    Record<
      WorkflowToolActivity["state"],
      string | ((input: unknown) => string)
    >
  >;
};

// Add a presenter only when a real Cinematic tool is registered. Presenter
// functions must select explicitly safe fields and must never return raw input.
const CINEMATIC_TOOL_PRESENTERS: Readonly<Record<string, CinematicToolPresenter>> =
  Object.freeze({
    get_agent_capabilities: { toolLabel: "能力目录" },
    get_video_model_constraints: { toolLabel: "视频模型约束" },
    get_cinematic_context: { toolLabel: "制作上下文" },
    estimate_cinematic_cost: { toolLabel: "成本估算" },
    skill: { toolLabel: "阶段技能" },
    skill_read: { toolLabel: "读取技能说明" },
    skill_search: { toolLabel: "检索技能说明" },
  });

const DEFAULT_SUMMARY: Record<WorkflowToolActivity["state"], string> = {
  running: "\u6b63\u5728\u6267\u884c\u5de5\u5177\u64cd\u4f5c\u2026",
  completed: "\u5de5\u5177\u8fd0\u884c\u5b8c\u6210\u3002",
  failed: "\u5de5\u5177\u8fd0\u884c\u5931\u8d25\uff0cAgent \u6b63\u5728\u5c1d\u8bd5\u6062\u590d\u3002",
};

const trimPresentationText = (
  value: string,
  maximumLength: number,
  fallback: string,
): string => {
  const normalized = value.trim();
  return (normalized.length > 0 ? normalized : fallback).slice(0, maximumLength);
};

const safeToolName = (toolName: string): string => {
  const normalized = toolName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "")
    .slice(0, 100);
  return normalized || "unknown-tool";
};

const fallbackToolLabel = (toolName: string): string => {
  const humanized = toolName
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[._-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return trimPresentationText(`\u5de5\u5177 \u00b7 ${humanized || "\u672a\u77e5\u5de5\u5177"}`, 80, "\u5de5\u5177 \u00b7 \u672a\u77e5\u5de5\u5177");
};

export const presentCinematicToolActivity = (input: {
  readonly toolName: string;
  readonly state: WorkflowToolActivity["state"];
  readonly toolInput?: unknown;
}): WorkflowToolActivity => {
  const toolName = safeToolName(input.toolName);
  const presenter = CINEMATIC_TOOL_PRESENTERS[input.toolName];
  const summaryPresenter = presenter?.summaries?.[input.state];
  const presentedSummary = typeof summaryPresenter === "function"
    ? summaryPresenter(input.toolInput)
    : summaryPresenter;

  return {
    toolName,
    toolLabel: trimPresentationText(
      presenter?.toolLabel ?? fallbackToolLabel(toolName),
      80,
      fallbackToolLabel(toolName),
    ),
    state: input.state,
    summary: trimPresentationText(
      presentedSummary ?? DEFAULT_SUMMARY[input.state],
      500,
      DEFAULT_SUMMARY[input.state],
    ),
  };
};
