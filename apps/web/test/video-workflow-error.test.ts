import { describe, expect, it } from "vitest";

import {
  createVideoWorkflowRequestError,
  formatVideoWorkflowError,
} from "../lib/video-workflow-error";

describe("video workflow error presentation", () => {
  it("replaces Nest's generic internal error with actionable diagnostics", () => {
    const error = createVideoWorkflowRequestError({
      statusCode: 500,
      message: "Internal server error",
    }, 500, "Internal Server Error");

    expect(formatVideoWorkflowError(error, {
      operation: "restart_confirm",
      workflowId: "workflow-1",
      requestId: "request-1",
    })).toBe([
      "确认重新开始失败：服务端处理视频工作流时发生未预期错误。",
      "诊断信息：错误码 VIDEO_WORKFLOW_INTERNAL_ERROR · HTTP 500 · 工作流 workflow-1 · 请求 request-1",
      "建议：请先刷新工作流状态后重试；若持续发生，请将诊断信息提供给开发人员。",
    ].join("\n"));
  });

  it("keeps business codes and includes bounded validation details", () => {
    const error = createVideoWorkflowRequestError({
      code: "INVALID_VIDEO_WORKFLOW_INTERACTION",
      message: "Video workflow interaction is invalid.",
      issues: [
        { path: ["targetStage"], message: "Invalid stage" },
        { path: ["text"], message: "Required" },
        { path: ["extra"], message: "Unexpected" },
        { path: ["ignored"], message: "Too many" },
      ],
    }, 400, "Bad Request");

    const formatted = formatVideoWorkflowError(error, { operation: "restart_request" });
    expect(formatted).toContain("本次工作流操作参数无效");
    expect(formatted).toContain("targetStage：Invalid stage");
    expect(formatted).not.toContain("Too many");
    expect(formatted).toContain("HTTP 400");
  });
});
