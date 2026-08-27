const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { extname, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const { loadRepositoryEnvironment } = require("./repository-environment.cjs");

const REPOSITORY_ROOT = resolve(__dirname, "..");
const CONTRACTS_ENTRY = resolve(REPOSITORY_ROOT, "packages/contracts/dist/index.js");
const API_TEMPLATE_REGISTRY_ENTRY = resolve(
  REPOSITORY_ROOT,
  "apps/api/dist/src/agent-extensions/cinematic-skill-template.registry.js",
);
const DEFAULT_API_BASE_URL = "http://localhost:4101";
const DEFAULT_MODEL = "doubao-seedance-2.0";
const DEFAULT_PROMPT =
  "制作一个总时长4秒、480p、16:9的单镜头连通性测试视频：白色陶瓷球在中国现代摄影棚的浅灰桌面上从左向右平稳滚动，固定中景机位，柔和顶光，一个连续动作链，不切镜，不出现人物、品牌、文字或Logo；保留轻微真实环境声，并搭配极轻的抽象电子氛围配乐。";
const DEFAULT_IMAGE_PROMPT =
  "制作一个总时长4秒、480p、16:9的两镜头产品连通性测试短片。参考上传图片中的产品必须在两个镜头保持形态、材质、颜色和标识一致。镜头1持续2秒，固定中景展示产品缓慢转向光源；镜头2持续2秒，切到近景展示表面材质与反光。每个镜头只有一个连续动作链，不出现人物或新增文字；保留轻微真实环境声，并搭配极轻的抽象电子氛围配乐。";
const PAID_CONFIRMATION = "GENERATE_PAID_VIDEO";
const PLANNING_CONFIRMATION = "CALL_TEXT_MODELS";
const TEXT_COMPLETION_RESERVE_USD = 0.05;
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const REVIEWED_VIDEO_RATE_USD = 0.1775;
const PRICING_URLS = Object.freeze({
  chat: "https://api.apimart.ai/api/pricing/model?model=gpt-5-mini",
  video: "https://api.apimart.ai/api/pricing/model?model=doubao-seedance-2.0",
  music: "https://api.apimart.ai/api/pricing/model?model=flowmusic",
  image: "https://api.apimart.ai/api/pricing/model?model=doubao-seedream-5-0-pro",
});
const TERMINAL_FAILURES = new Set(["failed", "cancelled"]);
const IMAGE_PURPOSES = new Set(["character", "product", "environment", "element", "style"]);

const delay = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const redactSecrets = (value) => String(value)
  .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/giu, "Bearer [redacted]")
  .replace(/https?:\/\/[^\s"']+\?[^\s"']+/giu, (url) => `${url.split("?")[0]}?[redacted]`)
  .replace(/tenant\/[^\s"']+\/(?:source|derived|render|temp)\/[^\s"']+/giu, "[object-key]")
  .slice(0, 1_000);

const parsePositiveInteger = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
};

const parseOptionalPositiveNumber = (name, legacyName) => {
  const raw = process.env[name] ?? (legacyName ? process.env[legacyName] : undefined);
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
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

const normalizeMode = (value) => {
  const aliases = new Map([
    [undefined, "preflight"],
    ["preflight", "preflight"],
    ["planning", "planning"],
    ["prepaid", "planning"],
    ["paid", "paid"],
    ["image:upload", "image:upload"],
    ["image:planning", "image:planning"],
    ["image:paid", "image:paid"],
  ]);
  const mode = aliases.get(value);
  if (!mode) {
    throw new Error(
      "Usage: node scripts/video-connectivity-test.cjs " +
      "<preflight|planning|prepaid|paid|image:upload|image:planning|image:paid>",
    );
  }
  return mode;
};

const loadContracts = async () => {
  let contracts;
  try {
    contracts = await import(pathToFileURL(CONTRACTS_ENTRY).href);
  } catch (error) {
    throw new Error(
      "Built @chat-to-video/contracts are required. Run " +
      "`pnpm --filter @chat-to-video/contracts build` first. " +
      `Cause: ${redactSecrets(error instanceof Error ? error.message : error)}`,
      { cause: error },
    );
  }
  const required = [
    "ApimartAccountBalanceSchema",
    "CINEMATIC_PIPELINE_DEFINITION",
    "CompleteReferenceImageUploadResponseSchema",
    "CreateReferenceImageUploadRequestSchema",
    "CreateReferenceImageUploadResponseSchema",
    "CreateVideoWorkflowRequestSchema",
    "CreateVideoWorkflowResponseSchema",
    "ReferenceImageViewSchema",
    "VideoWorkflowEventSchema",
    "VideoWorkflowInteractionResultSchema",
    "VideoWorkflowSnapshotSchema",
  ];
  for (const name of required) {
    if (!contracts[name]) throw new Error(`Built contracts are missing export ${name}.`);
  }
  if (!contracts.CINEMATIC_PIPELINE_DEFINITION.stages.some(
    (stage) => stage.id === "consistency_reference",
  )) {
    throw new Error("Built contracts are stale: consistency_reference is not registered.");
  }
  return contracts;
};

const loadTemplateMatcher = async () => {
  let registry;
  try {
    registry = await import(pathToFileURL(API_TEMPLATE_REGISTRY_ENTRY).href);
  } catch (error) {
    throw new Error(
      "Built API template registry is required for prompt reporting. Run " +
      "`pnpm --filter @chat-to-video/api build` first. " +
      `Cause: ${redactSecrets(error instanceof Error ? error.message : error)}`,
      { cause: error },
    );
  }
  if (typeof registry.matchCinematicSkillTemplate !== "function") {
    throw new Error("Built API template registry is missing matchCinematicSkillTemplate.");
  }
  return registry.matchCinematicSkillTemplate;
};

const fetchWithTimeout = (url, init, timeoutMs) => fetch(url, {
  ...init,
  signal: AbortSignal.timeout(timeoutMs),
});

const parseResponseBody = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const requestJson = async (baseUrl, path, init = {}, timeoutMs = 30_000) => {
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
  }, timeoutMs);
  const body = await parseResponseBody(response);
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(
      `${init.method ?? "GET"} ${path} failed (${response.status}): ${redactSecrets(detail)}`,
    );
  }
  if (typeof body === "string") {
    throw new Error(`${init.method ?? "GET"} ${path} returned non-JSON content.`);
  }
  return body;
};

const requestPublicPricing = async (url, timeoutMs = 15_000) => {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, { headers: { accept: "application/json" } }, timeoutMs);
      const body = await parseResponseBody(response);
      if (!response.ok || !body || typeof body !== "object" || body.success !== true) {
        throw new Error(`pricing endpoint returned status ${response.status}`);
      }
      return body.data;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(250 * attempt);
    }
  }
  throw new Error(`APIMart pricing lookup failed: ${redactSecrets(lastError)}`);
};

