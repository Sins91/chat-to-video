const PROCESSING_TIME_PREFIX = "chat-to-video:processing-started-at:";
const MAX_PROCESSING_AGE_MS = 24 * 60 * 60 * 1_000;

type ProcessingTimeStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const storageKey = (processingKey: string): string =>
  `${PROCESSING_TIME_PREFIX}${processingKey}`;

export const readProcessingStartedAt = (
  storage: ProcessingTimeStorage,
  processingKey: string,
  now = Date.now(),
): number | null => {
  try {
    const value = Number(storage.getItem(storageKey(processingKey)));
    if (!Number.isFinite(value) || value <= 0 || value > now || now - value > MAX_PROCESSING_AGE_MS) {
      storage.removeItem(storageKey(processingKey));
      return null;
    }
    return value;
  } catch {
    return null;
  }
};

export const saveProcessingStartedAt = (
  storage: ProcessingTimeStorage,
  processingKey: string,
  startedAt: number,
): void => {
  try {
    storage.setItem(storageKey(processingKey), String(startedAt));
  } catch {
    // Timing remains available in component memory when session storage is unavailable.
  }
};

export const clearProcessingStartedAt = (
  storage: ProcessingTimeStorage,
  processingKey: string,
): void => {
  try {
    storage.removeItem(storageKey(processingKey));
  } catch {
    // Nothing else is required when session storage is unavailable.
  }
};
