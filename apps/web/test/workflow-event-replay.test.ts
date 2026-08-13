import { describe, expect, it } from "vitest";

import { isWorkflowEventHistoricalReplay } from "@/lib/workflow-event-replay";

describe("workflow event replay filtering", () => {
  const snapshotTimestampMs = Date.parse("2026-08-12T10:00:00.000Z");

  it("filters progress events already represented by the initial snapshot", () => {
    expect(isWorkflowEventHistoricalReplay("2026-08-12T09:59:59.999Z", snapshotTimestampMs)).toBe(true);
    expect(isWorkflowEventHistoricalReplay("2026-08-12T10:00:00.000Z", snapshotTimestampMs)).toBe(true);
  });

  it("keeps events created after the initial snapshot", () => {
    expect(isWorkflowEventHistoricalReplay("2026-08-12T10:00:00.001Z", snapshotTimestampMs)).toBe(false);
  });

  it("does not discard events before a replay boundary is known", () => {
    expect(isWorkflowEventHistoricalReplay("2026-08-12T09:59:59.999Z", null)).toBe(false);
  });
});
