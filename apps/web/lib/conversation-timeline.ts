export type ConversationTimelineMarker = {
  createdAt: string;
  id: string;
  type: "workflow_completion";
};

export type ConversationTimelineItem<Entry> =
  | { entry: Entry; type: "entry" }
  | ConversationTimelineMarker;

export const insertConversationTimelineMarker = <Entry extends { createdAt: string }>(
  entries: Entry[],
  marker: ConversationTimelineMarker | null,
): ConversationTimelineItem<Entry>[] => {
  const timeline: ConversationTimelineItem<Entry>[] = entries.map((entry) => ({
    entry,
    type: "entry",
  }));
  if (!marker) return timeline;

  const markerTimestampMs = Date.parse(marker.createdAt);
  const insertionIndex = Number.isFinite(markerTimestampMs)
    ? entries.findIndex((entry) => {
        const entryTimestampMs = Date.parse(entry.createdAt);
        return Number.isFinite(entryTimestampMs) && entryTimestampMs > markerTimestampMs;
      })
    : -1;
  timeline.splice(insertionIndex < 0 ? timeline.length : insertionIndex, 0, marker);
  return timeline;
};
