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
  | "control"
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

export const formatVideoWorkflowError = (
  error: unknown,
  context: {
    operation: VideoWorkflowOperation;
    workflowId?: string | null;
    requestId?: string | null;
  },
): string => {
  void error;
  void context;
  return "当前服务出现错误，建议新建对话重新开始。";
};
