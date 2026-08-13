type ErrorIssue = {
  message: string;
  path?: string;
};

type ErrorResponseBody = {
  code?: string;
  message?: string;
  issues: ErrorIssue[];
};

export type VideoWorkflowOperation =
  | "create"
  | "load"
  | "approve"
  | "revise"
  | "restart_request"
  | "restart_confirm"
  | "restart_cancel"
  | "retry"
  | "recover"
  | "update_model";

export class VideoWorkflowRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: readonly ErrorIssue[];

  constructor(input: {
    code: string;
    status: number;
    message: string;
    issues?: readonly ErrorIssue[];
  }) {
    super(input.message);
    this.name = "VideoWorkflowRequestError";
    this.code = input.code;
    this.status = input.status;
    this.issues = input.issues ?? [];
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseIssues = (value: unknown): ErrorIssue[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.message !== "string") return [];
    const path = Array.isArray(item.path)
      ? item.path.filter((part): part is string | number =>
          typeof part === "string" || typeof part === "number")
        .join(".")
      : undefined;
    return [{ message: item.message, ...(path ? { path } : {}) }];
  }).slice(0, 3);
};

const parseErrorBody = (body: unknown): ErrorResponseBody => {
  if (!isRecord(body)) return { issues: [] };
  const nestedMessages = Array.isArray(body.message)
    ? body.message.filter((message): message is string => typeof message === "string")
    : [];
  return {
    code: typeof body.code === "string" ? body.code : undefined,
    message: typeof body.message === "string"
      ? body.message
      : nestedMessages.length > 0
        ? nestedMessages.join("；")
        : undefined,
    issues: parseIssues(body.issues),
  };
};

const isGenericServerMessage = (message: string | undefined): boolean =>
  message?.trim().toLowerCase() === "internal server error";

export const createVideoWorkflowRequestError = (
  body: unknown,
  status: number,
  statusText: string,
): VideoWorkflowRequestError => {
  const parsed = parseErrorBody(body);
  const code = parsed.code ?? (status >= 500
    ? "VIDEO_WORKFLOW_INTERNAL_ERROR"
    : "VIDEO_WORKFLOW_REQUEST_FAILED");
  const message = !parsed.message || isGenericServerMessage(parsed.message)
    ? status >= 500
      ? "服务端处理视频工作流时发生未预期错误。"
      : statusText || "视频工作流请求未完成。"
    : parsed.message;
  return new VideoWorkflowRequestError({
    code,
    status,
    message,
    issues: parsed.issues,
  });
};

const OPERATION_LABELS: Record<VideoWorkflowOperation, string> = {
  create: "创建视频工作流",
  load: "加载视频工作流",
  approve: "确认当前阶段",
  revise: "提交阶段修改",
  restart_request: "申请重新开始",
  restart_confirm: "确认重新开始",
  restart_cancel: "取消重新开始",
  retry: "重试视频生成",
  recover: "恢复任务",
  update_model: "切换视频模型",
};

