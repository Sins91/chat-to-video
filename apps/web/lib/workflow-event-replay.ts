export const isWorkflowEventHistoricalReplay = (
  eventTimestamp: string,
  initialSnapshotTimestampMs: number | null,
): boolean => {
  if (initialSnapshotTimestampMs === null) return false;
  const eventTimestampMs = Date.parse(eventTimestamp);
  return Number.isFinite(eventTimestampMs) && eventTimestampMs <= initialSnapshotTimestampMs;
};
