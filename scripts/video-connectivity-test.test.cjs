const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const test = require("node:test");

const {
  MAX_REFERENCE_IMAGE_BYTES,
  TEXT_COMPLETION_RESERVE_USD,
  assertConsistencyReferenceArtifact,
  assertGeneratedImagePricingSafe,
  assertImageBindings,
  assertPlanningGate,
  assertReferenceAnalysis,
  assertSnapshotActive,
  assertSuppliedReferenceBatch,
  assertTotalBudget,
  calculateLiveMediaEstimate,
  detectImageMime,
  normalizeBaseUrl,
  normalizeMode,
  parseSseFrame,
  redactSecrets,
  requestJson,
  validateImageInput,
} = require("./video-connectivity-test.cjs");

const REFERENCE_ID = "00000000-0000-4000-8000-000000000001";
const REFERENCE_ASSET_ID = `uploaded-ref-${REFERENCE_ID}`;
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const WEBP_HEADER = Buffer.from("RIFF0000WEBP", "ascii");

const pricing = () => ({
  videoRates: {
    "480P": 0.0825,
    "480P-input": 0.05,
    "720P": 0.1775,
    "720P-input": 0.1073,
    "1080P": 0.443,
    "1080P-input": 0.2696,
  },
  musicPerGeneration: 0.075,
  image2kPerGeneration: 0.073125,
});

const assetPlan = (assets = [{
  sceneOrder: 1,
  kind: "video",
  sourceMode: "generate",
  estimatedCostUsd: 0.71,
}], totalEstimatedCostUsd = 0.785) => ({
  assets,
  music: { sourceMode: "generate", direction: "test" },
  totalEstimatedCostUsd,
});

const planningSnapshot = () => ({
  status: "awaiting_input",
  currentStage: "assets",
  currentArtifact: { artifact: { stage: "assets", data: assetPlan() } },
  assetBatch: null,
  videoJob: null,
});

const referenceAnalysis = (overrides = {}) => ({
  id: REFERENCE_ID,
  analysis: {
    referenceImageId: REFERENCE_ID,
    visibleFeatures: ["white ceramic body"],
    consistencyRequirements: ["preserve shape"],
    confidence: 0.98,
    containsRealPerson: false,
    containsSensitiveContent: false,
    ...overrides.analysis,
  },
  resolution: {
    status: "user_resolved",
    effectivePurpose: "product",
    effectiveLabel: "连通性测试产品",
    ...overrides.resolution,
  },
});

const capabilityResolution = () => ({
  adapterId: "storage.validated-reference-image",
});

const withHttpServer = async (handler, run) => {
  const server = createServer(handler);
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Mock server has no TCP address.");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolvePromise, rejectPromise) => server.close((error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    }));
  }
};

test("mode aliases preserve prepaid compatibility and default to preflight", () => {
  assert.equal(normalizeMode(), "preflight");
  assert.equal(normalizeMode("prepaid"), "planning");
  assert.equal(normalizeMode("image:paid"), "image:paid");
  assert.throws(() => normalizeMode("legacy"), /Usage:/u);
});

test("API base URL accepts HTTP(S), removes one trailing slash, and rejects other schemes", () => {
  assert.equal(normalizeBaseUrl("http://localhost:4101/"), "http://localhost:4101");
  assert.equal(normalizeBaseUrl("https://example.com/"), "https://example.com");
  assert.throws(() => normalizeBaseUrl("file:///tmp/api"), /must use http or https/u);
});

test("image magic detection recognizes JPEG, PNG and WebP", () => {
  assert.equal(detectImageMime(PNG_HEADER), "image/png");
  assert.equal(detectImageMime(JPEG_HEADER), "image/jpeg");
  assert.equal(detectImageMime(WEBP_HEADER), "image/webp");
  assert.equal(detectImageMime(Buffer.from("not-an-image")), null);
});

test("image input enforces size, supported binary type and extension agreement", () => {
  assert.deepEqual(validateImageInput("fixture.png", PNG_HEADER), {
    mimeType: "image/png",
    sizeBytes: PNG_HEADER.length,
  });
  assert.throws(() => validateImageInput("fixture.jpg", PNG_HEADER), /does not match/u);
  assert.throws(() => validateImageInput("fixture.png", Buffer.alloc(0)), /cannot be empty/u);
  assert.throws(
    () => validateImageInput("fixture.png", Buffer.alloc(MAX_REFERENCE_IMAGE_BYTES + 1)),
    /exceeds the 10 MiB/u,
  );
  assert.throws(
    () => validateImageInput("fixture.png", Buffer.from("broken")),
    /not a valid JPEG, PNG or WebP/u,
  );
});

