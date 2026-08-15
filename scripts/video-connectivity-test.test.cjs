const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PAID_CONFIRMATION,
  assertPaidBudget,
  assertPrepaidGate,
} = require("./video-connectivity-test.cjs");

const prepaidSnapshot = () => ({
  status: "awaiting_input",
  currentStage: "assets",
  currentArtifact: {
    artifact: {
      stage: "assets",
      data: {
        assets: [
          {
            sceneOrder: 1,
            kind: "video",
            sourceMode: "generate",
            estimatedCostUsd: 0.2,
          },
        ],
        totalEstimatedCostUsd: 0.2,
      },
    },
  },
  assetBatch: null,
  videoJob: null,
});

test("prepaid gate rejects a snapshot after material queue handoff", () => {
  assert.equal(assertPrepaidGate(prepaidSnapshot()).totalEstimatedCostUsd, 0.2);
  assert.throws(
    () => assertPrepaidGate({ ...prepaidSnapshot(), assetBatch: { status: "queued" } }),
    /already crossed the queue handoff boundary/u,
  );
});

test("paid budget requires both confirmation and sufficient budget", () => {
  assert.doesNotThrow(() => assertPaidBudget(0.2, 0.25, PAID_CONFIRMATION));
  assert.throws(() => assertPaidBudget(0.2, 0.25, "yes"), /requires CONNECTIVITY_PAID_CONFIRM/u);
  assert.throws(() => assertPaidBudget(0.2, 0.1, PAID_CONFIRMATION), /exceeds the configured limit/u);
});
