import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("API SWC configuration", () => {
  it("does not load the removed workflow compiler plugin", async () => {
    const source = await readFile(resolve(import.meta.dirname, "../.swcrc"), "utf8");
    const config = JSON.parse(source) as {
      jsc?: { experimental?: { plugins?: unknown[] } };
    };

    expect(source).not.toContain("@workflow");
    expect(source).not.toContain("swc_plugin_workflow");
    expect(config.jsc?.experimental?.plugins).toBeUndefined();
  });

  it("starts the compiled Nest entrypoint from the standard SWC output", async () => {
    const source = await readFile(resolve(import.meta.dirname, "../package.json"), "utf8");
    const packageJson = JSON.parse(source) as { scripts?: { start?: string } };

    expect(packageJson.scripts?.start).toBe("node dist/main.js");
  });
});
