export type SubtitleWord = { word: string; startSeconds: number; endSeconds: number };
export type SubtitleSegment = {
  text?: string;
  startSeconds: number;
  endSeconds: number;
  words?: readonly SubtitleWord[];
};
export type SubtitleFormat = "srt" | "vtt" | "json";
export type SubtitleHighlightStyle = "none" | "word_by_word" | "karaoke";
type Cue = { index: number; startSeconds: number; endSeconds: number; text: string; words: SubtitleWord[] };

const timestamp = (seconds: number, separator: "," | "."): string => {
  const total = Math.round(Math.max(0, seconds) * 1_000);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const secs = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
};

const validateWords = (segments: readonly SubtitleSegment[]): SubtitleWord[] => {
  if (segments.length > 10_000) throw new Error("Subtitle segment count exceeds the safety limit.");
  const words: SubtitleWord[] = [];
  for (const segment of segments) {
    if (!Number.isFinite(segment.startSeconds) || !Number.isFinite(segment.endSeconds) || segment.startSeconds < 0 || segment.endSeconds <= segment.startSeconds) {
      throw new Error("Subtitle segment timing is invalid.");
    }
    const source = segment.words?.length
      ? segment.words
      : [{ word: segment.text ?? "", startSeconds: segment.startSeconds, endSeconds: segment.endSeconds }];
    for (const item of source) {
      const word = item.word.trim();
      if (!word || word.length > 2_000 || !Number.isFinite(item.startSeconds) || !Number.isFinite(item.endSeconds) || item.startSeconds < 0 || item.endSeconds <= item.startSeconds) {
        throw new Error("Subtitle word is invalid.");
      }
      words.push({ word, startSeconds: item.startSeconds, endSeconds: item.endSeconds });
    }
  }
  for (let index = 1; index < words.length; index += 1) {
    const current = words.at(index);
    const previous = words.at(index - 1);
    if (current && previous && current.startSeconds < previous.startSeconds) throw new Error("Subtitle words must be time ordered.");
  }
  return words;
};

const buildCues = (words: readonly SubtitleWord[], maxWords: number, maxChars: number): Cue[] => {
  const cues: Cue[] = [];
  let buffer: SubtitleWord[] = [];
  const flush = () => {
    const first = buffer.at(0);
    const last = buffer.at(-1);
    if (!first || !last) return;
    cues.push({ index: cues.length + 1, startSeconds: first.startSeconds, endSeconds: last.endSeconds, text: buffer.map((item) => item.word).join(" "), words: buffer });
    buffer = [];
  };
  for (const word of words) {
    const candidate = [...buffer, word].map((item) => item.word).join(" ");
    if (buffer.length && (buffer.length >= maxWords || candidate.length > maxChars)) flush();
    buffer.push(word);
  }
  flush();
  return cues;
};

export const generateSubtitles = (input: {
  segments: readonly SubtitleSegment[];
  format?: SubtitleFormat;
  maxWordsPerCue?: number;
  maxCharsPerLine?: number;
  highlightStyle?: SubtitleHighlightStyle;
}): { format: SubtitleFormat; cueCount: number; content: string } => {
  const format = input.format ?? "srt";
  const style = input.highlightStyle ?? "none";
  const maxWords = input.maxWordsPerCue ?? 8;
  const maxChars = input.maxCharsPerLine ?? 42;
  if (!Number.isInteger(maxWords) || maxWords < 1 || maxWords > 50 || !Number.isInteger(maxChars) || maxChars < 1 || maxChars > 500) {
    throw new Error("Subtitle cue limits are invalid.");
  }
  const cues = buildCues(validateWords(input.segments), maxWords, maxChars);
  if (format === "json") return { format, cueCount: cues.length, content: JSON.stringify({ cues, highlightStyle: style }, null, 2) };
  const lines: string[] = format === "vtt" ? ["WEBVTT", ""] : [];
  let emitted = 0;
  const append = (start: number, end: number, text: string) => {
    emitted += 1;
    if (format === "srt") lines.push(String(emitted));
    lines.push(`${timestamp(start, format === "srt" ? "," : ".")} --> ${timestamp(end, format === "srt" ? "," : ".")}`, text, "");
  };
  for (const cue of cues) {
    if (style === "none") append(cue.startSeconds, cue.endSeconds, cue.text);
    else for (const [index, word] of cue.words.entries()) {
      const text = style === "word_by_word" ? word.word : cue.words.map((item, wordIndex) => wordIndex === index ? `<b>${item.word}</b>` : item.word).join(" ");
      append(word.startSeconds, word.endSeconds, text);
    }
  }
  return { format, cueCount: emitted, content: lines.join("\n") };
};
