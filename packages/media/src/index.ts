import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type CinematicClip = {
  body: Uint8Array;
  durationSeconds: number;
};

const runFfmpeg = (
  executablePath: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(executablePath, args, {
    shell: false,
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  const timer = setTimeout(() => {
    child.kill("SIGKILL");
    reject(new Error(`FFmpeg exceeded the ${timeoutMs}ms execution limit.`));
  }, timeoutMs);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 8_000) stderr += chunk.slice(0, 8_000 - stderr.length);
  });
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(new Error("FFmpeg could not be started.", { cause: error }));
  });
  child.once("exit", (code, signal) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(
      `FFmpeg failed with code ${code ?? "unknown"} signal ${signal ?? "none"}: ${stderr.trim().slice(0, 2_000)}`,
    ));
  });
});

export const composeCinematicVideo = async (input: {
  ffmpegPath: string;
  clips: readonly CinematicClip[];
  timeoutMs?: number;
}): Promise<Uint8Array> => {
  if (input.clips.length < 1 || input.clips.length > 60) {
    throw new Error("Cinematic composition requires between 1 and 60 clips.");
  }
  if (input.clips.some((clip) =>
    clip.body.byteLength === 0 ||
    clip.body.byteLength > 250 * 1024 * 1024 ||
    !Number.isInteger(clip.durationSeconds) ||
    clip.durationSeconds < 1 ||
    clip.durationSeconds > 15
  )) {
    throw new Error("Cinematic composition received an invalid clip.");
  }
  const totalDuration = input.clips.reduce(
    (total, clip) => total + clip.durationSeconds,
    0,
  );
  if (totalDuration < 4 || totalDuration > 300) {
    throw new Error("Cinematic clips must total between 4 and 300 seconds.");
  }
  const executablePath = input.ffmpegPath.trim();
  if (!executablePath || executablePath.includes("\0")) {
    throw new Error("FFmpeg executable path is invalid.");
  }

  const directory = await mkdtemp(join(tmpdir(), "chat-to-video-cinematic-"));
  const outputPath = join(directory, "output.mp4");
  try {
    const inputPaths: string[] = [];
    for (const [index, clip] of input.clips.entries()) {
      const inputPath = join(directory, `scene-${index + 1}.mp4`);
      await writeFile(inputPath, clip.body);
      inputPaths.push(inputPath);
    }
    const filterParts = input.clips.map((clip, index) =>
      `[${index}:v:0]trim=duration=${clip.durationSeconds},setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p[v${index}]`
    );
    const concatInputs = input.clips.map((_, index) => `[v${index}]`).join("");
    filterParts.push(`${concatInputs}concat=n=${input.clips.length}:v=1:a=0[outv]`);
    const audioInputIndex = input.clips.length;
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...inputPaths.flatMap((path) => ["-i", path]),
      "-f",
      "lavfi",
      "-t",
      String(totalDuration),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[outv]",
      "-map",
      `${audioInputIndex}:a:0`,
      "-t",
      String(totalDuration),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputPath,
    ] as const;
    await runFfmpeg(executablePath, args, input.timeoutMs ?? 300_000);
    const output = new Uint8Array(await readFile(outputPath));
    if (output.byteLength === 0 || output.byteLength > 500 * 1024 * 1024) {
      throw new Error("FFmpeg produced an invalid cinematic output size.");
    }
    return output;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};
