const { randomUUID } = require("node:crypto");

const { loadRepositoryEnvironment } = require("./repository-environment.cjs");

const DEFAULT_API_BASE_URL = "http://localhost:4101";
const DEFAULT_MODEL = "doubao-seedance-2.0";
const DEFAULT_PROMPT =
  "制作一个6秒的单镜头测试视频：深色背景中一束柔和光线照亮白色文字“连接测试成功”，镜头缓慢推进，画面简洁，避免额外角色。";
const PAID_CONFIRMATION = "GENERATE_PAID_VIDEO";
const TERMINAL_FAILURES = new Set(["failed", "cancelled"]);

const delay = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const parsePositiveInteger = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
};

const normalizeBaseUrl = (value) => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CONNECTIVITY_API_BASE_URL must use http or https.");
  }
  return url.toString().replace(/\/$/u, "");
};

const requestJson = async (baseUrl, path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${detail}`);
  }
  return body;
};

const assertSnapshotActive = (snapshot, label) => {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`${label} returned an invalid workflow snapshot.`);
  }
  if (TERMINAL_FAILURES.has(snapshot.status)) {
    throw new Error(
      `${label} entered ${snapshot.status}: ${snapshot.errorMessage ?? "no diagnostic was persisted"}`,
    );
  }
};

const waitForSnapshot = async ({
  baseUrl,
  workflowId,
  label,
  predicate,
  pollIntervalMs,
  timeoutMs,
}) => {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await requestJson(baseUrl, `/video-workflows/${workflowId}`);
    assertSnapshotActive(latest, label);
    if (latest.assetBatch && TERMINAL_FAILURES.has(latest.assetBatch.status)) {
      throw new Error(`${label} asset batch entered ${latest.assetBatch.status}.`);
    }
    if (predicate(latest)) return latest;
    await delay(pollIntervalMs);
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms; latest state=${latest?.status ?? "unknown"}, ` +
      `stage=${latest?.currentStage ?? "unknown"}.`,
  );
};

const waitForEventType = async (eventTypes, eventType, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (eventTypes.has(eventType)) return;
    await delay(100);
  }
  throw new Error(`SSE did not deliver ${eventType} within ${timeoutMs}ms.`);
};

const approve = (baseUrl, workflowId) =>
  requestJson(baseUrl, `/video-workflows/${workflowId}/interactions`, {
    method: "POST",
    body: JSON.stringify({ type: "approve" }),
  });

const startEventMonitor = (baseUrl, workflowId) => {
  const controller = new AbortController();
  const eventTypes = new Set();
  const done = (async () => {
    const response = await fetch(`${baseUrl}/video-workflows/${workflowId}/events`, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`SSE connection failed (${response.status}).`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventTypes.add(line.slice("event: ".length));
      }
    }
  })();
  return {
    eventTypes,
    stop: async () => {
      controller.abort();
      try {
        await done;
      } catch (error) {
        if (error?.name !== "AbortError") throw error;
      }
    },
  };
};

const assetPlanFromSnapshot = (snapshot) => {
  const artifact = snapshot?.currentArtifact?.artifact;
  if (artifact?.stage !== "assets") {
    throw new Error("The current artifact is not an assets plan.");
  }
  return artifact.data;
};

const assertPrepaidGate = (snapshot) => {
  const plan = assetPlanFromSnapshot(snapshot);
  if (snapshot.currentStage !== "assets" || snapshot.status !== "awaiting_input") {
    throw new Error("The workflow is not waiting at the assets planning approval gate.");
  }
  if (snapshot.assetBatch !== null || snapshot.videoJob !== null) {
    throw new Error("Paid work has already crossed the queue handoff boundary.");
  }
  if (!Number.isFinite(plan.totalEstimatedCostUsd) || plan.totalEstimatedCostUsd < 0) {
    throw new Error("The assets plan does not contain a valid total cost estimate.");
  }
  return plan;
};

const assertPaidBudget = (estimatedCostUsd, maximumCostUsd, confirmation) => {
  if (confirmation !== PAID_CONFIRMATION) {
    throw new Error(
      `Paid execution requires CONNECTIVITY_PAID_CONFIRM=${PAID_CONFIRMATION}.`,
    );
  }
  if (!Number.isFinite(maximumCostUsd) || maximumCostUsd <= 0) {
    throw new Error("CONNECTIVITY_MAX_COST_USD must be a positive number.");
  }
  if (estimatedCostUsd > maximumCostUsd) {
    throw new Error(
      `Estimated material cost $${estimatedCostUsd.toFixed(4)} exceeds the configured ` +
        `limit $${maximumCostUsd.toFixed(4)}. No paid approval was sent.`,
    );
  }
};

const printCostPlan = (plan) => {
  console.log("\nMaterial cost estimate (USD)");
  for (const asset of plan.assets) {
    console.log(
      `  scene ${asset.sceneOrder}: ${asset.kind}/${asset.sourceMode} ` +
        `$${asset.estimatedCostUsd.toFixed(4)}`,
    );
  }
  console.log(`  total: $${plan.totalEstimatedCostUsd.toFixed(4)}`);
  console.log("  Note: this estimate excludes text-model planning charges and infrastructure cost.\n");
};

const assertSsePlanningCoverage = (eventTypes) => {
  for (const requiredType of ["workflow.snapshot", "cinematic.artifact.completed"]) {
    if (!eventTypes.has(requiredType)) {
      throw new Error(`SSE did not deliver required event type ${requiredType}.`);
    }
  }
};

