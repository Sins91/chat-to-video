const FALLBACK_CHAT_ERROR_MESSAGE = "响应失败，请稍后重试。";

export function getChatErrorMessage(error: Error | undefined): string | undefined {
  if (!error) return undefined;

  const rawMessage = error.message.trim();
  if (!rawMessage) return FALLBACK_CHAT_ERROR_MESSAGE;

  try {
    const payload: unknown = JSON.parse(rawMessage);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string" &&
      payload.message.trim()
    ) {
      return payload.message.trim();
    }
  } catch {
    // 普通文本错误无需解析，直接交给提示框展示。
  }

  return rawMessage;
}
