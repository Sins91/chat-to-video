import { describe, expect, it } from "vitest";

import { buildConversationHistorySeeds } from "../scripts/seed-conversation-history.mjs";

describe("conversation history seed", () => {
  it("covers every sidebar history period with one simple exchange", () => {
    const now = new Date(2026, 7, 12, 18, 30);
    const seeds = buildConversationHistorySeeds(now);
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    expect(seeds).toHaveLength(4);
    expect(seeds.map((seed) => {
      const date = new Date(seed.createdAt);
      date.setHours(0, 0, 0, 0);
      return Math.floor((today.getTime() - date.getTime()) / 86_400_000);
    })).toEqual([0, 1, 3, 14]);
    expect(seeds.every((seed) => seed.question.length > 0 && seed.answer.length > 0)).toBe(true);
  });

  it("uses stable IDs so reruns update instead of duplicating conversations", () => {
    const first = buildConversationHistorySeeds(new Date(2026, 7, 12));
    const second = buildConversationHistorySeeds(new Date(2026, 7, 13));

    expect(second.map((seed) => seed.id)).toEqual(first.map((seed) => seed.id));
    expect(new Set(first.map((seed) => seed.id)).size).toBe(4);
  });
});
