import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("conversation history migration", () => {
  it("adds durable conversations, ordered messages, and a unique workflow link", async () => {
    const migration = await readFile(resolve(import.meta.dirname, "../migrations/0001_conversation_history.sql"), "utf8");
    expect(migration).toContain("CREATE TABLE `conversations`");
    expect(migration).toContain("CREATE TABLE `conversation_messages`");
    expect(migration).toContain("conversation_messages_order_idx");
    expect(migration).toContain("video_workflows_conversation_id_uq");
  });
});
