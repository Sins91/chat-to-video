import { describe, expect, it } from "vitest";

import { ModelGatewayError } from "../src/model-gateway/model-gateway.js";
import { formatVideoWorkflowFailure } from "../src/video-workflow/video-workflow-error.js";

describe("formatVideoWorkflowFailure", () => {
  it("includes the workflow stage and safe upstream LLM diagnostic", () => {
    const error = new ModelGatewayError("request-1", {
      diagnosticMessage: "上游 LLM 返回 HTTP 400：invalid json",
      isRetryable: false,
    });

    expect(formatVideoWorkflowFailure("创作研究 · LLM 生成", error)).toBe(
      "[创作研究 · LLM 生成] 上游 LLM 返回 HTTP 400：invalid json",
    );
  });

  it("redacts credentials and URLs before persistence", () => {
    const error = new Error(
      "request failed Authorization=secret https://signed.example/video?token=secret",
    );

    expect(formatVideoWorkflowFailure("渲染任务入队", error)).toBe(
      "[渲染任务入队] request failed Authorization=[redacted] [redacted-url]",
    );
  });
});
