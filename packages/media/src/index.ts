import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

export type CinematicClip = {
  body: Uint8Array;
  durationSeconds: number;
  mimeType?: "video/mp4" | "image/png" | "image/jpeg";
};

export type CinematicMusicTrack = {
  body: Uint8Array;
  mimeType: "audio/wav" | "audio/mp4" | "audio/mpeg";
  gainDb?: number;
};

const escapeXml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

export const renderTitleCard = async (input: {
  title: string;
  aspectRatio: "16:9" | "9:16" | "1:1";
}): Promise<Uint8Array> => {
  const title = input.title.trim();
  if (!title || title.length > 160) throw new Error("Title card text is invalid.");
  const [width, height] = input.aspectRatio === "9:16"
    ? [1080, 1920]
    : input.aspectRatio === "1:1"
      ? [1080, 1080]
      : [1920, 1080];
  const fontSize = Math.max(54, Math.floor(Math.min(width, height) * 0.075));
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#09090b"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        fill="#fafafa" font-family="sans-serif" font-size="${fontSize}" font-weight="600">
        ${escapeXml(title)}
      </text>
    </svg>`;
  const output = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return new Uint8Array(output);
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
  music?: CinematicMusicTrack;
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
    const inputArgs: string[] = [];
    for (const [index, clip] of input.clips.entries()) {
      const mimeType = clip.mimeType ?? "video/mp4";
      const suffix = mimeType === "image/png"
        ? "png"
        : mimeType === "image/jpeg"
          ? "jpg"
          : "mp4";
      const inputPath = join(directory, `scene-${index + 1}.${suffix}`);
      await writeFile(inputPath, clip.body);
      if (mimeType.startsWith("image/")) {
        inputArgs.push("-loop", "1", "-t", String(clip.durationSeconds), "-i", inputPath);
      } else {
        inputArgs.push("-i", inputPath);
      }
    }
    const filterParts = input.clips.map((clip, index) =>
      `[${index}:v:0]trim=duration=${clip.durationSeconds},setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p[v${index}]`
    );
    const concatInputs = input.clips.map((_, index) => `[v${index}]`).join("");
    filterParts.push(`${concatInputs}concat=n=${input.clips.length}:v=1:a=0[outv]`);
    const audioInputIndex = input.clips.length;
    let audioInputArgs: string[];
    let audioMap: string;
    if (input.music) {
      if (
        input.music.body.byteLength === 0 ||
        input.music.body.byteLength > 100 * 1024 * 1024 ||
        !Number.isFinite(input.music.gainDb ?? -12) ||
        (input.music.gainDb ?? -12) < -60 ||
        (input.music.gainDb ?? -12) > 12
      ) {
        throw new Error("Cinematic composition received an invalid music track.");
      }
      const suffix = input.music.mimeType === "audio/wav"
        ? "wav"
        : input.music.mimeType === "audio/mpeg"
          ? "mp3"
          : "m4a";
      const musicPath = join(directory, `music.${suffix}`);
      await writeFile(musicPath, input.music.body);
      audioInputArgs = ["-stream_loop", "-1", "-i", musicPath];
      const fadeOutStart = Math.max(0, totalDuration - 1);
      filterParts.push(
        `[${audioInputIndex}:a:0]atrim=duration=${totalDuration},asetpts=PTS-STARTPTS,` +
        `volume=${input.music.gainDb ?? -12}dB,afade=t=in:st=0:d=1,` +
        `afade=t=out:st=${fadeOutStart}:d=1[aout]`,
      );
      audioMap = "[aout]";
    } else {
      audioInputArgs = [
        "-f",
        "lavfi",
        "-t",
        String(totalDuration),
        "-i",
        "anullsrc=channel_layout=stereo:sample_rate=48000",
      ];
      audioMap = `${audioInputIndex}:a:0`;
    }
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...inputArgs,
      ...audioInputArgs,
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[outv]",
      "-map",
      audioMap,
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
