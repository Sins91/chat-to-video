export type VideoFailurePresentation = {
  detail: string;
  stage: string | null;
};

export const presentVideoFailure = (message: string | null): VideoFailurePresentation => {
  const fallback = "请检查任务日志后重试。";
  if (!message?.trim()) return { detail: fallback, stage: null };
  const match = /^\[([^\]]+)\]\s*(.+)$/u.exec(message.trim());
  if (!match) return { detail: message.trim(), stage: null };
  return {
    detail: match[2] ?? fallback,
    stage: match[1]?.trim() || null,
  };
};
