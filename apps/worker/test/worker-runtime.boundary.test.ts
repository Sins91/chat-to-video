import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Worker container runtime", () => {
  it("installs FFmpeg and configures the executable path", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const [dockerfile, compose] = await Promise.all([
      readFile(resolve(repositoryRoot, "infra/docker/Dockerfile"), "utf8"),
      readFile(resolve(repositoryRoot, "compose.yaml"), "utf8"),
    ]);

    expect(dockerfile).toContain("apt-get install --yes --no-install-recommends ffmpeg");
    expect(dockerfile).toContain("fonts-noto-cjk");
    expect(dockerfile).toContain("ENV FFMPEG_PATH=/usr/bin/ffmpeg");
    expect(compose).toContain('FFMPEG_PATH: "${FFMPEG_PATH:-/usr/bin/ffmpeg}"');
  });
});
