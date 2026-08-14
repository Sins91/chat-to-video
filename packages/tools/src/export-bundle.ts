import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { createOutputDirectory, inputFile } from "./runtime.js";

export type ExportChapter = { startSeconds: number; title: string };
const chapterTime = (seconds: number): string => {
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
};

export const exportBundle = async (input: {
  videoPath: string; exportDirectory: string; allowedDirectory: string; title: string;
  description?: string; tags?: readonly string[]; hashtags?: readonly string[]; chapters?: readonly ExportChapter[];
  subtitlesPath?: string; thumbnailPath?: string; thumbnailConcept?: unknown;
  platform?: string; visibility?: "public" | "private" | "unlisted"; timestamp?: string;
}) => {
  const title = input.title.trim();
  if (!title || title.length > 300 || (input.tags?.length ?? 0) > 100 || (input.hashtags?.length ?? 0) > 100 || (input.chapters?.length ?? 0) > 100) throw new Error("Export bundle metadata is invalid.");
  const video = await inputFile(input.videoPath, input.allowedDirectory);
  const subtitles = input.subtitlesPath ? await inputFile(input.subtitlesPath, input.allowedDirectory) : null;
  const thumbnail = input.thumbnailPath ? await inputFile(input.thumbnailPath, input.allowedDirectory) : null;
  const root = await createOutputDirectory(input.exportDirectory, input.allowedDirectory);
  const videoDirectory = join(root, "video");
  const metadataDirectory = join(root, "metadata");
  const thumbnailDirectory = join(root, "thumbnails");
  await Promise.all([
    mkdir(videoDirectory, { recursive: true }),
    mkdir(metadataDirectory, { recursive: true }),
    mkdir(thumbnailDirectory, { recursive: true }),
  ]);
  const files: string[] = [];
  const videoOutput = join(videoDirectory, `output${extname(video) || ".mp4"}`);
  await copyFile(video, videoOutput); files.push(`video/${basename(videoOutput)}`);
  if (subtitles) { const target = join(videoDirectory, `subtitles${extname(subtitles) || ".srt"}`); await copyFile(subtitles, target); files.push(`video/${basename(target)}`); }
  const chapters = input.chapters ?? [];
  for (const chapter of chapters) if (!Number.isFinite(chapter.startSeconds) || chapter.startSeconds < 0 || !chapter.title.trim() || chapter.title.length > 200) throw new Error("Export chapter is invalid.");
  const chapterLines = chapters.map((chapter) => `${chapterTime(chapter.startSeconds)} - ${chapter.title.trim()}`);
  const metadata = { title, description: input.description ?? "", tags: input.tags ?? [], hashtags: input.hashtags ?? [], chapters };
  await writeFile(join(metadataDirectory, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8"); files.push("metadata/metadata.json");
  const description = [input.description?.trim(), chapterLines.join("\n")].filter(Boolean).join("\n\n");
  await writeFile(join(metadataDirectory, "description.txt"), description ? `${description}\n` : "", "utf8"); files.push("metadata/description.txt");
  if (input.tags?.length) { await writeFile(join(metadataDirectory, "tags.txt"), `${input.tags.join("\n")}\n`, "utf8"); files.push("metadata/tags.txt"); }
  if (chapterLines.length) { await writeFile(join(metadataDirectory, "chapters.txt"), `${chapterLines.join("\n")}\n`, "utf8"); files.push("metadata/chapters.txt"); }
  if (thumbnail) { const target = join(thumbnailDirectory, `thumbnail${extname(thumbnail) || ".png"}`); await copyFile(thumbnail, target); files.push(`thumbnails/${basename(target)}`); }
  else if (input.thumbnailConcept !== undefined) { await writeFile(join(thumbnailDirectory, "concept.json"), JSON.stringify(input.thumbnailConcept, null, 2), "utf8"); files.push("thumbnails/concept.json"); }
  const timestamp = input.timestamp ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("Export timestamp is invalid.");
  const publishLog = { version: "1.0", entries: [{ platform: input.platform?.trim() || "local", status: "exported" as const, timestamp, visibility: input.visibility ?? null, metadataUsed: { title, description: input.description ?? "", hashtags: input.hashtags ?? [], chapters } }] };
  await writeFile(join(metadataDirectory, "publish-log.json"), JSON.stringify(publishLog, null, 2), "utf8"); files.push("metadata/publish-log.json");
  return { exportDirectoryName: root.split(/[\\/]/u).at(-1) ?? "", filesWritten: files, publishLog };
};
