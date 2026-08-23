import type {
  ChatAgentMessage,
  CinematicArtifact,
  CinematicGenerativeStage,
  VideoModel,
  WorkflowToolActivity,
  WorkflowUserIntent,
  WorkflowStageId,
  ReferenceImageAnalysis,
  ReferenceImageDeclaration,
} from "@chat-to-video/contracts";
import type { UIMessageChunk } from "ai";

export const MODEL_GATEWAY = Symbol("MODEL_GATEWAY");

export type ChatModelStream = {
  stream: ReadableStream<UIMessageChunk>;
};

export type ModelToolActivity = WorkflowToolActivity & {
  readonly attempt: number;
  readonly activitySequence: number;
};

export type ModelToolActivityCallback =
  (activity: ModelToolActivity) => void | Promise<void>;

export interface ModelGateway {
  analyzeReferenceImages(request: {
    requestId: string;
    conversationId: string;
    tenantId: string;
    projectId: string;
    images: ReadonlyArray<{
      id: string;
      url: string;
      mimeType: "image/jpeg" | "image/png" | "image/webp";
      declaration: ReferenceImageDeclaration | null;
    }>;
    userText: string;
  }): Promise<ReferenceImageAnalysis[]>;
  classifyWorkflowIntent(request: {
    requestId: string;
    workflowId: string;
    conversationId: string;
    tenantId: string;
    projectId: string;
    userMessage: string;
    workflowStatus: string;
    currentStage: WorkflowStageId;
    currentVersion: number;
    currentArtifactSummary: string;
    stages: ReadonlyArray<{
      id: WorkflowStageId;
      label: string;
      intentTopics: readonly string[];
      isRestartable: boolean;
    }>;
  }): Promise<WorkflowUserIntent>;
  inferCinematicDuration(request: {
    requestId: string;
    conversationId: string;
    tenantId: string;
    projectId: string;
    messages: ChatAgentMessage[];
    videoModel: VideoModel;
  }): Promise<number>;
  streamChat(request: {
    abortSignal: AbortSignal;
    requestId: string;
    conversationId: string;
    tenantId: string;
    projectId: string;
    messages: ChatAgentMessage[];
  }): Promise<ChatModelStream>;
  generateCinematicArtifact(request: {
    requestId: string;
    workflowId: string;
    conversationId?: string;
    tenantId: string;
    projectId: string;
    initialPrompt: string;
    subtitlesEnabled?: boolean;
    stage: CinematicGenerativeStage;
    videoModel: VideoModel;
    durationSeconds: number;
    modelMaxDurationSeconds: number;
    previousArtifact?: CinematicArtifact;
    approvedArtifacts: CinematicArtifact[];
    revisionRequest?: string;
    referenceImages?: ReadonlyArray<{
      id: string;
      analysis: ReferenceImageAnalysis;
      declaration: ReferenceImageDeclaration | null;
    }>;
    onToolActivity?: ModelToolActivityCallback;
  }): Promise<CinematicArtifact>;
}

export type ModelGatewayErrorCode =
  | "MODEL_GATEWAY_FAILED"
  | "AGENT_TOOL_CALLING_UNSUPPORTED";

export class ModelGatewayError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions & {
      code?: ModelGatewayErrorCode;
      diagnosticMessage?: string;
      isRetryable?: boolean;
    },
  ) {
    super("The model gateway request failed.", options);
    this.name = "ModelGatewayError";
    this.code = options?.code ?? "MODEL_GATEWAY_FAILED";
    this.diagnosticMessage = options?.diagnosticMessage ?? "上游 LLM 请求失败";
    this.isRetryable = options?.isRetryable ?? true;
  }

  readonly code: ModelGatewayErrorCode;
  readonly diagnosticMessage: string;
  readonly isRetryable: boolean;
}