const loadPricing = async () => {
  const [chat, video, music, image] = await Promise.all(
    Object.values(PRICING_URLS).map((url) => requestPublicPricing(url)),
  );
  const inputRate = chat?.pricing?.effective_rates?.input;
  const outputRate = chat?.pricing?.effective_rates?.output;
  const videoRates = video?.resolution_prices;
  const musicRate = music?.action_prices?.["flowmusic@generate"] ?? music?.model_price;
  const imageRate = image?.resolution_prices?.["2K"];
  const additionalImageInputRate = image?.input_image_price;
  if (![inputRate, outputRate, musicRate, imageRate, additionalImageInputRate].every(
    (rate) => Number.isFinite(rate) && rate >= 0,
  ) || !videoRates || typeof videoRates !== "object") {
    throw new Error("APIMart pricing response is missing a required reviewed field.");
  }
  for (const profile of ["480P", "720P", "1080P", "480P-input", "720P-input", "1080P-input"]) {
    if (!Number.isFinite(videoRates[profile]) || videoRates[profile] < 0) {
      throw new Error(`APIMart pricing response is missing ${profile}.`);
    }
  }
  return {
    chatInputPerMillion: inputRate,
    chatOutputPerMillion: outputRate,
    videoRates,
    musicPerGeneration: musicRate,
    image2kPerGeneration: imageRate,
    additionalImageInput: additionalImageInputRate,
    capturedAt: new Date().toISOString(),
  };
};

const getBalance = async (configuration) => configuration.contracts.ApimartAccountBalanceSchema.parse(
  await requestJson(configuration.baseUrl, "/apimart/account/balance"),
);

const observedBalanceDelta = (before, after) => {
  if (before.isUnlimited || after.isUnlimited || before.remainingBalance === null ||
      after.remainingBalance === null) return null;
  const delta = before.remainingBalance - after.remainingBalance;
  return delta >= 0 ? Number(delta.toFixed(6)) : null;
};

const waitForSettledBalance = async (configuration) => {
  let previous = await getBalance(configuration);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await delay(configuration.balancePollIntervalMs);
    const current = await getBalance(configuration);
    if (current.remainingBalance === previous.remainingBalance &&
        current.isUnlimited === previous.isUnlimited) return current;
    previous = current;
  }
  return previous;
};

const assertSnapshotActive = (snapshot, label) => {
  if (TERMINAL_FAILURES.has(snapshot.status)) {
    throw new Error(
      `${label} entered ${snapshot.status}: ` +
      `${snapshot.errorMessage ?? "no diagnostic was persisted"}`,
    );
  }
  for (const [name, batch] of [
    ["consistency reference", snapshot.consistencyReferenceBatch],
    ["asset", snapshot.assetBatch],
  ]) {
    if (batch && TERMINAL_FAILURES.has(batch.status)) {
      throw new Error(`${label} ${name} batch entered ${batch.status}.`);
    }
  }
};

const getSnapshot = async (configuration, workflowId) => {
  const raw = await requestJson(configuration.baseUrl, `/video-workflows/${workflowId}`);
  return configuration.contracts.VideoWorkflowSnapshotSchema.parse(raw);
};

const snapshotDiagnostic = (snapshot) => JSON.stringify({
  status: snapshot?.status ?? "unknown",
  stage: snapshot?.currentStage ?? "unknown",
  version: snapshot?.currentVersion ?? null,
  consistencyReferenceBatch: snapshot?.consistencyReferenceBatch?.status ?? null,
  assetBatch: snapshot?.assetBatch?.status ?? null,
  videoJob: snapshot?.videoJob?.status ?? null,
});

