import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { assertHttpUrl, outputFile } from "./runtime.js";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === "object" && value !== null && !Array.isArray(value);
const numberValue = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const identifier = (value: unknown): string => typeof value === "string" || typeof value === "number" ? String(value) : "";

const downloadAudio = async (input: { url: string; outputPath: string; allowedDirectory: string; allowedHosts: readonly string[]; fetchImpl: typeof fetch; headers?: Record<string, string> }): Promise<number> => {
  const url = assertHttpUrl(input.url, input.allowedHosts);
  const output = await outputFile(input.outputPath, input.allowedDirectory);
  const response = await input.fetchImpl(url, { headers: input.headers, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Music download failed with status ${response.status}.`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const announcedSize = Number(response.headers.get("content-length") ?? "0");
  if (!contentType.startsWith("audio/") || announcedSize > 50 * 1024 * 1024) throw new Error("Music download returned invalid media metadata.");
  const body = new Uint8Array(await response.arrayBuffer());
  if (!body.byteLength || body.byteLength > 50 * 1024 * 1024) throw new Error("Music download size is invalid.");
  await writeFile(output, body);
  return body.byteLength;
};

export const fetchFreesoundMusic = async (input: {
  apiKey: string; query: string; outputPath: string; allowedDirectory: string;
  minDurationSeconds?: number; maxDurationSeconds?: number; fetchImpl?: typeof fetch;
}) => {
  const query = input.query.trim();
  const minimum = input.minDurationSeconds ?? 30;
  const maximum = input.maxDurationSeconds ?? 120;
  if (!input.apiKey.trim() || !query || query.length > 300 || !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 1 || maximum < minimum || maximum > 600) throw new Error("Freesound input is invalid.");
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL("https://freesound.org/apiv2/search/text/");
  url.searchParams.set("query", query); url.searchParams.set("filter", `duration:[${minimum} TO ${maximum}]`); url.searchParams.set("sort", "rating_desc");
  url.searchParams.set("fields", "id,name,duration,previews,tags,avg_rating,username,license"); url.searchParams.set("page_size", "15");
  const response = await fetchImpl(url, { headers: { Authorization: `Token ${input.apiKey}`, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Freesound search failed with status ${response.status}.`);
  const raw = await response.json() as unknown;
  if (!record(raw) || !Array.isArray(raw.results)) throw new Error("Freesound returned an invalid response.");
  const sound = raw.results.filter(record).find((item) => record(item.previews) && (typeof item.previews["preview-hq-mp3"] === "string" || typeof item.previews["preview-lq-mp3"] === "string"));
  if (!record(sound) || !record(sound.previews)) throw new Error("Freesound returned no downloadable result.");
  const preview = typeof sound.previews["preview-hq-mp3"] === "string" ? sound.previews["preview-hq-mp3"] : String(sound.previews["preview-lq-mp3"]);
  const sizeBytes = await downloadAudio({ url: preview, outputPath: input.outputPath, allowedDirectory: input.allowedDirectory, allowedHosts: ["freesound.org", "fsbcdn.net"], fetchImpl });
  return { provider: "freesound" as const, id: identifier(sound.id), title: typeof sound.name === "string" ? sound.name : "Unknown", durationSeconds: numberValue(sound.duration), license: typeof sound.license === "string" ? sound.license : null, outputFileName: basename(input.outputPath), sizeBytes };
};

export const fetchPixabayMusic = async (input: {
  query: string; outputPath: string; allowedDirectory: string;
  minDurationSeconds?: number; maxDurationSeconds?: number; fetchImpl?: typeof fetch;
}) => {
  const query = input.query.trim();
  const minimum = input.minDurationSeconds ?? 30;
  const maximum = input.maxDurationSeconds ?? 120;
  if (!query || query.length > 300 || !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 1 || maximum < minimum || maximum > 600) throw new Error("Pixabay music input is invalid.");
  const fetchImpl = input.fetchImpl ?? fetch;
  const slug = encodeURIComponent(query.toLowerCase().replace(/\s+/gu, "-"));
  const pageUrl = `https://pixabay.com/music/search/${slug}/`;
  const page = await fetchImpl(pageUrl, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
  if (!page.ok) throw new Error(`Pixabay music search failed with status ${page.status}.`);
  const html = await page.text();
  const bootstrapPath = html.match(/window\.__BOOTSTRAP_URL__\s*=\s*["']([^"']+)["']/u)?.[1];
  if (!bootstrapPath || !bootstrapPath.startsWith("/")) throw new Error("Pixabay music bootstrap endpoint was not found.");
  const bootstrapUrl = new URL(bootstrapPath, "https://pixabay.com");
  const response = await fetchImpl(bootstrapUrl, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", Referer: pageUrl }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Pixabay music bootstrap failed with status ${response.status}.`);
  const raw = await response.json() as unknown;
  if (!record(raw) || !record(raw.page) || !Array.isArray(raw.page.results)) throw new Error("Pixabay music returned an invalid response.");
  const tracks = raw.page.results.filter(record).filter((item) => {
    const duration = numberValue(item.duration);
    return record(item.sources) && typeof item.sources.src === "string" && duration !== null && duration >= minimum && duration <= maximum;
  });
  const track = tracks.at(0);
  if (!track || !record(track.sources) || typeof track.sources.src !== "string") throw new Error("Pixabay music returned no matching track.");
  const sizeBytes = await downloadAudio({ url: track.sources.src, outputPath: input.outputPath, allowedDirectory: input.allowedDirectory, allowedHosts: ["pixabay.com", "cdn.pixabay.com"], fetchImpl, headers: { Referer: "https://pixabay.com/music/", "User-Agent": "Mozilla/5.0" } });
  return { provider: "pixabay_music" as const, id: identifier(track.id), title: typeof track.name === "string" ? track.name : "Unknown", durationSeconds: numberValue(track.duration), license: "Pixabay Content License", outputFileName: basename(input.outputPath), sizeBytes };
};
