import type { WorkflowToolActivity } from "@chat-to-video/contracts";

type CinematicToolPresenter = {
  readonly toolLabel: string;
  readonly operation: string | ((input: unknown) => string);
};

// Add a presenter only when a real Cinematic tool is registered. Presenter
// functions must select explicitly safe fields and must never return raw input.
const CINEMATIC_TOOL_PRESENTERS: Readonly<Record<string, CinematicToolPresenter>> =
  Object.freeze({
    get_agent_capabilities: { toolLabel: "能力目录", operation: "查询 Agent 能力" },
    get_workflow_tools: { toolLabel: "工作流工具", operation: "查询当前阶段可用工具" },
    get_video_model_constraints: { toolLabel: "视频模型约束", operation: "查询视频模型限制" },
    get_cinematic_context: { toolLabel: "制作上下文", operation: "读取当前制作上下文" },
    estimate_cinematic_cost: { toolLabel: "成本估算", operation: "估算视频生成成本" },
    prompt_compressor: {
      toolLabel: "提示词压缩",
      operation: (input) => {
        if (typeof input !== "object" || input === null) return "压缩超长生产提示词";
        const purpose = "purpose" in input && typeof input.purpose === "string"
          ? input.purpose.replace(/[^a-z_]+/gu, "").slice(0, 40)
          : "production_prompt";
        const maximum = "maxCharacters" in input && typeof input.maxCharacters === "number"
          ? input.maxCharacters
          : null;
        return maximum === 1_000 || maximum === 4_000
          ? `压缩 ${purpose} 提示词至 ${maximum} 字符以内`
          : `压缩 ${purpose} 提示词`;
      },
    },
    web_search: { toolLabel: "网络搜索", operation: "搜索相关参考资料" },
    image_selector: { toolLabel: "图像服务选择", operation: "选择图像生成服务" },
    video_selector: { toolLabel: "视频服务选择", operation: "选择视频生成服务" },
    tts_selector: { toolLabel: "语音服务选择", operation: "选择语音合成服务" },
    skill: { toolLabel: "阶段技能", operation: "加载阶段技能" },
    skill_read: { toolLabel: "技能说明", operation: "读取技能说明" },
    skill_search: { toolLabel: "技能检索", operation: "检索技能说明" },
  });

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
  return trimPresentationText(humanized || "未知工具", 80, "未知工具");
};

export const presentCinematicToolActivity = (input: {
  readonly toolName: string;
  readonly state: WorkflowToolActivity["state"];
  readonly toolInput?: unknown;
}): WorkflowToolActivity => {
  const toolName = safeToolName(input.toolName);
  const presenter = CINEMATIC_TOOL_PRESENTERS[input.toolName];
  const toolLabel = trimPresentationText(
    presenter?.toolLabel ?? fallbackToolLabel(toolName),
    80,
    fallbackToolLabel(toolName),
  );
  const operationPresenter = presenter?.operation ?? `调用 ${toolLabel}`;
  const presentedOperation = typeof operationPresenter === "function"
    ? operationPresenter(input.toolInput)
    : operationPresenter;

  return {
    toolName,
    toolLabel,
    state: input.state,
    summary: trimPresentationText(
      presentedOperation,
      500,
      `调用 ${toolLabel}`,
    ),
  };
};
