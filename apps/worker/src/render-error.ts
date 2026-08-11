import { PermanentVideoError } from "./seedance-client.js";

const sanitizeDiagnostic = (value: string): string => value
  .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
  .replace(/\b(api[_-]?key|authorization|token)\s*[:=]\s*\S+/giu, "$1=[redacted]")
  .replace(/https?:\/\/\S+/giu, "[redacted-url]")
  .replace(/\s+/gu, " ")
  .trim();

export const renderFailureMessage = (stage: string, error: unknown): string => {
  const detail = error instanceof Error ? error.message : "未知错误";
  const safeDetail = sanitizeDiagnostic(detail || "未知错误");
  if (/^\[[^\]]+\]\s/u.test(safeDetail)) return safeDetail.slice(0, 1_000);
  return `[${stage}] ${safeDetail}`.slice(0, 1_000);
};

export const renderStageError = (stage: string, error: unknown): Error => {
  if (error instanceof Error && /^\[[^\]]+\]\s/u.test(error.message)) return error;
  const message = renderFailureMessage(stage, error);
  return error instanceof PermanentVideoError
    ? new PermanentVideoError(message)
    : new Error(message, { cause: error });
};
