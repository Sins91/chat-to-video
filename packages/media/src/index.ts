import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";

export {
  probeAudio,
  type AudioProbeResult,
  type AudioProbeStream,
} from "./audio-probe.js";
export { AUDIO_ENHANCEMENT_PRESETS, enhanceAudio, type AudioEnhancementPreset } from "./audio-enhancer.js";
export { inspectAvSync } from "./av-sync-qa.js";
export { COLOR_GRADE_PROFILES, gradeVideoColor, gradeVideoWithLut, type ColorGradeProfile } from "./color-grader.js";
export { sampleFrames, type FrameSamplingStrategy, type SampledFrame, type SceneBoundary } from "./frame-sampler.js";
export { detectScenes, type DetectedScene } from "./scene-detector.js";
export { cutSilence, detectSilence, type SilenceSegment, type SpeechSegment } from "./silence-cutter.js";
export { burnSubtitles } from "./subtitle-burner.js";
export {
  generateSubtitles,
  type SubtitleFormat,
  type SubtitleHighlightStyle,
  type SubtitleSegment,
  type SubtitleWord,
} from "./subtitle-generator.js";
export { changeVideoSpeed, concatVideoSegments, trimVideo, type VideoConcatSegment } from "./video-trimmer.js";
export { reviewVisualMedia, type AudioLevelResult, type VisualQaFrame } from "./visual-qa.js";

export type CinematicClip = {
  body: Uint8Array;
  durationSeconds: number;
  mimeType?: "video/mp4" | "image/png" | "image/jpeg";
  audioMode?: "embedded" | "silence";
  audioGainDb?: number;
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

export const resizeImageToVideoFrame = async (input: {
  body: Uint8Array;
  width: number;
  height: number;
}): Promise<Uint8Array> => {
  if (input.body.byteLength === 0 || input.body.byteLength > 100 * 1024 * 1024) {
    throw new Error("Image resize received an invalid input size.");
  }
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) ||
      input.width < 1 || input.height < 1 || input.width > 4_096 || input.height > 4_096) {
    throw new Error("Image resize received invalid target dimensions.");
  }
  const output = await sharp(input.body)
    .resize(input.width, input.height, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(output);
};

export type ReferenceImageInspection = {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
};

export const inspectReferenceImage = async (body: Uint8Array): Promise<ReferenceImageInspection> => {
  if (body.byteLength === 0 || body.byteLength > 10 * 1024 * 1024) {
    throw new Error("Reference image size is invalid.");
  }
  const metadata = await sharp(body, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
  const mimeType = metadata.format === "jpeg"
    ? "image/jpeg" as const
    : metadata.format === "png"
      ? "image/png" as const
      : metadata.format === "webp"
        ? "image/webp" as const
        : null;
  if (!mimeType || !metadata.width || !metadata.height ||
      metadata.width > 16_384 || metadata.height > 16_384) {
    throw new Error("Reference image format or dimensions are invalid.");
  }
  return {
    mimeType,
    sizeBytes: body.byteLength,
    width: metadata.width,
    height: metadata.height,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
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
  frameDimensions?: { width: number; height: number };
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
    clip.durationSeconds > 15 ||
    !Number.isFinite(clip.audioGainDb ?? 0) ||
    (clip.audioGainDb ?? 0) < -60 ||
    (clip.audioGainDb ?? 0) > 12 ||
    ((clip.audioMode ?? "silence") === "embedded" &&
      (clip.mimeType ?? "video/mp4") !== "video/mp4")
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
  const frameDimensions = input.frameDimensions ?? { width: 1280, height: 720 };
  if (
    !Number.isInteger(frameDimensions.width) || !Number.isInteger(frameDimensions.height) ||
    frameDimensions.width < 480 || frameDimensions.width > 3840 ||
    frameDimensions.height < 480 || frameDimensions.height > 3840 ||
    frameDimensions.width % 2 !== 0 || frameDimensions.height % 2 !== 0
  ) {
    throw new Error("Cinematic composition received invalid frame dimensions.");
  }
  const executablePath = input.ffmpegPath.trim();
  if (!executablePath || executablePath.includes("\0")) {
    throw new Error("FFmpeg executable path is invalid.");
  }

  const directory = await mkdtemp(join(tmpdir(), "chat-to-video-cinematic-"));
  const outputPath = join(directory, "output.mp4");
  try {
    const inputArgs: string[] = [];
    const videoInputIndices: number[] = [];
    const audioInputIndices: number[] = [];
    let nextInputIndex = 0;
    for (const [index, clip] of input.clips.entries()) {
      const mimeType = clip.mimeType ?? "video/mp4";
      const suffix = mimeType === "image/png"
        ? "png"
        : mimeType === "image/jpeg"
          ? "jpg"
          : "mp4";
      const inputPath = join(directory, `scene-${index + 1}.${suffix}`);
      await writeFile(inputPath, clip.body);
      videoInputIndices.push(nextInputIndex);
      if (mimeType.startsWith("image/")) {
        inputArgs.push("-loop", "1", "-t", String(clip.durationSeconds), "-i", inputPath);
      } else {
        inputArgs.push("-i", inputPath);
      }
      const videoInputIndex = nextInputIndex;
      nextInputIndex += 1;
      if ((clip.audioMode ?? "silence") === "embedded") {
        audioInputIndices.push(videoInputIndex);
      } else {
        inputArgs.push(
          "-f",
          "lavfi",
          "-t",
          String(clip.durationSeconds),
          "-i",
          "anullsrc=channel_layout=stereo:sample_rate=48000",
        );
        audioInputIndices.push(nextInputIndex);
        nextInputIndex += 1;
      }
    }
    const filterParts = input.clips.map((clip, index) =>
      `[${videoInputIndices[index]}:v:0]trim=duration=${clip.durationSeconds},setpts=PTS-STARTPTS,scale=${frameDimensions.width}:${frameDimensions.height}:force_original_aspect_ratio=decrease,pad=${frameDimensions.width}:${frameDimensions.height}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p[v${index}]`
    );
    filterParts.push(...input.clips.map((clip, index) =>
      `[${audioInputIndices[index]}:a:0]atrim=duration=${clip.durationSeconds},` +
      `asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,` +
      `volume=${clip.audioGainDb ?? 0}dB[a${index}]`
    ));
    const concatInputs = input.clips.map((_, index) => `[v${index}]`).join("");
    filterParts.push(`${concatInputs}concat=n=${input.clips.length}:v=1:a=0[outv]`);
    const audioConcatInputs = input.clips.map((_, index) => `[a${index}]`).join("");
    filterParts.push(`${audioConcatInputs}concat=n=${input.clips.length}:v=0:a=1[sceneaudio]`);
    let musicInputArgs: string[] = [];
    let audioMap = "[sceneaudio]";
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
      const musicInputIndex = nextInputIndex;
      musicInputArgs = ["-stream_loop", "-1", "-i", musicPath];
      const fadeOutStart = Math.max(0, totalDuration - 1);
      filterParts.push(
        `[${musicInputIndex}:a:0]atrim=duration=${totalDuration},asetpts=PTS-STARTPTS,` +
        `volume=${input.music.gainDb ?? -12}dB,afade=t=in:st=0:d=1,` +
        `afade=t=out:st=${fadeOutStart}:d=1,aformat=sample_rates=48000:channel_layouts=stereo[music]`,
      );
      filterParts.push(
        "[sceneaudio][music]amix=inputs=2:duration=first:dropout_transition=0," +
        "alimiter=limit=0.95:attack=5:release=50[aout]",
      );
      audioMap = "[aout]";
    }
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...inputArgs,
      ...musicInputArgs,
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