const ERROR_REASONS: Readonly<Record<string, string>> = {
  CONVERSATION_NOT_FOUND: "当前对话不存在、已被删除或不可访问。",
  CONVERSATION_WORKFLOW_ACTIVE: "当前对话已有正在执行的工作流，不能同时创建另一个工作流。",
  DATABASE_SCHEMA_OUTDATED: "数据库结构落后于当前应用代码，尚未应用必要的 Drizzle 迁移。",
  INVALID_SCENE_DURATIONS: "提交的镜头时长与当前分镜写作不一致。",
  INVALID_VIDEO_MODEL_REQUEST: "视频模型参数无效。",
  INVALID_VIDEO_WORKFLOW_ID: "视频工作流标识无效。",
  INVALID_VIDEO_WORKFLOW_INTERACTION: "本次工作流操作参数无效。",
  INVALID_VIDEO_WORKFLOW_REQUEST: "创建工作流的参数无效。",
  SCENE_DURATIONS_NOT_AVAILABLE: "当前阶段不支持修改镜头时长。",
  VIDEO_DURATION_INFERENCE_FAILED: "系统未能根据对话确定视频时长。",
  VIDEO_MODEL_LOCKED: "工作流已进入模型锁定阶段，当前不能切换视频模型。",
  VIDEO_WORKFLOW_INTERNAL_ERROR: "服务端处理视频工作流时发生未预期错误。",
  VIDEO_WORKFLOW_NOT_FOUND: "该视频工作流不存在或已不可访问。",
  VIDEO_WORKFLOW_NOT_RECOVERABLE: "当前失败任务不满足原任务重试条件。",
  VIDEO_WORKFLOW_NOT_WAITING: "工作流当前不在等待确认状态，可能已被其他操作推进。",
  VIDEO_WORKFLOW_REQUEST_FAILED: "视频工作流请求未完成。",
  VIDEO_WORKFLOW_RESUME_FAILED: "工作流恢复执行失败，失败状态已记录。",
  VIDEO_WORKFLOW_RETRY_CLAIMED: "该失败任务已被其他请求认领或状态已经变化。",
  VIDEO_WORKFLOW_RETRY_FAILED: "重新提交原视频任务失败，失败状态已记录。",
  VIDEO_WORKFLOW_RESTART_CONFIRMATION_PENDING: "已有待确认的重新开始请求，请先确认或取消。",
  VIDEO_WORKFLOW_RESTART_CONFIRMATION_STALE: "重新开始确认已过期，或工作流版本已经变化。",
  VIDEO_WORKFLOW_RESTART_FAILED: "创建或启动新的工作流运行失败，失败状态已记录。",
  VIDEO_WORKFLOW_RESTART_NOT_ALLOWED: "工作流正在执行、排队或已取消，当前不能重新开始。",
  VIDEO_WORKFLOW_RESTART_PREREQUISITE_MISSING: "重新开始所需的上游阶段产物不存在。",
  VIDEO_WORKFLOW_RESTART_REQUEST_STALE: "保存重新开始请求前，工作流状态或版本已经变化。",
  VIDEO_WORKFLOW_RESTART_STAGE_UNAVAILABLE: "所选阶段不可重启，或当前工作流尚未到达该阶段。",
  VIDEO_WORKFLOW_RUN_NOT_RESUMABLE: "原工作流运行快照不存在或已不兼容，无法继续恢复。",
  VIDEO_WORKFLOW_START_FAILED: "工作流运行创建或启动失败，失败状态已记录。",
  VIDEO_WORKFLOW_UNAVAILABLE: "Web 无法连接视频工作流服务。",
};

const suggestionForStatus = (status: number): string => {
  if (status === 400) return "请检查本次输入后重新提交。";
  if (status === 401 || status === 403) return "请重新登录或确认当前项目访问权限。";
  if (status === 404) return "请刷新对话；如果工作流已删除，请重新创建。";
  if (status === 409) return "请刷新工作流快照，确认最新阶段和版本后再操作。";
  if (status === 429) return "请求过于频繁，请稍后再试。";
  if (status >= 500) return "请先刷新工作流状态后重试；若持续发生，请将诊断信息提供给开发人员。";
  return "请刷新工作流状态后重试。";
};

const compactUnknownMessage = (error: unknown): string => {
  if (!(error instanceof Error) || !error.message.trim()) return "客户端未能识别错误响应。";
  return error.message.trim().slice(0, 300);
};

export const formatVideoWorkflowError = (
  error: unknown,
  context: {
    operation: VideoWorkflowOperation;
    workflowId?: string | null;
    requestId?: string | null;
  },
): string => {
  const requestError = error instanceof VideoWorkflowRequestError ? error : null;
  const code = requestError?.code ?? "VIDEO_WORKFLOW_CLIENT_ERROR";
  const status = requestError?.status ?? 0;
  const reason = ERROR_REASONS[code] ?? requestError?.message ?? compactUnknownMessage(error);
  const diagnostics = [
    `错误码 ${code}`,
    ...(status > 0 ? [`HTTP ${status}`] : []),
    ...(context.workflowId ? [`工作流 ${context.workflowId}`] : []),
    ...(context.requestId ? [`请求 ${context.requestId}`] : []),
  ];
  const issueText = requestError?.issues.length
    ? `\n校验详情：${requestError.issues.map((issue) =>
        `${issue.path ? `${issue.path}：` : ""}${issue.message}`).join("；")}`
    : "";
  return `${OPERATION_LABELS[context.operation]}失败：${reason}${issueText}\n诊断信息：${diagnostics.join(" · ")}\n建议：${suggestionForStatus(status)}`;
};
