import {
  getWorkflowStageIndex,
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

export const WORKFLOW_INTENT_RESOLVER_VERSION = "v1";
export const WORKFLOW_INTENT_CLARIFICATION_GUIDANCE =
  "我无法准确理解你的意思。若要表示同意，请回复“好的”“可以”或“行”；" +
  "若要表示不同意或需要修改，请回复“不好”“不行”或“不可以”，也可以直接说明要修改的内容。";

const addClarificationGuidance = (question: string): string =>
  question === WORKFLOW_INTENT_CLARIFICATION_GUIDANCE
    ? question
    : `${question.slice(0, 500 - WORKFLOW_INTENT_CLARIFICATION_GUIDANCE.length - 2)}` +
      `\n\n${WORKFLOW_INTENT_CLARIFICATION_GUIDANCE}`;

const QUESTION_PATTERN = /[?？]\s*$|(?:为什么|怎么|怎样|如何|什么|哪些|哪里|哪种|多少|是否|是不是|有没有|能否介绍|解释一下)/u;
const CANCEL_PATTERN = /^(?:算了|不做了|停止|终止|取消)(?:任务|工作流|生成|制作|视频)?[。！!]?$/u;
const APPROVE_WITH_CHANGES_PATTERN = /^(?:可以|行|同意|通过|没问题).{0,40}(?:但是|但|不过|同时|然后|并且).+/u;
const DIRECTION_SELECTION_PATTERN = /(?:(?:选择|选用|采用|使用|用|按|按照).{0,80}(?:方案|方向|版本)|(?:第?[一二三123]个?)(?:方案|方向|版本))/u;
const EXPLICIT_ADVANCE_PATTERN = /(?:直接|继续|然后|随后|并且|并|再)?.{0,20}(?:进行到|进入|推进到|转到|继续到|开始)?(?:下一步|下一个阶段|下一阶段)|(?:继续|推进)(?:制作|生成|创作)?$/u;

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

  private ruleDecision(context: ResolveContext): WorkflowIntentDecision | null {
    const text = context.text.normalize("NFKC").trim();
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
        },
        source: "rule", resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    if (APPROVE_WITH_CHANGES_PATTERN.test(text)) {
      return WorkflowIntentDecisionSchema.parse({
        intent: {
          type: "approve_with_changes", stageId: context.currentStage,
          feedback: text, advanceAfterChange: false,
        },
        source: "rule", resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    if (classifyApprovalIntent(text) === "approve") {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "approve", stageId: context.currentStage }, source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION, requiresConfirmation: false,
      });
    }
    if (DIRECTION_SELECTION_PATTERN.test(text)) {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "revise_current", stageId: context.currentStage, feedback: text },
        source: "rule", resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
    return null;
  }

  async resolve(context: ResolveContext): Promise<WorkflowIntentDecision> {
    const rule = this.ruleDecision(context);
    if (rule) return rule;
    try {
      const classified = await this.modelGateway.classifyWorkflowIntent({
        requestId: context.requestId,
        workflowId: context.workflowId,
        conversationId: context.conversationId,
        tenantId: context.tenantId,
        projectId: context.projectId,
        userMessage: context.text,
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
          return classified.stageId === context.currentStage
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
      const guidedIntent = intent.type === "clarify"
        ? { ...intent, question: addClarificationGuidance(intent.question) }
        : intent;
      return WorkflowIntentDecisionSchema.parse({
        intent: guidedIntent,
        source: "model",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: guidedIntent.type === "restart_from" || guidedIntent.type === "cancel",
      });
    } catch {
      return WorkflowIntentDecisionSchema.parse({
        intent: { type: "clarify", question: WORKFLOW_INTENT_CLARIFICATION_GUIDANCE },
        source: "rule",
        resolverVersion: WORKFLOW_INTENT_RESOLVER_VERSION,
        requiresConfirmation: false,
      });
    }
  }
}
