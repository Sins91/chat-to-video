import {
  extractVideoOutputResolutionUpdate,
  getWorkflowStageIndex,
  getStandaloneVideoOutputResolutionUpdate,
  getVideoWorkflowIntentHint,
  findWorkflowStage,
  parseWorkflowRestartTarget,
  WorkflowIntentDecisionSchema,
  type WorkflowIntentDecision,
  type WorkflowPipelineDefinition,
  type WorkflowStageId,
} from "@chat-to-video/contracts";
import { Inject, Injectable } from "@nestjs/common";

import { MODEL_GATEWAY, type ModelGateway } from "../model-gateway/model-gateway.js";
import { classifyApprovalIntent } from "./approval-intent.js";

export const WORKFLOW_INTENT_RESOLVER_VERSION = "v2";
export const WORKFLOW_INTENT_CLARIFICATION_GUIDANCE =
  "我暂时无法准确判断你的操作意图。若要同意当前内容，请回复“好的”“可以”或“行”；" +
  "若要修改当前内容，请直接说明具体修改要求。";

const createClarificationGuidance = (context: ResolveContext): string => {
  const stageLabel = findWorkflowStage(context.pipeline, context.currentStage)?.label ?? context.currentStage;
  return `当前正在审核“${stageLabel}”。${WORKFLOW_INTENT_CLARIFICATION_GUIDANCE}`;
};

const addClarificationGuidance = (question: string, context: ResolveContext): string => {
  const guidance = createClarificationGuidance(context);
  return question === guidance
    ? question
    : `${question.slice(0, 500 - guidance.length - 2)}\n\n${guidance}`;
};

const QUESTION_PATTERN = /[?？]\s*$|(?:为什么|怎么|怎样|如何|什么|哪些|哪里|哪种|多少|是否|是不是|有没有|能否介绍|解释一下)/u;
const CANCEL_PATTERN = /^(?:算了|不做了|停止|终止|取消)(?:任务|工作流|生成|制作|视频)?[。！!]?$/u;
const APPROVE_WITH_CHANGES_PATTERN = /^(?:可以|行|同意|通过|没问题).{0,40}(?:但是|但|不过|同时|然后|并且).+/u;
const DIRECTION_SELECTION_PATTERN = /(?:(?:选择|选用|采用|使用|用|按|按照).{0,80}(?:方案|方向|版本)|(?:第?[一二三123]个?)(?:方案|方向|版本))/u;
const EXPLICIT_ADVANCE_PATTERN = /(?:直接|继续|然后|随后|并且|并|再)?.{0,20}(?:进行到|进入|推进到|转到|继续到|开始)?(?:下一步|下一个阶段|下一阶段)|(?:继续|推进)(?:制作|生成|创作)?$/u;
const REVISION_ACTION_PATTERN = /(?:修改|调整|改成|改为|换成|替换(?:成|为)?|删掉|删除|去掉|移除|增加|新增|添加|补充|保留|重写|优化|缩短|延长|合并|拆分)/u;
const VAGUE_REVISION_PATTERN = /^(?:(?:我)?(?:想|希望|需要|要|请|麻烦)?\s*)?(?:修改|调整|改|优化)(?:一下|下)?(?:现有的?|当前的?|这个|这版)?(?:内容|方案)?[。！!]?(?:可以吗)?$/u;

type ResolveContext = {
  requestId: string;
  workflowId: string;
  conversationId: string;
  tenantId: string;
  projectId: string;
  workflowStatus: string;
  currentStage: WorkflowStageId;
  currentVersion: number;
  currentArtifactSummary: string;
  pipeline: WorkflowPipelineDefinition;
  text: string;
};

@Injectable()
export class UserIntentResolverService {
  constructor(
    @Inject(MODEL_GATEWAY) private readonly modelGateway: ModelGateway,
  ) {}

  private canAutoAdvanceAfterChange(context: ResolveContext, text: string): boolean {
    return findWorkflowStage(context.pipeline, context.currentStage)?.allowsAutoAdvanceAfterRevision === true &&
      DIRECTION_SELECTION_PATTERN.test(text) && EXPLICIT_ADVANCE_PATTERN.test(text);
  }

