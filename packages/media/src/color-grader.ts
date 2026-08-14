import { extname } from "node:path";
import { assertOutputFile, resolveInputFile, resolveOutputFile, runMediaProcess, validateExecutable, validateTimeout } from "./media-tool-runtime.js";

export const COLOR_GRADE_PROFILES = {
  cinematic_warm: "colorbalance=rs=0.08:gs=0.02:bs=-0.05:rh=0.06:gh=0.02:bh=-0.04,curves=all='0/0.03 0.25/0.22 0.5/0.50 0.75/0.78 1/0.97',eq=contrast=1.05:saturation=1.1",
  cinematic_cool: "colorbalance=rs=-0.02:gs=-0.03:bs=0.08:rh=0.06:gh=-0.02:bh=-0.06,curves=all='0/0.02 0.25/0.20 0.5/0.48 0.75/0.78 1/0.98',eq=contrast=1.08:saturation=1.05",
  moody_dark: "curves=all='0/0.05 0.15/0.12 0.5/0.45 0.85/0.82 1/0.95',eq=contrast=1.12:saturation=0.8:brightness=-0.03",
  bright_clean: "curves=all='0/0.05 0.25/0.30 0.5/0.55 0.75/0.80 1/1.0',eq=contrast=1.0:saturation=1.15:brightness=0.02",
  vintage_film: "colorbalance=rs=0.06:gs=0.03:bs=-0.03:ms=0.03:mh=-0.02,curves=all='0/0.06 0.25/0.25 0.5/0.50 0.75/0.74 1/0.94',eq=saturation=0.85:contrast=0.95",
  high_contrast: "curves=all='0/0 0.20/0.12 0.5/0.50 0.80/0.88 1/1',eq=contrast=1.2:saturation=1.1",
  neutral: "eq=contrast=1.02:saturation=1.02:brightness=0.01",
} as const;
export type ColorGradeProfile = keyof typeof COLOR_GRADE_PROFILES;

export const gradeVideoColor = async (input: {
  ffmpegPath: string; inputPath: string; outputPath: string; allowedDirectory: string;
  profile?: ColorGradeProfile; crf?: number; timeoutMs?: number;
}): Promise<{ profile: ColorGradeProfile; outputFileName: string; sizeBytes: number }> => {
  const profile = input.profile ?? "cinematic_warm";
  const crf = input.crf ?? 20;
  if (!(profile in COLOR_GRADE_PROFILES) || !Number.isInteger(crf) || crf < 0 || crf > 40) throw new Error("Color grade settings are invalid.");
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const output = await resolveOutputFile(input.outputPath, input.allowedDirectory);
  await runMediaProcess({
    executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs: validateTimeout(input.timeoutMs, 180_000),
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-map", "0:v:0", "-map", "0:a?", "-vf", COLOR_GRADE_PROFILES[profile], "-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output],
  });
  return { profile, outputFileName: output.split(/[\\/]/).at(-1) ?? "", sizeBytes: await assertOutputFile(output) };
};

export const gradeVideoWithLut = async (input: {
  ffmpegPath: string; inputPath: string; lutPath: string; outputPath: string; allowedDirectory: string;
  crf?: number; timeoutMs?: number;
}): Promise<{ lutFileName: string; outputFileName: string; sizeBytes: number }> => {
  const crf = input.crf ?? 20;
  if (!Number.isInteger(crf) || crf < 0 || crf > 40) throw new Error("LUT grade settings are invalid.");
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const lut = await resolveInputFile(input.lutPath, input.allowedDirectory);
  if (extname(lut).toLowerCase() !== ".cube" || lut.includes("'")) throw new Error("LUT must be a controlled .cube file.");
  const output = await resolveOutputFile(input.outputPath, input.allowedDirectory);
  const escapedLut = lut.replaceAll("\\", "/").replace(":", "\\:");
  await runMediaProcess({
    executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs: validateTimeout(input.timeoutMs, 180_000),
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-map", "0:v:0", "-map", "0:a?", "-vf", `lut3d=file='${escapedLut}'`, "-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", output],
  });
  return { lutFileName: lut.split(/[\\/]/).at(-1) ?? "", outputFileName: output.split(/[\\/]/).at(-1) ?? "", sizeBytes: await assertOutputFile(output) };
};
