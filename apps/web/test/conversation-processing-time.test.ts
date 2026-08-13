import { describe, expect, it } from "vitest";

import {
  clearProcessingStartedAt,
  readProcessingStartedAt,
  saveProcessingStartedAt,
} from "../lib/conversation-processing-time";

const createStorage = (): Pick<Storage, "getItem" | "removeItem" | "setItem"> => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
};

describe("conversation processing time", () => {
  it("restores a processing start after switching away and back", () => {
    const storage = createStorage();
    const startedAt = Date.UTC(2026, 7, 12, 9, 0, 0);

    saveProcessingStartedAt(storage, "workflow:request-1", startedAt);

    expect(readProcessingStartedAt(
      storage,
      "workflow:request-1",
      startedAt + 42_000,
    )).toBe(startedAt);
  });

  it("keeps the same workflow timer available through queued and running restoration", () => {
    const storage = createStorage();
    const startedAt = Date.UTC(2026, 7, 12, 9, 0, 0);
    const processingKey = "workflow:request-restored";

    saveProcessingStartedAt(storage, processingKey, startedAt);
    expect(readProcessingStartedAt(storage, processingKey, startedAt + 10_000)).toBe(startedAt);
    expect(readProcessingStartedAt(storage, processingKey, startedAt + 20_000)).toBe(startedAt);
  });

  it("clears completed and stale processing records", () => {
    const storage = createStorage();
    const startedAt = Date.UTC(2026, 7, 12, 9, 0, 0);

    saveProcessingStartedAt(storage, "chat:conversation-1:message-1", startedAt);
    clearProcessingStartedAt(storage, "chat:conversation-1:message-1");
    expect(readProcessingStartedAt(storage, "chat:conversation-1:message-1", startedAt + 1_000)).toBeNull();

    saveProcessingStartedAt(storage, "workflow:stale", startedAt);
    expect(readProcessingStartedAt(storage, "workflow:stale", startedAt + 25 * 60 * 60 * 1_000)).toBeNull();
  });
});
