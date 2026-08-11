import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("RenderProcessor workflow boundary", () => {
  it("persists terminal state without resuming an orchestration engine", async () => {
    const source = await readFile(resolve(import.meta.dirname, "../src/render-processor.ts"), "utf8");

    expect(source).not.toContain("resumeHook");
    expect(source).not.toContain('from "workflow');
    expect(source).toContain('status: "succeeded"');
    expect(source).toContain('status: "failed"');
    expect(source).toContain('type: "job.completed"');
    expect(source).toContain('type: "job.failed"');
    expect(source).toContain('`${payload.jobId}:completed`');
    expect(source).toContain('`${payload.jobId}:failed`');
    expect(source).toContain("const DOWNLOAD_ATTEMPTS = 5");
    expect(source).toContain("APIMart video result download network request failed");
    expect(source).toContain('"video-generation"');
    expect(source).toContain('"正在生成镜头 "');
    expect(source).toContain('"所有镜头已就绪，正在合成最终视频。"');
    expect(source).toContain('"正在保存最终视频。"');
    expect(source).toContain('eventKey + ":" + boundedProgress');
  });
});
