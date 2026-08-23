import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertOutputFile, resolveInputFile, resolveOutputFile, runMediaProcess, validateExecutable, validateTimeout } from "./media-tool-runtime.js";
import { generateSubtitles, type SubtitleSegment } from "./subtitle-generator.js";

export const burnSubtitles = async (input: {
  ffmpegPath: string; inputPath: string; outputPath: string; allowedDirectory: string;
  segments: readonly SubtitleSegment[]; wordsPerCue?: number; maxCharsPerLine?: number;
  fontSize?: number; bottomMargin?: number; timeoutMs?: number;
}): Promise<{ method: "ffmpeg_libass"; cueCount: number; outputFileName: string; sizeBytes: number }> => {
  const fontSize = input.fontSize ?? 24;
  const bottomMargin = input.bottomMargin ?? 80;
  if (!Number.isInteger(fontSize) || fontSize < 12 || fontSize > 96 || !Number.isInteger(bottomMargin) || bottomMargin < 0 || bottomMargin > 500) throw new Error("Subtitle burn style is invalid.");
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const output = await resolveOutputFile(input.outputPath, input.allowedDirectory);
  const subtitles = generateSubtitles({ segments: input.segments, format: "srt", maxWordsPerCue: input.wordsPerCue ?? 4, maxCharsPerLine: input.maxCharsPerLine ?? 42 });
  if (!subtitles.cueCount) throw new Error("Subtitle burn requires at least one cue.");
  const temporaryDirectory = await mkdtemp(join(dirname(output), ".subtitle-burn-"));
  try {
    const subtitlePath = join(temporaryDirectory, "captions.srt");
    if (subtitlePath.includes("'")) throw new Error("Subtitle task path contains an unsupported character.");
    await writeFile(subtitlePath, subtitles.content, "utf8");
    const escapedPath = subtitlePath.replaceAll("\\", "/").replace(":", "\\:");
    const filter = `subtitles='${escapedPath}':force_style='FontName=Noto Sans CJK SC,FontSize=${fontSize},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Shadow=1,Alignment=2,MarginV=${bottomMargin}'`;
    await runMediaProcess({
      executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs: validateTimeout(input.timeoutMs, 180_000),
      args: ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vf", filter, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output],
    });
    return { method: "ffmpeg_libass", cueCount: subtitles.cueCount, outputFileName: output.split(/[\\/]/).at(-1) ?? "", sizeBytes: await assertOutputFile(output) };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
};