  private mentionsEarlierStage(context: ResolveContext, text: string): boolean {
    const currentStageIndex = getWorkflowStageIndex(context.pipeline, context.currentStage);
    const normalized = text.normalize("NFKC").toLocaleLowerCase("en-US");
    return context.pipeline.stages.slice(0, Math.max(0, currentStageIndex)).some((stage) =>
      [stage.label, ...stage.aliases].some((alias) =>
        normalized.includes(alias.normalize("NFKC").toLocaleLowerCase("en-US")),
      ),
    );
  }

  private revisionRuleDecision(
    context: ResolveContext,
    text: string,
    outputResolution?: ReturnType<typeof getStandaloneVideoOutputResolutionUpdate>,
  ): WorkflowIntentDecision | null {
    const currentStage = findWorkflowStage(context.pipeline, context.currentStage);
    if (!currentStage?.allowsRevision || this.mentionsEarlierStage(context, text)) return null;
    if (VAGUE_REVISION_PATTERN.test(text)) {
      return WorkflowIntentDecisionSchema.parse({
        intent: {
          type: "clarify",
          question: `当前正在审核“${currentStage.label}”。请说明要修改的具体内容。`,
        },
        source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    if (!REVISION_ACTION_PATTERN.test(text)) return null;
    return WorkflowIntentDecisionSchema.parse({
      intent: {
        type: "revise_current",
        stageId: context.currentStage,
        feedback: text,
        ...(outputResolution ? { outputResolution } : {}),
      },
      source: "rule",
      resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
      requiresConfirmation: false,
    });
  }

  private ruleDecision(context: ResolveContext): WorkflowIntentDecision | null {
    const originalText = context.text.normalize("NFKC").trim();
    const extractedResolution = extractVideoOutputResolutionUpdate(originalText);
    const text = extractedResolution?.remainingText || originalText;
    const outputResolution = getStandaloneVideoOutputResolutionUpdate(originalText);
    if (context.workflowStatus === "awaiting_input" && outputResolution) {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "update_output_resolution", resolution: outputResolution },
        source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    if (QUESTION_PATTERN.test(text)) {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "chat" }, source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION, requiresConfirmation: false,
      });
    }
    if (CANCEL_PATTERN.test(text)) {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "cancel", reason: text }, source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION, requiresConfirmation: true,
      });
    }
    if (this.canAutoAdvanceAfterChange(context, text)) {
      return WorkflowIntentDecisionSchema.parse({
        intent: {
          type: "approve_with_changes", stageId: context.currentStage,
          feedback: text, advanceAfterChange: true,
          ...(extractedResolution ? { outputResolution: extractedResolution.resolution } : {}),
        },
        source: "rule", resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    if (findWorkflowStage(context.pipeline, context.currentStage)?.allowsRevision === true &&
        APPROVE_WITH_CHANGES_PATTERN.test(text)) {
      return WorkflowIntentDecisionSchema.parse({
        intent: {
          type: "approve_with_changes", stageId: context.currentStage,
          feedback: text, advanceAfterChange: false,
          ...(extractedResolution ? { outputResolution: extractedResolution.resolution } : {}),
        },
        source: "rule", resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    if (classifyApprovalIntent(text) === "approve") {
      return WorkflowIntentDecisionSchema.parse({
        intent: {
          type: "approve",
          stageId: context.currentStage,
          ...(extractedResolution ? { outputResolution: extractedResolution.resolution } : {}),
        }, source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION, requiresConfirmation: false,
      });
    }
    if (findWorkflowStage(context.pipeline, context.currentStage)?.allowsRevision === true &&
        DIRECTION_SELECTION_PATTERN.test(text)) {
      return WorkflowIntentDecisionSchema.parse({
        intent: {
          type: "revise_current",
          stageId: context.currentStage,
          feedback: text,
          ...(extractedResolution ? { outputResolution: extractedResolution.resolution } : {}),
        },
        source: "rule", resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    return this.revisionRuleDecision(context, text, extractedResolution?.resolution);
  }

  async resolve(context: ResolveContext): Promise<WorkflowIntentDecision> {
    const rule = this.ruleDecision(context);
    if (rule) return rule;
    const extractedResolution = extractVideoOutputResolutionUpdate(context.text);
    const effectiveText = extractedResolution?.remainingText || context.text;
    try {
      const classified = await this.modelGateway.classifyWorkflowIntent({
        requestId: context.requestId,
        workflowId: context.workflowId,
        conversationId: context.conversationId,
        tenantId: context.tenantId,
        projectId: context.projectId,
        userMessage: effectiveText,
        workflowStatus: context.workflowStatus,
        currentStage: context.currentStage,
        currentVersion: context.currentVersion,
        currentArtifactSummary: context.currentArtifactSummary,
        stages: context.pipeline.stages.map((stage) => ({
          id: stage.id,
          label: stage.label,
          intentTopics: stage.intentTopics,
          isRestartable: stage.isRestartable,
        })),
      });
      const currentStageIndex = getWorkflowStageIndex(context.pipeline, context.currentStage);
      const intent = (() => {
        if (classified.type === "approve" || classified.type === "revise_current" ||
            classified.type === "approve_with_changes") {
          const currentStage = findWorkflowStage(context.pipeline, context.currentStage);
          const canApplyAtCurrentStage = classified.stageId === context.currentStage &&
            (classified.type === "approve" || currentStage?.allowsRevision === true);
          return canApplyAtCurrentStage
            ? classified.type === "approve_with_changes"
              ? {
                  ...classified,
                  advanceAfterChange: this.canAutoAdvanceAfterChange(context, context.text),
                }
              : classified
            : { type: "clarify" as const, question: "请确认是修改当前阶段，还是返回之前的指定阶段。" };
        }
        if (classified.type === "restart_from") {
          const target = parseWorkflowRestartTarget(context.pipeline, classified.stageId);
          const targetIndex = target ? getWorkflowStageIndex(context.pipeline, target.id) : -1;
          return target && targetIndex >= 0 && targetIndex <= currentStageIndex
            ? classified
            : { type: "clarify" as const, question: "请选择当前或更早的可重启阶段。" };
        }
        if (classified.type === "start_workflow") {
          return { type: "clarify" as const, question: "当前已有工作流，请先完成、取消或明确返回某个阶段。" };
        }
        return classified;
      })();
      const intentWithResolution = extractedResolution &&
          (intent.type === "approve" || intent.type === "revise_current" || intent.type === "approve_with_changes")
        ? { ...intent, outputResolution: extractedResolution.resolution }
        : intent;
      const guidedIntent = intentWithResolution.type === "clarify"
        ? { ...intentWithResolution, question: addClarificationGuidance(intentWithResolution.question, context) }
        : intentWithResolution;
      return WorkflowIntentDecisionSchema.parse({
        intent: guidedIntent,
        source: "model",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: guidedIntent.type === "restart_from" || guidedIntent.type === "cancel",
      });
    } catch {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "clarify", question: createClarificationGuidance(context) },
        source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
  }

  async resolveTerminal(context: ResolveContext): Promise<WorkflowIntentDecision> {
    const text = context.text.normalize("NFKC").trim();
    const hint = getVideoWorkflowIntentHint(text);
    if (hint === "workflow") {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "start_workflow", pipelineId: context.pipeline.id, brief: text },
        source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    if (hint === "chat") {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "chat" },
        source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    try {
      const classified = await this.modelGateway.classifyWorkflowIntent({
        requestId: context.requestId,
        workflowId: context.workflowId,
        conversationId: context.conversationId,
        tenantId: context.tenantId,
        projectId: context.projectId,
        userMessage: text,
        workflowStatus: context.workflowStatus,
        currentStage: context.currentStage,
        currentVersion: context.currentVersion,
        currentArtifactSummary: context.currentArtifactSummary,
        stages: context.pipeline.stages.map((stage) => ({
          id: stage.id,
          label: stage.label,
          intentTopics: stage.intentTopics,
          isRestartable: stage.isRestartable,
        })),
      });
      return WorkflowIntentDecisionSchema.parse({
        intent: classified.type === "start_workflow" ? classified : { type: "chat" },
        source: "model",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    } catch {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "chat" },
        source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
  }
}