test("planning gate rejects snapshots after an asset queue handoff", () => {
  assert.equal(assertPlanningGate(planningSnapshot()).totalEstimatedCostUsd, 0.785);
  assert.throws(
    () => assertPlanningGate({ ...planningSnapshot(), assetBatch: { status: "queued" } }),
    /already crossed the queue handoff boundary/u,
  );
});

test("terminal workflow and batch states fail with persisted diagnostics", () => {
  assert.throws(
    () => assertSnapshotActive({ status: "failed", errorMessage: "provider failed" }, "workflow"),
    /provider failed/u,
  );
  assert.throws(() => assertSnapshotActive({
    status: "awaiting_input",
    consistencyReferenceBatch: { status: "cancelled" },
    assetBatch: null,
  }, "workflow"), /consistency reference batch entered cancelled/u);
  assert.throws(() => assertSnapshotActive({
    status: "awaiting_input",
    consistencyReferenceBatch: null,
    assetBatch: { status: "failed" },
  }, "workflow"), /asset batch entered failed/u);
});

test("total budget accepts the exact boundary and rejects the smallest overage", () => {
  const exact = assertTotalBudget({
    spentUsd: 0.1,
    runtimeMediaUsd: 0.785,
    liveMediaUsd: 0.405,
    maximumUsd: 0.935,
    reserveUsd: TEXT_COMPLETION_RESERVE_USD,
  });
  assert.equal(exact.guardedTotal, 0.935);
  assert.throws(() => assertTotalBudget({
    spentUsd: 0.100001,
    runtimeMediaUsd: 0.785,
    liveMediaUsd: 0.405,
    maximumUsd: 0.935,
    reserveUsd: TEXT_COMPLETION_RESERVE_USD,
  }), /exceeds configured limit/u);
  for (const maximumUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => assertTotalBudget({
      spentUsd: 0,
      runtimeMediaUsd: 0,
      liveMediaUsd: 0,
      maximumUsd,
      reserveUsd: 0,
    }), /positive finite number/u);
  }
});

test("live cost uses 480P text-to-video rate for the single-shot smoke case", () => {
  assert.deepEqual(calculateLiveMediaEstimate(assetPlan(), pricing(), false), {
    generatedSeconds: 4,
    generatedImageCount: 0,
    resolutionProfile: "480P",
    amountUsd: 0.405,
  });
});

test("live cost uses the input profile for two image-conditioned clips", () => {
  const plan = assetPlan([
    { sceneOrder: 1, kind: "video", sourceMode: "generate", estimatedCostUsd: 0.71 },
    { sceneOrder: 2, kind: "video", sourceMode: "generate", estimatedCostUsd: 0.71 },
  ], 1.495);
  assert.deepEqual(calculateLiveMediaEstimate(plan, pricing(), true), {
    generatedSeconds: 8,
    generatedImageCount: 0,
    resolutionProfile: "480P-input",
    amountUsd: 0.475,
  });
});

test("live cost follows the selected generation resolution", () => {
  assert.equal(calculateLiveMediaEstimate(assetPlan(), pricing(), false, "720p").amountUsd, 0.785);
  assert.equal(calculateLiveMediaEstimate(assetPlan(), pricing(), false, "1080p").amountUsd, 1.847);
  assert.equal(calculateLiveMediaEstimate(assetPlan(), pricing(), true, "4k").amountUsd, 1.1534);
});

test("live cost refuses an asset price that cannot map to reviewed generated seconds", () => {
  const plan = assetPlan([
    { sceneOrder: 1, kind: "video", sourceMode: "generate", estimatedCostUsd: 0.2 },
  ], 0.275);
  assert.throws(
    () => calculateLiveMediaEstimate(plan, pricing(), false),
    /Cannot infer generated seconds/u,
  );
});

test("paid execution fails closed when generated-image runtime pricing is stale", () => {
  const plan = assetPlan([
    { sceneOrder: 1, kind: "image", sourceMode: "generate", estimatedCostUsd: 0.0366 },
  ], 0.1116);
  assert.throws(
    () => assertGeneratedImagePricingSafe(plan, pricing()),
    /below live 2K price/u,
  );
});

