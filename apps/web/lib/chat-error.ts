const FALLBACK_CHAT_ERROR_MESSAGE = "响应失败，请稍后重试。";

const parseChatErrorPayload = (error: Error): { code?: string; message: string } => {
  const rawMessage = error.message.trim();
  if (!rawMessage) return { message: "" };

  try {
    const payload: unknown = JSON.parse(rawMessage);
    if (typeof payload !== "object" || payload === null) return { message: rawMessage };
    const code = "code" in payload && typeof payload.code === "string" ? payload.code : undefined;
    const message = "message" in payload && typeof payload.message === "string"
      ? payload.message.trim()
      : rawMessage;
    return { code, message };
  } catch {
    return { message: rawMessage };
  }
};

export function getChatErrorMessage(error: Error | undefined): string | undefined {
  if (!error) return undefined;
  return parseChatErrorPayload(error).message || FALLBACK_CHAT_ERROR_MESSAGE;
}