const advanceToPrepaidGate = async (configuration) => {
  const created = await requestJson(configuration.baseUrl, "/video-workflows", {
    method: "POST",
    body: JSON.stringify({
      messageId: `connectivity-${Date.now()}-${randomUUID().slice(0, 8)}`,
      prompt: configuration.prompt,
      videoModel: configuration.videoModel,
    }),
  });
  if (!created?.workflowId) throw new Error("Workflow creation returned no workflowId.");
  console.log(`workflowId=${created.workflowId}`);
  console.log(`conversationId=${created.conversationId}`);
  const monitor = startEventMonitor(configuration.baseUrl, created.workflowId);

  try {
    for (const stage of ["proposal", "script", "scene_plan"]) {
      const snapshot = await waitForSnapshot({
        ...configuration,
        workflowId: created.workflowId,
        label: `${stage} planning`,
        predicate: (candidate) =>
          candidate.status === "awaiting_input" && candidate.currentStage === stage,
      });
      console.log(`approved planning stage=${stage} version=${snapshot.currentVersion}`);
      await approve(configuration.baseUrl, created.workflowId);
    }

    const prepaidSnapshot = await waitForSnapshot({
      ...configuration,
      workflowId: created.workflowId,
      label: "assets planning",
      predicate: (candidate) =>
        candidate.status === "awaiting_input" && candidate.currentStage === "assets" &&
        candidate.currentArtifact?.artifact?.stage === "assets",
    });
    const plan = assertPrepaidGate(prepaidSnapshot);
    await delay(Math.min(configuration.pollIntervalMs, 1_000));
    assertSsePlanningCoverage(monitor.eventTypes);
    return { created, monitor, plan, prepaidSnapshot };
  } catch (error) {
    await monitor.stop();
    throw error;
  }
};

const runPrepaid = async (configuration) => {
  const result = await advanceToPrepaidGate(configuration);
  try {
    printCostPlan(result.plan);
    console.log("PASS: planning, persistence, Mastra suspension/resume, REST and SSE are connected.");
    console.log("PASS: assetBatch and videoJob are null; no paid material approval was sent.");
  } finally {
    await result.monitor.stop();
  }
};

const runPaid = async (configuration) => {
  const maximumCostUsd = Number(process.env.CONNECTIVITY_MAX_COST_USD);
  const confirmation = process.env.CONNECTIVITY_PAID_CONFIRM;
  if (confirmation !== PAID_CONFIRMATION || !Number.isFinite(maximumCostUsd) || maximumCostUsd <= 0) {
    throw new Error(
      `Set CONNECTIVITY_MAX_COST_USD and CONNECTIVITY_PAID_CONFIRM=${PAID_CONFIRMATION} ` +
        "before starting the paid test.",
    );
  }

  const result = await advanceToPrepaidGate(configuration);
  try {
    printCostPlan(result.plan);
    assertPaidBudget(result.plan.totalEstimatedCostUsd, maximumCostUsd, confirmation);
    console.log(`budget gate passed: maximum=$${maximumCostUsd.toFixed(4)}`);
    console.log("sending paid material approval");
    await approve(configuration.baseUrl, result.created.workflowId);

    const assetReview = await waitForSnapshot({
      ...configuration,
      timeoutMs: configuration.paidTimeoutMs,
      workflowId: result.created.workflowId,
      label: "paid material generation",
      predicate: (candidate) =>
        candidate.status === "awaiting_input" &&
        candidate.currentStage === "assets" &&
        candidate.assetBatch?.status === "awaiting_approval",
    });
    console.log(`generated material count=${assetReview.assetBatch.assets.length}`);
    await approve(configuration.baseUrl, result.created.workflowId);
    console.log("approved generated material; waiting for final composition");

    const completed = await waitForSnapshot({
      ...configuration,
      timeoutMs: configuration.paidTimeoutMs,
      workflowId: result.created.workflowId,
      label: "final video generation",
      predicate: (candidate) => candidate.status === "succeeded",
    });
    if (!completed.videoJob?.playbackUrl) {
      throw new Error("The workflow succeeded without a playback URL.");
    }
    await waitForEventType(result.monitor.eventTypes, "job.completed", 5_000);
    console.log(`PASS: final video=${completed.videoJob.playbackUrl}`);
  } finally {
    await result.monitor.stop();
  }
};

const main = async () => {
  loadRepositoryEnvironment({ repositoryRoot: require("node:path").resolve(__dirname, "..") });
  const mode = process.argv[2];
  if (mode !== "prepaid" && mode !== "paid") {
    throw new Error("Usage: node scripts/video-connectivity-test.cjs <prepaid|paid>");
  }
  const configuration = {
    baseUrl: normalizeBaseUrl(
      process.env.CONNECTIVITY_API_BASE_URL ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL,
    ),
    prompt: process.env.CONNECTIVITY_PROMPT?.trim() || DEFAULT_PROMPT,
    videoModel: process.env.CONNECTIVITY_VIDEO_MODEL?.trim() || DEFAULT_MODEL,
    pollIntervalMs: parsePositiveInteger("CONNECTIVITY_POLL_INTERVAL_MS", 2_000),
    timeoutMs: parsePositiveInteger("CONNECTIVITY_STAGE_TIMEOUT_MS", 10 * 60_000),
    paidTimeoutMs: parsePositiveInteger("CONNECTIVITY_PAID_TIMEOUT_MS", 90 * 60_000),
  };
  console.log(`mode=${mode} api=${configuration.baseUrl} model=${configuration.videoModel}`);
  if (mode === "prepaid") await runPrepaid(configuration);
  else await runPaid(configuration);
};

if (require.main === module) {
  void main().catch((error) => {
    console.error(`Connectivity test failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PAID_CONFIRMATION,
  assertPaidBudget,
  assertPrepaidGate,
};
