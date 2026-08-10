export const createConversationTitle = (content: string): string => {
  const normalized = content.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  return characters.length <= 40 ? normalized : `${characters.slice(0, 40).join("")}…`;
};