test("reference analysis requires usable features and preserves the upload declaration", () => {
  const declaration = { purpose: "product", label: "连通性测试产品" };
  assert.equal(assertReferenceAnalysis(referenceAnalysis(), declaration).confidence, 0.98);
  assert.throws(
    () => assertReferenceAnalysis(referenceAnalysis({
      analysis: { visibleFeatures: [] },
    }), declaration),
    /did not produce usable visual constraints/u,
  );
  assert.throws(
    () => assertReferenceAnalysis(referenceAnalysis({
      resolution: { status: "needs_clarification" },
    }), declaration),
    /needs clarification/u,
  );
  assert.throws(
    () => assertReferenceAnalysis(referenceAnalysis({
      analysis: { containsSensitiveContent: true },
    }), declaration),
    /blocked sensitive content/u,
  );
  assert.throws(
    () => assertReferenceAnalysis(referenceAnalysis({
      analysis: { containsRealPerson: true },
    }), declaration, true),
    /does not accept real-person/u,
  );
});

test("consistency-reference artifact must map the uploaded image at zero Seedream cost", () => {
  const snapshot = {
    currentArtifact: {
      artifact: {
        stage: "consistency_reference",
        data: {
          status: "required",
          groups: [{
            sourceReferenceImageIds: [REFERENCE_ID],
            estimatedCostUsd: 0,
          }],
        },
      },
    },
  };
  assert.equal(
    assertConsistencyReferenceArtifact(snapshot, REFERENCE_ID).groups.length,
    1,
  );
  snapshot.currentArtifact.artifact.data.groups[0].estimatedCostUsd = 0.0366;
  assert.throws(
    () => assertConsistencyReferenceArtifact(snapshot, REFERENCE_ID),
    /must not carry Seedream/u,
  );
});

test("supplied reference batch must reuse the uploaded asset through the local adapter", () => {
  const batch = {
    stageId: "consistency_reference",
    status: "awaiting_approval",
    assets: [{
      assetId: REFERENCE_ASSET_ID,
      capabilityResolution: capabilityResolution(),
    }],
  };
  assert.equal(assertSuppliedReferenceBatch(batch, REFERENCE_ID), REFERENCE_ASSET_ID);
  batch.assets[0].capabilityResolution.adapterId = "apimart.seedream";
  assert.throws(
    () => assertSuppliedReferenceBatch(batch, REFERENCE_ID),
    /unexpected capability adapter/u,
  );
});

test("image-conditioned asset review requires an approved reference binding", () => {
  const batch = {
    stageId: "assets",
    status: "awaiting_approval",
    assets: [{
      kind: "video",
      referenceBindings: [{ assetId: REFERENCE_ASSET_ID, approvalStatus: "approved" }],
    }],
  };
  assert.doesNotThrow(() => assertImageBindings(batch, REFERENCE_ASSET_ID));
  batch.assets[0].referenceBindings = [];
  assert.throws(() => assertImageBindings(batch, REFERENCE_ASSET_ID), /did not preserve/u);
});

test("SSE parser handles event IDs and multi-line JSON data", () => {
  const parsed = parseSseFrame(
    "id: 12\nevent: job.progress\ndata: {\"sequence\":12,\ndata: \"type\":\"job.progress\"}",
  );
  assert.equal(parsed.id, "12");
  assert.equal(parsed.event, "job.progress");
  assert.deepEqual(parsed.data, { sequence: 12, type: "job.progress" });
});

test("diagnostics redact bearer tokens, signed query strings and object keys", () => {
  const output = redactSecrets(
    "Bearer secret-token https://storage.example/a.png?signature=secret " +
    "tenant/demo/project/demo/source/id/reference.png",
  );
  assert.doesNotMatch(output, /secret-token|signature=secret|tenant\/demo/u);
  assert.match(output, /Bearer \[redacted\]|\?\[redacted\]|\[object-key\]/u);
});

test("HTTP helper rejects 429, 5xx and non-JSON responses without leaking signed URLs", async () => {
  await withHttpServer((request, response) => {
    if (request.url === "/rate") {
      response.writeHead(429, { "content-type": "application/json" });
      response.end(JSON.stringify({
        message: "retry https://storage.example/file.png?signature=secret",
      }));
      return;
    }
    if (request.url === "/failure") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "UPSTREAM_UNAVAILABLE" }));
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("not-json");
  }, async (baseUrl) => {
    await assert.rejects(
      requestJson(baseUrl, "/rate"),
      (error) => error.message.includes("429") && !error.message.includes("signature=secret"),
    );
    await assert.rejects(requestJson(baseUrl, "/failure"), /503/u);
    await assert.rejects(requestJson(baseUrl, "/plain"), /returned non-JSON/u);
  });
});

test("HTTP helper aborts a stalled response at the configured timeout", async () => {
  await withHttpServer((_request, response) => {
    setTimeout(() => response.end("{}"), 250);
  }, async (baseUrl) => {
    await assert.rejects(requestJson(baseUrl, "/slow", {}, 20), /timeout|aborted/iu);
  });
});
