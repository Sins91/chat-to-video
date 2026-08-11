import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("Chinese UI localization", () => {
  it("renders readable Chinese cinematic artifact labels", async () => {
    const card = await readFile(
      resolve(
        webRoot,
        "components/video-workflow/cinematic-artifact-card.tsx",
      ),
      "utf8",
    );

    expect(card).toContain("电影化创作");
    expect(card).toContain("查看结构化详情");
    expect(card).toContain("当前方案等待确认");
    expect(card).not.toContain("???");
  });
});
