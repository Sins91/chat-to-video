import { ModelGatewayError } from "../model-gateway/model-gateway.js";

const sanitizeDiagnostic = (value: string): string => value
  .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
  .replace(/\b(api[_-]?key|authorization|token)\s*[:=]\s*\S+/giu, "$1=[redacted]")
  .replace(/https?:\/\/\S+/giu, "[redacted-url]")
  .replace(/\s+/gu, " ")
  .trim()
  .slice(0, 800);

export const formatVideoWorkflowFailure = (
  stage: string,
  error: unknown,
): string => {
  const detail = error instanceof ModelGatewayError
    ? error.diagnosticMessage
    : error instanceof Error
      ? error.message
      : "未知错误";
  const safeDetail = sanitizeDiagnostic(detail || "未知错误");
  return `[${stage}] ${safeDetail}`.slice(0, 1_000);
};
