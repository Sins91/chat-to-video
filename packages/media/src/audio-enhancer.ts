import { assertOutputFile, resolveInputFile, resolveOutputFile, runMediaProcess, validateExecutable, validateTimeout } from "./media-tool-runtime.js";

export const AUDIO_ENHANCEMENT_PRESETS = {
  clean_speech: "highpass=f=80,lowpass=f=13000,agate=threshold=0.01:ratio=2:attack=5:release=50,acompressor=threshold=-20dB:ratio=3:attack=5:release=100,loudnorm=I=-16:LRA=11:TP=-1.5",
  noise_reduce: "afftdn=nf=-25:nt=w,highpass=f=100,loudnorm=I=-16:LRA=11:TP=-1.5",
  normalize_only: "loudnorm=I=-16:LRA=11:TP=-1.5",
  podcast: "highpass=f=80,acompressor=threshold=-18dB:ratio=4:attack=5:release=100:makeup=2,loudnorm=I=-16:LRA=7:TP=-1.5",
  broadcast: "highpass=f=80,lowpass=f=15000,acompressor=threshold=-24dB:ratio=4:attack=5:release=80:makeup=3,alimiter=limit=0.95:attack=1:release=10,loudnorm=I=-24:LRA=7:TP=-2",
  voice_clarity: "highpass=f=80,equalizer=f=200:t=q:w=1.5:g=-3,equalizer=f=3000:t=q:w=1.0:g=3,equalizer=f=5000:t=q:w=1.5:g=2,acompressor=threshold=-20dB:ratio=2.5:attack=10:release=100,loudnorm=I=-16:LRA=11:TP=-1.5",
} as const;
export type AudioEnhancementPreset = keyof typeof AUDIO_ENHANCEMENT_PRESETS;

export const enhanceAudio = async (input: {
  ffmpegPath: string; inputPath: string; outputPath: string; allowedDirectory: string;
  preset?: AudioEnhancementPreset; audioBitRateKbps?: number; timeoutMs?: number;
}): Promise<{ preset: AudioEnhancementPreset; outputFileName: string; sizeBytes: number }> => {
  const preset = input.preset ?? "clean_speech";
  const bitRate = input.audioBitRateKbps ?? 192;
  if (!(preset in AUDIO_ENHANCEMENT_PRESETS) || !Number.isInteger(bitRate) || bitRate < 64 || bitRate > 320) throw new Error("Audio enhancement settings are invalid.");
  const source = await resolveInputFile(input.inputPath, input.allowedDirectory);
  const output = await resolveOutputFile(input.outputPath, input.allowedDirectory);
  await runMediaProcess({
    executablePath: validateExecutable(input.ffmpegPath, "FFmpeg"), executableLabel: "FFmpeg", timeoutMs: validateTimeout(input.timeoutMs, 120_000),
    args: ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-map", "0:a:0", "-af", AUDIO_ENHANCEMENT_PRESETS[preset], "-c:a", "aac", "-b:a", `${bitRate}k`, output],
  });
  return { preset, outputFileName: output.split(/[\\/]/).at(-1) ?? "", sizeBytes: await assertOutputFile(output) };
};
