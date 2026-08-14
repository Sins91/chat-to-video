import { describe, expect, it } from "vitest";

import {
  createVideoWorkflowRequestError,
  formatVideoWorkflowError,
} from "../lib/video-workflow-error";

describe("video workflow error presentation", () => {
  it("replaces server failures with a normal restart guidance message", () => {
    const error = createVideoWorkflowRequestError({
      statusCode: 500,
      message: "Internal server error",
    }, 500, "Internal Server Error");

    expect(formatVideoWorkflowError(error, {
      operation: "control",
      workflowId: "workflow-1",
      requestId: "request-1",
    })).toBe("当前服务出现错误，建议新建对话重新开始。");
  });

  it("does not expose business diagnostics in the chat message", () => {
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

    const formatted = formatVideoWorkflowError(error, { operation: "control" });
    expect(formatted).toBe("当前服务出现错误，建议新建对话重新开始。");
    expect(formatted).not.toContain("HTTP 400");
  });
});
