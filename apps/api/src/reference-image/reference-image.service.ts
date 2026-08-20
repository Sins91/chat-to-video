import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  CreateReferenceImageUploadResponseSchema,
  ReferenceImageDeclarationSchema,
  ReferenceImageProbeJobPayloadSchema,
  ReferenceImageMimeTypeSchema,
  ReferenceImageCleanupJobPayloadSchema,
  ReferenceImageResolutionSchema,
  ReferenceImageViewSchema,
  type ReferenceImageAnalysis,
  type ReferenceImageDeclaration,
  type ReferenceImagePurpose,
  type ReferenceImageResolution,
  type UpdateReferenceImagePurposeRequest,
  type CreateReferenceImageUploadRequest,
  type CreateReferenceImageUploadResponse,
  type ReferenceImageView,
} from "@chat-to-video/contracts";
import type { ReferenceImageRepository, ReferenceImageRow } from "@chat-to-video/database";
import { ObjectStorage } from "@chat-to-video/storage";
import { Queue } from "bullmq";
import { randomUUID } from "node:crypto";

import { createObservedRedisClient } from "../redis-client.js";
import { loadRedisUrl, loadStorageConfig } from "../video-workflow/video-workflow.config.js";
import { REFERENCE_IMAGE_REPOSITORY } from "../video-workflow/video-workflow.tokens.js";
import { MODEL_GATEWAY, type ModelGateway } from "../model-gateway/model-gateway.js";

const DEMO_TENANT_ID = "demo";
const DEMO_PROJECT_ID = "demo";
const UPLOAD_TTL_SECONDS = 600;
const AUTO_RESOLUTION_CONFIDENCE = 0.8;
const RESOLUTION_TTL_MS = 24 * 60 * 60 * 1_000;

const PURPOSE_ALIASES: ReadonlyArray<readonly [ReferenceImagePurpose, readonly string[]]> = [
  ["character", ["人物", "角色", "人像", "character"]],
  ["product", ["产品", "商品", "包装", "product"]],
  ["environment", ["场景", "环境", "地点", "空间", "environment", "scene"]],
  ["element", ["元素", "道具", "服装", "配饰", "element", "prop", "costume"]],
  ["style", ["风格", "色调", "画风", "构图", "style"]],
];
const PURPOSE_LABELS: Readonly<Record<ReferenceImagePurpose, string>> = {
  character: "人物参考",
  product: "产品参考",
  environment: "场景参考",
  element: "元素参考",
  style: "风格参考",
};

const findDeclaredPurpose = (text: string): ReferenceImagePurpose | null => {
  const normalized = text.normalize("NFKC").toLowerCase();
  for (const [purpose, aliases] of PURPOSE_ALIASES) {
    if (aliases.some((alias) => normalized.includes(alias))) return purpose;
  }
  return null;
};

export const parseReferenceImageMessageDeclarations = (
  text: string,
  imageIds: readonly string[],
): Map<string, ReferenceImageDeclaration> => {
  const declarations = new Map<string, ReferenceImageDeclaration>();
  if (imageIds.length === 1) {
    const purpose = findDeclaredPurpose(text);
    const id = imageIds[0];
    if (purpose && id) declarations.set(id, { purpose, label: PURPOSE_LABELS[purpose], sceneOrders: [] });
    return declarations;
  }
  const sharedPurpose = findDeclaredPurpose(text);
  if (sharedPurpose && /(?:全部|所有|这些|以上)(?:参考)?(?:图|图片)/u.test(text)) {
    for (const id of imageIds) {
      declarations.set(id, {
        purpose: sharedPurpose,
        label: PURPOSE_LABELS[sharedPurpose],
        sceneOrders: [],
      });
    }
    return declarations;
  }
  imageIds.forEach((id, index) => {
    const order = index + 1;
    const marker = new RegExp(`(?:第\\s*${order}\\s*张|图(?:片)?\\s*${order})([\\s\\S]{0,80})`, "iu");
    const segment = marker.exec(text)?.[1];
    const purpose = segment ? findDeclaredPurpose(segment) : null;
    if (purpose) declarations.set(id, { purpose, label: PURPOSE_LABELS[purpose], sceneOrders: [] });
  });
  return declarations;
};