const waitForSnapshot = async ({
  configuration,
  workflowId,
  label,
  predicate,
  timeoutMs = configuration.timeoutMs,
}) => {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await getSnapshot(configuration, workflowId);
    assertSnapshotActive(latest, label);
    if (predicate(latest)) return latest;
    await delay(configuration.pollIntervalMs);
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms; latest=${snapshotDiagnostic(latest)}.`,
  );
};

const parseSseFrame = (frame) => {
  const parsed = { id: null, event: null, data: null };
  const dataLines = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (line.startsWith("id:")) parsed.id = line.slice(3).trim();
    else if (line.startsWith("event:")) parsed.event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length > 0) parsed.data = JSON.parse(dataLines.join("\n"));
  return parsed;
};

const startEventMonitor = (configuration, workflowId) => {
  let stopped = false;
  let activeController = null;
  let connectionCount = 0;
  let reconnectHeaderCount = 0;
  let highestSequence = 0;
  const eventTypes = new Set();
  const persistentSequences = new Set();
  let duplicatePersistentEvents = 0;
  let monitorError = null;

  const consume = async (response) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!stopped) {
      const result = await reader.read();
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/u);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        if (!frame.trim() || frame.trimStart().startsWith(":")) continue;
        const parsed = parseSseFrame(frame);
        if (!parsed.event || !parsed.data) continue;
        const event = configuration.contracts.VideoWorkflowEventSchema.parse(parsed.data);
        eventTypes.add(event.type);
        highestSequence = Math.max(highestSequence, event.sequence);
        if (event.type !== "workflow.snapshot" && event.type !== "heartbeat") {
          if (persistentSequences.has(event.sequence)) duplicatePersistentEvents += 1;
          persistentSequences.add(event.sequence);
        }
      }
    }
  };

  const done = (async () => {
    while (!stopped) {
      activeController = new AbortController();
      const headers = { accept: "text/event-stream" };
      if (highestSequence > 0) {
        headers["last-event-id"] = String(highestSequence);
        reconnectHeaderCount += 1;
      }
      connectionCount += 1;
      try {
        const response = await fetch(
          `${configuration.baseUrl}/video-workflows/${workflowId}/events`,
          { headers, signal: activeController.signal },
        );
        if (!response.ok || !response.body) {
          throw new Error(`SSE connection failed (${response.status}).`);
        }
        await consume(response);
      } catch (error) {
        if (stopped) break;
        if (error?.name !== "AbortError") {
          monitorError = error;
          await delay(Math.min(configuration.pollIntervalMs, 1_000));
        }
      } finally {
        activeController = null;
      }
    }
  })();

  return {
    eventTypes,
    state: () => ({
      connectionCount,
      reconnectHeaderCount,
      duplicatePersistentEvents,
      highestSequence,
      monitorError,
    }),
    forceReconnect: async () => {
      const previousCount = connectionCount;
      activeController?.abort();
      const deadline = Date.now() + 5_000;
      while (connectionCount <= previousCount && Date.now() < deadline) await delay(25);
      if (connectionCount <= previousCount) throw new Error("SSE reconnect did not start.");
    },
    stop: async () => {
      stopped = true;
      activeController?.abort();
      await done;
    },
  };
};

const waitForEventType = async (monitor, eventType, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (monitor.eventTypes.has(eventType)) return;
    const state = monitor.state();
    if (state.monitorError && state.connectionCount >= 3) {
      throw new Error(`SSE monitor failed: ${redactSecrets(state.monitorError)}`);
    }
    await delay(100);
  }
  throw new Error(`SSE did not deliver ${eventType} within ${timeoutMs}ms.`);
};

const approve = async (configuration, workflowId) =>
  configuration.contracts.VideoWorkflowInteractionResultSchema.parse(
    await requestJson(configuration.baseUrl, `/video-workflows/${workflowId}/interactions`, {
      method: "POST",
      body: JSON.stringify({ type: "approve" }),
    }),
  );

const detectImageMime = (buffer) => {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
};

const validateImageInput = (filePath, buffer) => {
  if (!filePath) throw new Error("CONNECTIVITY_REFERENCE_IMAGE_PATH is required for image modes.");
  if (buffer.length === 0) throw new Error("Reference image cannot be empty.");
  if (buffer.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("Reference image exceeds the 10 MiB limit.");
  }
  const mimeType = detectImageMime(buffer);
  if (!mimeType) throw new Error("Reference image is not a valid JPEG, PNG or WebP file.");
  const extensionMime = new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".webp", "image/webp"],
  ]).get(extname(filePath).toLowerCase());
  if (!extensionMime || extensionMime !== mimeType) {
    throw new Error("Reference image extension does not match its binary MIME type.");
  }
  return { mimeType, sizeBytes: buffer.length };
};

const imageDeclaration = () => {
  const purpose = process.env.CONNECTIVITY_REFERENCE_PURPOSE?.trim() || "product";
  if (!IMAGE_PURPOSES.has(purpose)) {
    throw new Error("CONNECTIVITY_REFERENCE_PURPOSE is invalid.");
  }
  const label = process.env.CONNECTIVITY_REFERENCE_LABEL?.trim() || "连通性测试产品";
  if (!label || label.length > 120) {
    throw new Error("CONNECTIVITY_REFERENCE_LABEL must contain 1-120 characters.");
  }
  return { purpose, label, sceneOrders: [1, 2] };
};

const uploadReferenceImage = async (configuration) => {
  const filePath = process.env.CONNECTIVITY_REFERENCE_IMAGE_PATH?.trim();
  if (!filePath) throw new Error("CONNECTIVITY_REFERENCE_IMAGE_PATH is required for image modes.");
  let buffer;
  try {
    buffer = readFileSync(resolve(filePath));
  } catch (error) {
    throw new Error(`Reference image cannot be read: ${redactSecrets(error)}`, { cause: error });
  }
  const inspected = validateImageInput(filePath, buffer);
  const declaration = imageDeclaration();
  const uploadRequest =
    configuration.contracts.CreateReferenceImageUploadRequestSchema.parse({
      fileName: filePath.split(/[\\/]/u).at(-1),
      ...inspected,
      declaration,
    });
  const created = configuration.contracts.CreateReferenceImageUploadResponseSchema.parse(
    await requestJson(configuration.baseUrl, "/reference-images/uploads", {
      method: "POST",
      body: JSON.stringify(uploadRequest),
    }),
  );
  if (created.referenceImage.status !== "pending_upload") {
    throw new Error("Reference image upload did not start in pending_upload.");
  }
  const uploadResponse = await fetchWithTimeout(created.uploadUrl, {
    method: "PUT",
    body: buffer,
    headers: { "content-type": inspected.mimeType },
  }, configuration.timeoutMs);
  if (!uploadResponse.ok) {
    throw new Error(`Reference image object upload failed (${uploadResponse.status}).`);
  }
  configuration.contracts.CompleteReferenceImageUploadResponseSchema.parse(
    await requestJson(
      configuration.baseUrl,
      `/reference-images/${encodeURIComponent(created.referenceImage.id)}/complete`,
      { method: "POST" },
    ),
  );
  const deadline = Date.now() + configuration.timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = configuration.contracts.ReferenceImageViewSchema.parse(
      await requestJson(
        configuration.baseUrl,
        `/reference-images/${encodeURIComponent(created.referenceImage.id)}`,
      ),
    );
    if (latest.status === "rejected" || latest.status === "abandoned") {
      throw new Error(`Reference image entered terminal status ${latest.status}.`);
    }
    if (latest.status === "ready") break;
    await delay(configuration.pollIntervalMs);
  }
  if (latest?.status !== "ready") throw new Error("Reference image validation timed out.");
  if (latest.mimeType !== inspected.mimeType || latest.sizeBytes !== inspected.sizeBytes ||
      !latest.width || !latest.height || !latest.previewUrl) {
    throw new Error("Reference image ready metadata does not match the uploaded file.");
  }
  console.log(
    `referenceImageId=${latest.id} mime=${latest.mimeType} ` +
    `size=${latest.sizeBytes} dimensions=${latest.width}x${latest.height}`,
  );
  return latest;
};

const assertReferenceAnalysis = (image, declaration, paidMode = false) => {
  if (!image.analysis || image.analysis.referenceImageId !== image.id) {
    throw new Error("Reference image analysis is missing or belongs to another image.");
  }
  if (image.analysis.visibleFeatures.length === 0 ||
      image.analysis.consistencyRequirements.length === 0) {
    throw new Error("Reference image analysis did not produce usable visual constraints.");
  }
  if (image.analysis.visibleFeatures.some((item) => item.length > 400) ||
      image.analysis.consistencyRequirements.some((item) => item.length > 400)) {
    throw new Error("Reference image analysis exceeded the item character limit.");
  }
  if (image.analysis.containsSensitiveContent || image.resolution?.status === "blocked") {
    throw new Error("Reference image analysis blocked sensitive content.");
  }
  if (paidMode && image.analysis.containsRealPerson) {
    throw new Error("Paid image connectivity does not accept real-person input.");
  }
  if (!image.resolution || !["user_resolved", "auto_resolved"].includes(image.resolution.status)) {
    throw new Error(
      `Reference image purpose needs clarification; status=${image.resolution?.status ?? "missing"}.`,
    );
  }
  if (image.resolution.effectivePurpose !== declaration.purpose ||
      image.resolution.effectiveLabel !== declaration.label) {
    throw new Error("Reference image declaration was not preserved as the effective purpose.");
  }
  return image.analysis;
};

const assertConsistencyReferenceArtifact = (snapshot, referenceImageId = null) => {
  const artifact = snapshot.currentArtifact?.artifact;
  if (artifact?.stage !== "consistency_reference") {
    throw new Error("Current artifact is not a consistency-reference plan.");
  }
  if (referenceImageId === null) return artifact.data;
  if (artifact.data.status !== "required") {
    throw new Error("Image-conditioned planning did not require a consistency reference.");
  }
  const suppliedGroups = artifact.data.groups.filter((group) =>
    group.sourceReferenceImageIds.includes(referenceImageId));
  if (suppliedGroups.length === 0) {
    throw new Error("Uploaded image was not mapped into sourceReferenceImageIds.");
  }
  if (suppliedGroups.some((group) => group.estimatedCostUsd !== 0)) {
    throw new Error("Uploaded reference groups must not carry Seedream generation cost.");
  }
  return artifact.data;
};

const assertSuppliedReferenceBatch = (batch, referenceImageId) => {
  if (!batch || batch.stageId !== "consistency_reference" || batch.status !== "awaiting_approval") {
    throw new Error("Supplied reference batch is not awaiting approval.");
  }
  const expectedAssetId = `uploaded-ref-${referenceImageId}`;
  const supplied = batch.assets.filter((asset) => asset.assetId === expectedAssetId);
  if (supplied.length === 0) {
    throw new Error("Consistency-reference batch did not reuse the uploaded image.");
  }
  if (supplied.some((asset) => asset.capabilityResolution.adapterId !==
      "storage.validated-reference-image")) {
    throw new Error("Uploaded image used an unexpected capability adapter.");
  }
  return expectedAssetId;
};

const assetPlanFromSnapshot = (snapshot) => {
  const artifact = snapshot.currentArtifact?.artifact;
  if (artifact?.stage !== "assets") throw new Error("Current artifact is not an assets plan.");
  return artifact.data;
};

const resolveConnectivityPrompt = (configuration, referenceImage = null) =>
  configuration.prompt || (referenceImage ? DEFAULT_IMAGE_PROMPT : DEFAULT_PROMPT);

const createPlanningPromptReport = ({ initialPrompt, matchedTemplate, plan }) => ({
  initialPrompt,
  triggeredTemplateName: matchedTemplate?.skillId ?? null,
  finalPrompts: plan.assets.map((asset) => ({
    sceneOrder: asset.sceneOrder,
    kind: asset.kind,
    prompt: asset.prompt,
  })),
});

const printPlanningPromptReport = (configuration, plan, referenceImage) => {
  if (!configuration.reportPrompts || !configuration.matchSkillTemplate) return;
  const initialPrompt = resolveConnectivityPrompt(configuration, referenceImage);
  const report = createPlanningPromptReport({
    initialPrompt,
    matchedTemplate: configuration.matchSkillTemplate(initialPrompt),
    plan,
  });
  console.log("\nTemplate planning prompt report");
  console.log(JSON.stringify(report, null, 2));
};

const assertPlanningGate = (snapshot) => {
  const plan = assetPlanFromSnapshot(snapshot);
  if (snapshot.currentStage !== "assets" || snapshot.status !== "awaiting_input") {
    throw new Error("Workflow is not waiting at the assets planning approval gate.");
  }
  if (snapshot.assetBatch !== null || snapshot.videoJob !== null) {
    throw new Error("Paid work has already crossed the queue handoff boundary.");
  }
  if (!Number.isFinite(plan.totalEstimatedCostUsd) || plan.totalEstimatedCostUsd < 0) {
    throw new Error("Assets plan does not contain a valid total cost estimate.");
  }
  return plan;
};

const calculateLiveMediaEstimate = (
  plan,
  pricing,
  hasReferenceInput,
  outputResolution = "480p",
) => {
  let generatedSeconds = 0;
  let generatedImageCount = 0;
  for (const asset of plan.assets) {
    if (asset.sourceMode !== "generate" || asset.kind === "title_card") continue;
    if (asset.kind === "image") {
      generatedImageCount += 1;
      continue;
    }
    if (asset.kind !== "video") continue;
    const inferredSeconds = asset.estimatedCostUsd / REVIEWED_VIDEO_RATE_USD;
    const roundedSeconds = Math.round(inferredSeconds);
    if (!Number.isInteger(roundedSeconds) || roundedSeconds < 1 ||
        Math.abs(inferredSeconds - roundedSeconds) > 0.0001) {
      throw new Error("Cannot infer generated seconds from the reviewed runtime estimate.");
    }
    generatedSeconds += roundedSeconds;
  }
  const providerResolution = outputResolution === "480p"
    ? "480P"
    : outputResolution === "720p" || outputResolution === "768p"
      ? "720P"
      : "1080P";
  const resolutionProfile = hasReferenceInput
    ? `${providerResolution}-input`
    : providerResolution;
  if (!Number.isFinite(pricing.videoRates[resolutionProfile])) {
    throw new Error(`Live pricing is missing resolution profile ${resolutionProfile}.`);
  }
  const videoCost = generatedSeconds * pricing.videoRates[resolutionProfile];
  const musicCost = plan.music.sourceMode === "generate" ? pricing.musicPerGeneration : 0;
  const imageCost = generatedImageCount * pricing.image2kPerGeneration;
  return {
    generatedSeconds,
    generatedImageCount,
    resolutionProfile,
    amountUsd: Number((videoCost + musicCost + imageCost).toFixed(6)),
  };
};

const assertGeneratedImagePricingSafe = (plan, pricing) => {
  for (const asset of plan.assets) {
    if (asset.kind === "image" && asset.sourceMode === "generate" &&
        asset.estimatedCostUsd + 0.000001 < pricing.image2kPerGeneration) {
      throw new Error(
        `Runtime Seedream estimate $${asset.estimatedCostUsd.toFixed(6)} is below live 2K price ` +
        `$${pricing.image2kPerGeneration.toFixed(6)}. No paid approval was sent.`,
      );
    }
  }
};

const assertTotalBudget = ({ spentUsd, runtimeMediaUsd, liveMediaUsd, maximumUsd, reserveUsd }) => {
  if (!Number.isFinite(maximumUsd) || maximumUsd <= 0) {
    throw new Error("CONNECTIVITY_MAX_TOTAL_COST_USD must be a positive finite number.");
  }
  const knownSpent = spentUsd ?? 0;
  const guardedMedia = Math.max(runtimeMediaUsd, liveMediaUsd);
  const guardedTotal = knownSpent + guardedMedia + reserveUsd;
  if (guardedTotal > maximumUsd) {
    throw new Error(
      `Guarded total cost $${guardedTotal.toFixed(6)} exceeds configured limit ` +
      `$${maximumUsd.toFixed(6)}. No paid approval was sent.`,
    );
  }
  return { knownSpent, guardedMedia, guardedTotal };
};

const assertModelAuthorization = (mode, configuration) => {
  if (!Number.isFinite(configuration.maximumTotalCostUsd) ||
      configuration.maximumTotalCostUsd <= 0) {
    throw new Error(
      "Set CONNECTIVITY_MAX_TOTAL_COST_USD before starting a model-calling test.",
    );
  }
  if (mode.endsWith("planning")) {
    if (process.env.CONNECTIVITY_PLANNING_CONFIRM !== PLANNING_CONFIRMATION) {
      throw new Error(
        `Planning requires CONNECTIVITY_PLANNING_CONFIRM=${PLANNING_CONFIRMATION}.`,
      );
    }
  } else if (mode.endsWith("paid")) {
    if (process.env.CONNECTIVITY_PAID_CONFIRM !== PAID_CONFIRMATION) {
      throw new Error(`Paid execution requires CONNECTIVITY_PAID_CONFIRM=${PAID_CONFIRMATION}.`);
    }
  }
};

const printPricing = (pricing) => {
  console.log("\nAPIMart pricing snapshot (USD)");
  console.log(`  gpt-5-mini input:    $${pricing.chatInputPerMillion}/1M tokens`);
  console.log(`  gpt-5-mini output:   $${pricing.chatOutputPerMillion}/1M tokens`);
  console.log(`  Seedance 480P:       $${pricing.videoRates["480P"]}/second`);
  console.log(`  Seedance 480P-input: $${pricing.videoRates["480P-input"]}/second`);
  console.log(`  FlowMusic generate:  $${pricing.musicPerGeneration}/generation`);
  console.log(`  Seedream 2K:         $${pricing.image2kPerGeneration}/image`);
  console.log(`  capturedAt=${pricing.capturedAt}\n`);
};

const printCostPlan = (plan, live, planningDelta, maximumTotalCostUsd) => {
  console.log("\nModel cost estimate (USD)");
  for (const asset of plan.assets) {
    console.log(
      `  scene ${asset.sceneOrder}: ${asset.kind}/${asset.sourceMode} ` +
      `$${asset.estimatedCostUsd.toFixed(6)}`,
    );
  }
  console.log(`  runtime media estimate: $${plan.totalEstimatedCostUsd.toFixed(6)}`);
  console.log(
    `  live media estimate (${live.resolutionProfile}, ${live.generatedSeconds}s): ` +
    `$${live.amountUsd.toFixed(6)}`,
  );
  console.log(
    `  observed planning balance delta: ` +
    `${planningDelta === null ? "unavailable" : `$${planningDelta.toFixed(6)}`}`,
  );
  console.log(`  remaining-text reserve: $${TEXT_COMPLETION_RESERVE_USD.toFixed(6)}`);
  console.log(`  configured total limit: $${maximumTotalCostUsd.toFixed(6)}\n`);
};

const assertSseCoverage = (monitor) => {
  for (const requiredType of ["workflow.snapshot", "cinematic.artifact.completed"]) {
    if (!monitor.eventTypes.has(requiredType)) {
      throw new Error(`SSE did not deliver required event type ${requiredType}.`);
    }
  }
  const state = monitor.state();
  if (state.connectionCount < 2 || state.reconnectHeaderCount < 1) {
    throw new Error("SSE reconnect did not send Last-Event-ID.");
  }
  if (state.duplicatePersistentEvents > 0) {
    throw new Error("SSE replay delivered duplicate persistent event sequences.");
  }
};

const refreshReferenceImage = async (configuration, id) =>
  configuration.contracts.ReferenceImageViewSchema.parse(
    await requestJson(configuration.baseUrl, `/reference-images/${encodeURIComponent(id)}`),
  );

const createWorkflow = async (configuration, referenceImage) => {
  const prompt = resolveConnectivityPrompt(configuration, referenceImage);
  const request = configuration.contracts.CreateVideoWorkflowRequestSchema.parse({
    messageId: `connectivity-${Date.now()}-${randomUUID().slice(0, 8)}`,
    prompt,
    referenceImageIds: referenceImage ? [referenceImage.id] : [],
    videoModel: configuration.videoModel,
    subtitlesEnabled: false,
  });
  return configuration.contracts.CreateVideoWorkflowResponseSchema.parse(
    await requestJson(configuration.baseUrl, "/video-workflows", {
      method: "POST",
      body: JSON.stringify(request),
    }, configuration.timeoutMs),
  );
};

const advanceToPlanningGate = async (configuration, referenceImage) => {
  const created = await createWorkflow(configuration, referenceImage);
  console.log(`workflowId=${created.workflowId}`);
  console.log(`conversationId=${created.conversationId}`);
  const monitor = startEventMonitor(configuration, created.workflowId);
  const approved = new Set();
  let suppliedReferenceAssetId = null;
  try {
    if (referenceImage) {
      const analyzed = await refreshReferenceImage(configuration, referenceImage.id);
      assertReferenceAnalysis(analyzed, imageDeclaration(), configuration.mode.endsWith("paid"));
      console.log(
        `reference analysis resolved purpose=${analyzed.resolution.effectivePurpose} ` +
        `confidence=${analyzed.analysis.confidence}`,
      );
    }
    while (true) {
      const snapshot = await waitForSnapshot({
        configuration,
        workflowId: created.workflowId,
        label: "planning review",
        predicate: (candidate) => candidate.status === "awaiting_input" &&
          candidate.currentArtifact?.artifact?.stage === candidate.currentStage,
      });
      const stage = snapshot.currentStage;
      const definition = configuration.contracts.CINEMATIC_PIPELINE_DEFINITION.stages.find(
        (candidate) => candidate.id === stage,
      );
      if (!definition) throw new Error(`Workflow reached unknown stage ${stage}.`);
      if (stage === "assets") {
        const plan = assertPlanningGate(snapshot);
        await monitor.forceReconnect();
        await waitForEventType(monitor, "workflow.snapshot", 5_000);
        assertSseCoverage(monitor);
        return { created, monitor, plan, snapshot, suppliedReferenceAssetId };
      }
      if (!definition.planningReview.requiresApproval) {
        throw new Error(`Workflow unexpectedly requested input at non-review stage ${stage}.`);
      }
      const approvalKey = `${stage}:${snapshot.currentVersion}`;
      if (approved.has(approvalKey)) {
        throw new Error(`Workflow requested duplicate approval for ${approvalKey}.`);
      }
      approved.add(approvalKey);

      if (stage !== "consistency_reference") {
        console.log(`approve planning stage=${stage} version=${snapshot.currentVersion}`);
        await approve(configuration, created.workflowId);
        continue;
      }

      const referencePlan = assertConsistencyReferenceArtifact(
        snapshot,
        referenceImage?.id ?? null,
      );
      const generatedGroups = referencePlan.status === "required"
        ? referencePlan.groups.filter((group) => group.sourceReferenceImageIds.length === 0)
        : [];
      if (generatedGroups.length > 0) {
        throw new Error(
          `Consistency planning requested ${generatedGroups.length} generated reference image(s); ` +
          "this script stops before the Seedream queue because reviewed runtime pricing is stale.",
        );
      }
      console.log(
        `approve planning stage=consistency_reference version=${snapshot.currentVersion} ` +
        `status=${referencePlan.status}`,
      );
      await approve(configuration, created.workflowId);
      if (referencePlan.status === "not_required") continue;

      const referenceReview = await waitForSnapshot({
        configuration,
        workflowId: created.workflowId,
        label: "supplied consistency-reference review",
        predicate: (candidate) => candidate.status === "awaiting_input" &&
          candidate.currentStage === "consistency_reference" &&
          candidate.consistencyReferenceBatch?.status === "awaiting_approval",
      });
      if (!referenceImage) {
        throw new Error("Consistency-reference execution unexpectedly requires generated media.");
      }
      suppliedReferenceAssetId = assertSuppliedReferenceBatch(
        referenceReview.consistencyReferenceBatch,
        referenceImage.id,
      );
      console.log(`approve reused reference asset=${suppliedReferenceAssetId}`);
      await approve(configuration, created.workflowId);
    }
  } catch (error) {
    await monitor.stop();
    throw error;
  }
};

const assertImageBindings = (assetBatch, expectedAssetId) => {
  if (!assetBatch || assetBatch.stageId !== "assets" || assetBatch.status !== "awaiting_approval") {
    throw new Error("Generated asset batch is not awaiting approval.");
  }
  const videos = assetBatch.assets.filter((asset) => asset.kind === "video");
  if (videos.length === 0) throw new Error("Image-paid test generated no video assets.");
  if (!videos.some((asset) => asset.referenceBindings.some(
    (binding) => binding.assetId === expectedAssetId && binding.approvalStatus === "approved",
  ))) {
    throw new Error("Generated video assets did not preserve the uploaded reference binding.");
  }
};

const runPreflight = async (configuration) => {
  const health = await requestJson(configuration.baseUrl, "/health");
  if (health?.status !== "ok") throw new Error("API health endpoint did not return status=ok.");
  const [balance, pricing] = await Promise.all([getBalance(configuration), loadPricing()]);
  printPricing(pricing);
  console.log(
    `APIMart balance=${balance.isUnlimited ? "unlimited" : `$${balance.remainingBalance}`}`,
  );
  console.log("PASS: preflight completed without invoking a model.");
};

const runImageUpload = async (configuration) => {
  const before = await getBalance(configuration);
  const image = await uploadReferenceImage(configuration);
  const after = await waitForSettledBalance(configuration);
  const delta = observedBalanceDelta(before, after);
  console.log(`PASS: reference image ready id=${image.id}.`);
  console.log(
    `Observed model balance delta=${delta === null ? "unavailable" : `$${delta.toFixed(6)}`}; ` +
    "image upload/probe itself uses no model.",
  );
};

const runPlanning = async (configuration, referenceImage) => {
  assertModelAuthorization(configuration.mode, configuration);
  const balanceBefore = await getBalance(configuration);
  const pricing = await loadPricing();
  const result = await advanceToPlanningGate(configuration, referenceImage);
  try {
    const balanceAfter = await waitForSettledBalance(configuration);
    const planningDelta = observedBalanceDelta(balanceBefore, balanceAfter);
    const live = calculateLiveMediaEstimate(
      result.plan,
      pricing,
      Boolean(referenceImage),
      result.snapshot.outputResolution,
    );
    printPricing(pricing);
    printCostPlan(result.plan, live, planningDelta, configuration.maximumTotalCostUsd);
    printPlanningPromptReport(configuration, result.plan, referenceImage);
    if (planningDelta !== null && planningDelta > configuration.maximumTotalCostUsd) {
      throw new Error("Observed planning cost exceeded CONNECTIVITY_MAX_TOTAL_COST_USD.");
    }
    console.log("PASS: planning, persistence, Mastra suspension/resume, REST and SSE are connected.");
    console.log("PASS: assetBatch and videoJob are null; no asset-generation approval was sent.");
  } finally {
    await result.monitor.stop();
  }
};

const runPaid = async (configuration, referenceImage) => {
  assertModelAuthorization(configuration.mode, configuration);
  const balanceBefore = await getBalance(configuration);
  if (balanceBefore.isUnlimited) {
    throw new Error("Paid connectivity requires a finite balance so total spend can be measured.");
  }
  const pricing = await loadPricing();
  const result = await advanceToPlanningGate(configuration, referenceImage);
  try {
    const balanceAtGate = await waitForSettledBalance(configuration);
    const planningDelta = observedBalanceDelta(balanceBefore, balanceAtGate);
    if (planningDelta === null) {
      throw new Error("Planning balance delta is unavailable; no paid approval was sent.");
    }
    assertGeneratedImagePricingSafe(result.plan, pricing);
    const live = calculateLiveMediaEstimate(
      result.plan,
      pricing,
      Boolean(referenceImage),
      result.snapshot.outputResolution,
    );
    printPricing(pricing);
    printCostPlan(result.plan, live, planningDelta, configuration.maximumTotalCostUsd);
    const budget = assertTotalBudget({
      spentUsd: planningDelta,
      runtimeMediaUsd: result.plan.totalEstimatedCostUsd,
      liveMediaUsd: live.amountUsd,
      maximumUsd: configuration.maximumTotalCostUsd,
      reserveUsd: TEXT_COMPLETION_RESERVE_USD,
    });
    console.log(`budget gate passed guardedTotal=$${budget.guardedTotal.toFixed(6)}`);
    console.log("sending paid asset-planning approval");
    await approve(configuration, result.created.workflowId);

    const assetReview = await waitForSnapshot({
      configuration,
      timeoutMs: configuration.paidTimeoutMs,
      workflowId: result.created.workflowId,
      label: "paid asset generation",
      predicate: (candidate) => candidate.status === "awaiting_input" &&
        candidate.currentStage === "assets" &&
        candidate.assetBatch?.status === "awaiting_approval",
    });
    if (assetReview.assetBatch.assets.length === 0) {
      throw new Error("Generated asset batch is empty.");
    }
    if (referenceImage) {
      assertImageBindings(assetReview.assetBatch, result.suppliedReferenceAssetId);
    }
    console.log(`generated asset count=${assetReview.assetBatch.assets.length}`);
    await approve(configuration, result.created.workflowId);
    console.log("approved generated assets; waiting for final composition");

    const completed = await waitForSnapshot({
      configuration,
      timeoutMs: configuration.paidTimeoutMs,
      workflowId: result.created.workflowId,
      label: "final video generation",
      predicate: (candidate) => candidate.status === "succeeded",
    });
    if (!completed.videoJob?.playbackUrl) {
      throw new Error("Workflow succeeded without a playback URL.");
    }
    await waitForEventType(result.monitor, "job.completed", 5_000);
    const balanceAfter = await waitForSettledBalance(configuration);
    const actualDelta = observedBalanceDelta(balanceBefore, balanceAfter);
    console.log("PASS: final playback URL is present and was not printed.");
    console.log(
      `Observed total model balance delta=` +
      `${actualDelta === null ? "unavailable" : `$${actualDelta.toFixed(6)}`}`,
    );
    if (actualDelta !== null && actualDelta > configuration.maximumTotalCostUsd) {
      throw new Error("Observed total model cost exceeded CONNECTIVITY_MAX_TOTAL_COST_USD.");
    }
  } finally {
    await result.monitor.stop();
  }
};

const configurationFromEnvironment = async (mode) => {
  if (process.env.CONNECTIVITY_MAX_COST_USD && !process.env.CONNECTIVITY_MAX_TOTAL_COST_USD) {
    console.warn(
      "CONNECTIVITY_MAX_COST_USD is deprecated and is treated as the total-cost limit. " +
      "Use CONNECTIVITY_MAX_TOTAL_COST_USD.",
    );
  }
  const reportPrompts = process.env.CONNECTIVITY_REPORT_PROMPTS === "true";
  return {
    mode,
    contracts: await loadContracts(),
    baseUrl: normalizeBaseUrl(
      process.env.CONNECTIVITY_API_BASE_URL ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL,
    ),
    prompt: process.env.CONNECTIVITY_PROMPT?.trim() || null,
    reportPrompts,
    matchSkillTemplate: reportPrompts ? await loadTemplateMatcher() : null,
    videoModel: process.env.CONNECTIVITY_VIDEO_MODEL?.trim() || DEFAULT_MODEL,
    pollIntervalMs: parsePositiveInteger("CONNECTIVITY_POLL_INTERVAL_MS", 2_000),
    balancePollIntervalMs: parsePositiveInteger("CONNECTIVITY_BALANCE_POLL_INTERVAL_MS", 2_000),
    timeoutMs: parsePositiveInteger("CONNECTIVITY_STAGE_TIMEOUT_MS", 10 * 60_000),
    paidTimeoutMs: parsePositiveInteger("CONNECTIVITY_PAID_TIMEOUT_MS", 90 * 60_000),
    maximumTotalCostUsd: parseOptionalPositiveNumber(
      "CONNECTIVITY_MAX_TOTAL_COST_USD",
      "CONNECTIVITY_MAX_COST_USD",
    ),
  };
};

const main = async () => {
  loadRepositoryEnvironment({ repositoryRoot: REPOSITORY_ROOT });
  const mode = normalizeMode(process.argv[2]);
  const configuration = await configurationFromEnvironment(mode);
  console.log(`mode=${mode} api=${configuration.baseUrl} model=${configuration.videoModel}`);
  if (mode === "preflight") return runPreflight(configuration);
  if (mode === "image:upload") return runImageUpload(configuration);
  assertModelAuthorization(mode, configuration);
  const withImage = mode.startsWith("image:");
  const referenceImage = withImage ? await uploadReferenceImage(configuration) : null;
  if (mode.endsWith("planning")) return runPlanning(configuration, referenceImage);
  return runPaid(configuration, referenceImage);
};

if (require.main === module) {
  void main().catch((error) => {
    console.error(
      `Connectivity test failed: ${redactSecrets(error instanceof Error ? error.message : error)}`,
    );
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_REFERENCE_IMAGE_BYTES,
  PAID_CONFIRMATION,
  PLANNING_CONFIRMATION,
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
  createPlanningPromptReport,
  detectImageMime,
  normalizeBaseUrl,
  normalizeMode,
  parseSseFrame,
  redactSecrets,
  requestJson,
  resolveConnectivityPrompt,
  validateImageInput,
};
