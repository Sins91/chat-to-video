const MAX_GENERATED_VIDEO_TITLE_CHARACTERS = 80;

export const createGeneratedVideoFilename = (title: string, id: string): string => {
  const normalized = title.normalize("NFKC")
    .replace(/[^\p{L}\p{N} _.-]+/gu, "-")
    .replace(/\s+/gu, " ")
    .replace(/\.{2,}/gu, ".")
    .replace(/^[ ._-]+|[ ._-]+$/gu, "");
  const truncated = Array.from(normalized)
    .slice(0, MAX_GENERATED_VIDEO_TITLE_CHARACTERS)
    .join("")
    .replace(/[ ._-]+$/gu, "");
  return `${truncated || `video-${id.slice(0, 8)}`}.mp4`;
};