export const resolveReferenceImageAnalysis = (input: {
  analysis: ReferenceImageAnalysis;
  declaration: ReferenceImageDeclaration | null;
  declarationSource: "upload" | "message" | null;
}): ReferenceImageResolution => {
  if (input.analysis.containsSensitiveContent) {
    return ReferenceImageResolutionSchema.parse({
      referenceImageId: input.analysis.referenceImageId,
      resolutionRequestId: null,
      effectivePurpose: null,
      effectiveLabel: input.analysis.label,
      source: input.declarationSource ?? "model",
      status: "blocked",
      reason: "sensitive_content",
      confidence: input.analysis.confidence,
    });
  }
  if (input.declaration) {
    return ReferenceImageResolutionSchema.parse({
      referenceImageId: input.analysis.referenceImageId,
      resolutionRequestId: null,
      effectivePurpose: input.declaration.purpose,
      effectiveLabel: input.declaration.label,
      source: input.declarationSource,
      status: "user_resolved",
      reason: input.declarationSource === "upload" ? "upload_declaration" : "message_declaration",
      confidence: input.analysis.confidence,
    });
  }
  const isConfident = input.analysis.purpose !== null &&
    input.analysis.confidence >= AUTO_RESOLUTION_CONFIDENCE;
  return ReferenceImageResolutionSchema.parse({
    referenceImageId: input.analysis.referenceImageId,
    resolutionRequestId: null,
    effectivePurpose: isConfident ? input.analysis.purpose : null,
    effectiveLabel: input.analysis.label,
    source: "model",
    status: isConfident ? "auto_resolved" : "needs_clarification",
    reason: isConfident
      ? "model_confident"
      : input.analysis.purpose === null ? "purpose_unknown" : "low_confidence",
    confidence: input.analysis.confidence,
  });
};

const extensionForMime = (mimeType: CreateReferenceImageUploadRequest["mimeType"]): string =>
  mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";

@Injectable()
export class ReferenceImageService implements OnModuleDestroy {
  private readonly storage = new ObjectStorage(loadStorageConfig());
  private readonly queueConnection = createObservedRedisClient(
    loadRedisUrl(),
    ReferenceImageService.name,
    "api-reference-image-queue",
    { maxRetriesPerRequest: 1 },
  );
  private readonly probeQueue = new Queue("media-probe-jobs", { connection: this.queueConnection });
  private readonly cleanupQueue = new Queue("cleanup-jobs", { connection: this.queueConnection });

  constructor(
    @Inject(REFERENCE_IMAGE_REPOSITORY) private readonly repository: ReferenceImageRepository,
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
  ) {}

  private async view(row: ReferenceImageRow): Promise<ReferenceImageView> {
    return ReferenceImageViewSchema.parse({
      id: row.id,
      fileName: row.fileName,
      mimeType: ReferenceImageMimeTypeSchema.parse(row.mimeType ?? row.declaredMimeType),
      sizeBytes: row.sizeBytes ?? row.declaredSizeBytes,
      width: row.width,
      height: row.height,
      status: row.status,
      declaration: row.declaration,
      analysis: row.analysis,
      resolution: row.resolution,
      previewUrl: row.status === "ready" ? await this.storage.createDownloadUrl(row.objectKey) : null,
    });
  }

  async createUpload(input: CreateReferenceImageUploadRequest): Promise<CreateReferenceImageUploadResponse> {
    const id = randomUUID();
    const objectKey = `tenant/${DEMO_TENANT_ID}/project/${DEMO_PROJECT_ID}/source/${id}/reference.${extensionForMime(input.mimeType)}`;
    await this.repository.create({
      id,
      tenantId: DEMO_TENANT_ID,
      projectId: DEMO_PROJECT_ID,
      objectKey,
      fileName: input.fileName,
      declaredMimeType: input.mimeType,
      declaredSizeBytes: input.sizeBytes,
      declaration: input.declaration,
    });
    const row = await this.repository.findScoped(id, DEMO_TENANT_ID, DEMO_PROJECT_ID);
    if (!row) throw new Error("Reference image upload was not persisted.");
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1_000).toISOString();
    return CreateReferenceImageUploadResponseSchema.parse({
      referenceImage: await this.view(row),
      uploadUrl: await this.storage.createUploadUrl(objectKey, input.mimeType, UPLOAD_TTL_SECONDS),
      expiresAt,
    });
  }

  async complete(id: string): Promise<void> {
    const row = await this.repository.findScoped(id, DEMO_TENANT_ID, DEMO_PROJECT_ID);
    if (!row) throw new BadRequestException({ code: "REFERENCE_IMAGE_NOT_FOUND", message: "参考图不存在。" });
    if (row.status === "ready" || row.status === "validating") return;
    if (row.status !== "pending_upload") {
      throw new BadRequestException({ code: "REFERENCE_IMAGE_NOT_UPLOADABLE", message: "参考图当前状态不可提交。" });
    }
    const object = await this.storage.statObject(row.objectKey).catch(() => null);
    if (!object || object.contentLength !== row.declaredSizeBytes || object.contentLength <= 0) {
      await this.repository.markRejected(id, "UPLOAD_SIZE_MISMATCH");
      throw new BadRequestException({ code: "REFERENCE_IMAGE_UPLOAD_INVALID", message: "参考图上传结果无效。" });
    }
    if (!await this.repository.markValidating(id)) return;
    const payload = ReferenceImageProbeJobPayloadSchema.parse({
      referenceImageId: id,
      objectKey: row.objectKey,
      declaredMimeType: row.declaredMimeType,
      declaredSizeBytes: row.declaredSizeBytes,
    });
    await this.probeQueue.add("probe-reference-image", payload, {
      jobId: id,
      attempts: 2,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  async get(id: string): Promise<ReferenceImageView> {
    const row = await this.repository.findScoped(id, DEMO_TENANT_ID, DEMO_PROJECT_ID);
    if (!row) throw new BadRequestException({ code: "REFERENCE_IMAGE_NOT_FOUND", message: "参考图不存在。" });
    return this.view(row);
  }

  findRow(id: string) {
    return this.repository.findScoped(id, DEMO_TENANT_ID, DEMO_PROJECT_ID);
  }

  async updatePurpose(id: string, input: UpdateReferenceImagePurposeRequest): Promise<ReferenceImageView> {
    const row = await this.repository.findScoped(id, DEMO_TENANT_ID, DEMO_PROJECT_ID);
    if (!row || row.status !== "ready") {
      throw new BadRequestException({ code: "REFERENCE_IMAGE_NOT_READY", message: "参考图尚未完成校验。" });
    }
    if (row.resolution?.reason === "sensitive_content") {
      throw new BadRequestException({ code: "REFERENCE_RESOLUTION_BLOCKED", message: "该参考图不能用于生成。" });
    }
    const declaration = ReferenceImageDeclarationSchema.parse({
      purpose: input.purpose,
      label: input.label ?? row.analysis?.label ?? PURPOSE_LABELS[input.purpose],
      sceneOrders: input.sceneOrders ?? [],
    });
    await this.repository.saveDeclarationAndResolution({
      id,
      declaration,
      resolution: ReferenceImageResolutionSchema.parse({
        referenceImageId: id,
        resolutionRequestId: row.resolution?.resolutionRequestId ?? null,
        effectivePurpose: declaration.purpose,
        effectiveLabel: declaration.label,
        source: "message",
        status: "user_resolved",
        reason: "message_declaration",
        confidence: row.analysis?.confidence ?? null,
      }),
    });
    const updated = await this.repository.findScoped(id, DEMO_TENANT_ID, DEMO_PROJECT_ID);
    if (!updated) throw new Error("Updated reference image disappeared.");
    return this.view(updated);
  }

  async abandon(id: string): Promise<void> {
    const row = await this.repository.findScoped(id, DEMO_TENANT_ID, DEMO_PROJECT_ID);
    if (!row) return;
    if (!await this.repository.markAbandoned(id, DEMO_TENANT_ID, DEMO_PROJECT_ID)) {
      throw new BadRequestException({ code: "REFERENCE_IMAGE_ALREADY_BOUND", message: "已发送的参考图不能移除。" });
    }
    const payload = ReferenceImageCleanupJobPayloadSchema.parse({
      kind: "reference_image",
      referenceImageId: id,
      objectKey: row.objectKey,
    });
    await this.cleanupQueue.add("cleanup-reference-image", payload, {
      jobId: `cleanup-reference-${id}`,
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  async readyRows(ids: readonly string[]) {
    const rows = await this.repository.listScoped(ids, DEMO_TENANT_ID, DEMO_PROJECT_ID);
    if (rows.length !== ids.length || rows.some((row) => row.status !== "ready")) {
      throw new BadRequestException({ code: "REFERENCE_IMAGE_NOT_READY", message: "参考图尚未完成校验。" });
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => {
      const row = byId.get(id);
      if (!row) throw new Error("Validated reference image disappeared.");
      return row;
    });
  }

  async modelParts(ids: readonly string[]) {
    const rows = await this.readyRows(ids);
    return Promise.all(rows.map(async (row) => ({
      type: "image" as const,
      referenceImageId: row.id,
      mimeType: ReferenceImageMimeTypeSchema.parse(row.mimeType ?? row.declaredMimeType),
      url: await this.storage.createDownloadUrl(row.objectKey, 600),
    })));
  }

  async modelMessages(conversationId: string, messages: readonly { messageId: string; role: string; content: string }[]) {
    const rows = await this.repository.listForConversation(conversationId);
    const rowsByMessage = new Map<string, ReferenceImageRow[]>();
    for (const row of rows) {
      if (!row.messageId || row.status !== "ready") continue;
      const current = rowsByMessage.get(row.messageId) ?? [];
      current.push(row);
      rowsByMessage.set(row.messageId, current);
    }
    return Promise.all(messages.slice(-50).map(async (message) => {
      const imageRows = rowsByMessage.get(message.messageId) ?? [];
      if (message.role === "assistant" || imageRows.length === 0) {
        return { role: message.role as "user" | "assistant", content: message.content };
      }
      const text = message.content.trim() || "分析这些图片并识别可用于视频制作的一致性参考。";
      return {
        role: "user" as const,
        content: [
          { type: "text" as const, text },
          ...await Promise.all(imageRows.map(async (row) => ({
            type: "image" as const,
            referenceImageId: row.id,
            mimeType: ReferenceImageMimeTypeSchema.parse(row.mimeType ?? row.declaredMimeType),
            url: await this.storage.createDownloadUrl(row.objectKey, 600),
          }))),
        ],
      };
    }));
  }

  listForWorkflow(workflowId: string) {
    return this.repository.listForWorkflow(workflowId);
  }

  async workflowModelInputs(workflowId: string) {
    const rows = await this.repository.listForWorkflow(workflowId);
    return rows.flatMap((row) => row.analysis &&
      (row.resolution?.status === "auto_resolved" || row.resolution?.status === "user_resolved") ? [{
      id: row.id,
      analysis: row.analysis,
      declaration: row.declaration,
    }] : []);
  }

  async listForConversation(conversationId: string): Promise<Map<string, ReferenceImageView[]>> {
    const rows = await this.repository.listForConversation(conversationId);
    const entries = await Promise.all(rows.filter((row) => row.messageId !== null).map(async (row) => ({
      messageId: row.messageId,
      view: await this.view(row),
    })));
    const byMessage = new Map<string, ReferenceImageView[]>();
    for (const entry of entries) {
      if (!entry.messageId) continue;
      const current = byMessage.get(entry.messageId) ?? [];
      current.push(entry.view);
      byMessage.set(entry.messageId, current);
    }
    return byMessage;
  }

  async resolvedUnboundRowsForConversation(conversationId: string) {
    const rows = await this.repository.listForConversation(conversationId);
    return rows.filter((row) => row.workflowId === null &&
      (row.resolution?.status === "auto_resolved" || row.resolution?.status === "user_resolved"));
  }

  async bindToMessage(input: { ids: readonly string[]; conversationId: string; messageId: string; workflowId?: string }) {
    await this.repository.bindToMessage({
      ...input,
      tenantId: DEMO_TENANT_ID,
      projectId: DEMO_PROJECT_ID,
    });
  }

  async bindResolvedToWorkflow(input: { ids: readonly string[]; conversationId: string; workflowId: string }) {
    await this.repository.bindResolvedToWorkflow({
      ...input,
      tenantId: DEMO_TENANT_ID,
      projectId: DEMO_PROJECT_ID,
    });
  }

  async analyze(input: {
    ids: readonly string[];
    requestId: string;
    conversationId: string;
    tenantId: string;
    projectId: string;
    userText: string;
  }) {
    if (input.ids.length === 0) return [];
    const rows = await this.readyRows(input.ids);
    const messageDeclarations = parseReferenceImageMessageDeclarations(input.userText, input.ids);
    const declarations = new Map(rows.map((row) => [
      row.id,
      row.declaration ?? messageDeclarations.get(row.id) ?? null,
    ]));
    const rowsNeedingAnalysis = rows.filter((row) => row.analysis === null);
    const generatedAnalyses = rowsNeedingAnalysis.length === 0 ? [] :
      await this.modelGateway.analyzeReferenceImages({
        requestId: input.requestId,
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        userText: input.userText,
        images: await Promise.all(rowsNeedingAnalysis.map(async (row) => ({
        id: row.id,
        url: await this.storage.createDownloadUrl(row.objectKey, 600),
        mimeType: ReferenceImageViewSchema.parse({
          id: row.id,
          fileName: row.fileName,
          mimeType: ReferenceImageMimeTypeSchema.parse(row.mimeType ?? row.declaredMimeType),
          sizeBytes: row.sizeBytes ?? row.declaredSizeBytes,
          width: row.width,
          height: row.height,
          status: row.status,
          declaration: row.declaration,
          analysis: row.analysis,
          previewUrl: null,
        }).mimeType,
        declaration: declarations.get(row.id) ?? null,
      }))),
      });
    const generatedById = new Map(generatedAnalyses.map((analysis) => [analysis.referenceImageId, analysis]));
    const hasUnmappedMultiImageDeclaration = rows.length > 1 &&
      findDeclaredPurpose(input.userText) !== null &&
      messageDeclarations.size < rows.length;
    const analyses = rows.map((row) => row.analysis ?? generatedById.get(row.id)).filter(
      (analysis): analysis is ReferenceImageAnalysis => analysis !== undefined,
    );
    if (analyses.length !== rows.length) throw new Error("REFERENCE_IMAGE_ANALYSIS_INCOMPLETE");
    const resolutions = rows.map((row) => {
      const analysis = row.analysis ?? generatedById.get(row.id);
      if (!analysis) throw new Error(`REFERENCE_IMAGE_ANALYSIS_MISSING:${row.id}`);
      const messageDeclaration = messageDeclarations.get(analysis.referenceImageId) ?? null;
      if (hasUnmappedMultiImageDeclaration && !messageDeclaration && !row.declaration &&
          !analysis.containsSensitiveContent) {
        return ReferenceImageResolutionSchema.parse({
          referenceImageId: analysis.referenceImageId,
          resolutionRequestId: null,
          effectivePurpose: null,
          effectiveLabel: analysis.label,
          source: "message",
          status: "needs_clarification",
          reason: "ambiguous_mapping",
          confidence: analysis.confidence,
        });
      }
      return resolveReferenceImageAnalysis({
        analysis,
        declaration: row.declaration ?? messageDeclaration,
        declarationSource: row.declaration ? "upload" : messageDeclaration ? "message" : null,
      });
    });
    await Promise.all(rows.map(async (row, index) => {
      const analysis = row.analysis ?? generatedById.get(row.id);
      const resolution = resolutions[index];
      if (!analysis || !resolution) return;
      if (!row.analysis) await this.repository.saveAnalysis(analysis.referenceImageId, analysis);
      const messageDeclaration = messageDeclarations.get(row.id);
      if (messageDeclaration) {
        await this.repository.saveDeclarationAndResolution({
          id: analysis.referenceImageId,
          declaration: messageDeclaration,
          resolution,
        });
      } else {
        await this.repository.saveResolution(analysis.referenceImageId, resolution);
      }
    }));
    return resolutions;
  }

  async markAnalysisFailed(ids: readonly string[]): Promise<ReferenceImageResolution[]> {
    const resolutions = ids.map((id) => ReferenceImageResolutionSchema.parse({
      referenceImageId: id,
      resolutionRequestId: null,
      effectivePurpose: null,
      effectiveLabel: null,
      source: "model",
      status: "needs_clarification",
      reason: "analysis_failed",
      confidence: null,
    }));
    await Promise.all(resolutions.map((resolution) =>
      this.repository.saveResolution(resolution.referenceImageId, resolution)
    ));
    return resolutions;
  }

  async createResolutionRequest(input: {
    conversationId: string;
    messageId: string;
    workflowId: string | null;
    workflowVersion: number | null;
    originalText: string;
    referenceImageIds: string[];
    videoModel: "doubao-seedance-2.0" | "MiniMax-Hailuo-2.3";
  }) {
    const request = await this.repository.createResolutionRequest({
      id: randomUUID(),
      ...input,
      expiresAt: new Date(Date.now() + RESOLUTION_TTL_MS),
    });
    if (!request) throw new Error("Reference image resolution request was not persisted.");
    const rows = await this.readyRows(request.referenceImageIds);
    await Promise.all(rows.flatMap((row) => row.resolution?.status === "needs_clarification" ? [
      this.repository.saveResolution(row.id, ReferenceImageResolutionSchema.parse({
        ...row.resolution,
        resolutionRequestId: request.id,
      })),
    ] : []));
    return {
      request,
      referenceImages: await Promise.all((await this.readyRows(request.referenceImageIds)).map((row) => this.view(row))),
    };
  }

  async confirmResolutions(input: {
    resolutionRequestId: string;
    resolutions: ReadonlyArray<{
      referenceImageId: string;
      purpose: ReferenceImagePurpose;
      label?: string;
      sceneOrders?: number[];
    }>;
  }) {
    const request = await this.repository.findResolutionRequest(input.resolutionRequestId);
    if (!request) throw new BadRequestException({ code: "REFERENCE_RESOLUTION_NOT_FOUND", message: "参考图确认请求不存在。" });
    if (request.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: "REFERENCE_RESOLUTION_EXPIRED", message: "参考图确认请求已过期，请重新发送。" });
    }
    const allowedIds = new Set(request.referenceImageIds);
    if (input.resolutions.some((resolution) => !allowedIds.has(resolution.referenceImageId))) {
      throw new BadRequestException({ code: "REFERENCE_RESOLUTION_INVALID", message: "参考图确认内容无效。" });
    }
    const selectedRows = await Promise.all(input.resolutions.map((choice) =>
      this.repository.findScoped(choice.referenceImageId, DEMO_TENANT_ID, DEMO_PROJECT_ID)
    ));
    if (selectedRows.some((row) => row === null)) {
      throw new BadRequestException({ code: "REFERENCE_RESOLUTION_INVALID", message: "参考图确认内容无效。" });
    }
    if (selectedRows.some((row) => row?.analysis === null)) {
      const retryText = input.resolutions.map((choice) => {
        const imageIndex = request.referenceImageIds.indexOf(choice.referenceImageId) + 1;
        return `图${imageIndex}作为${PURPOSE_LABELS[choice.purpose]}`;
      }).join("，");
      try {
        await this.analyze({
          ids: request.referenceImageIds,
          requestId: randomUUID(),
          conversationId: request.conversationId,
          tenantId: DEMO_TENANT_ID,
          projectId: DEMO_PROJECT_ID,
          userText: retryText,
        });
      } catch {
        throw new ServiceUnavailableException({
          code: "REFERENCE_IMAGE_UNDERSTANDING_UNAVAILABLE",
          message: "图片理解能力暂时不可用，参考图已保留，请稍后重试确认。",
        });
      }
    }
    await Promise.all(input.resolutions.map(async (choice) => {
      const row = await this.repository.findScoped(choice.referenceImageId, DEMO_TENANT_ID, DEMO_PROJECT_ID);
      if (!row || row.resolution?.reason === "sensitive_content") {
        throw new BadRequestException({ code: "REFERENCE_RESOLUTION_BLOCKED", message: "该参考图不能用于生成。" });
      }
      const declaration = ReferenceImageDeclarationSchema.parse({
        purpose: choice.purpose,
        label: choice.label ?? row.analysis?.label ?? PURPOSE_LABELS[choice.purpose],
        sceneOrders: choice.sceneOrders ?? [],
      });
      await this.repository.saveDeclarationAndResolution({
        id: row.id,
        declaration,
        resolution: ReferenceImageResolutionSchema.parse({
          referenceImageId: row.id,
          resolutionRequestId: request.id,
          effectivePurpose: declaration.purpose,
          effectiveLabel: declaration.label,
          source: "message",
          status: "user_resolved",
          reason: "message_declaration",
          confidence: row.analysis?.confidence ?? null,
        }),
      });
    }));
    const rows = await this.readyRows(request.referenceImageIds);
    const isComplete = rows.every((row) =>
      row.resolution?.status === "auto_resolved" || row.resolution?.status === "user_resolved"
    );
    if (isComplete) await this.repository.markResolutionRequestResolved(request.id);
    return { request, isComplete, referenceImages: await Promise.all(rows.map((row) => this.view(row))) };
  }

  findResolutionRequest(id: string) {
    return this.repository.findResolutionRequest(id);
  }

  async pendingResolutionFromText(conversationId: string, text: string) {
    const request = await this.repository.findPendingResolutionRequest(conversationId);
    if (!request || request.expiresAt.getTime() <= Date.now()) return null;
    const declarations = parseReferenceImageMessageDeclarations(text, request.referenceImageIds);
    if (declarations.size === 0) return null;
    return {
      resolutionRequestId: request.id,
      resolutions: [...declarations].map(([referenceImageId, declaration]) => ({
        referenceImageId,
        purpose: declaration.purpose,
        label: declaration.label,
        sceneOrders: declaration.sceneOrders,
      })),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.probeQueue.close();
    await this.cleanupQueue.close();
    await this.queueConnection.quit();
  }
}
