import { z } from "zod";

import { CinematicArtifactSchema } from "./cinematic.js";
import { WorkflowUserIntentSchema } from "./user-intent.js";
import {
  getWorkflowStageIndex,
  parseWorkflowDirectEntryTarget,
  parseWorkflowRestartTarget,
  WorkflowPipelineIdSchema,
  WorkflowStageIdSchema,
  type WorkflowPipelineDefinition,
  type WorkflowStageId,
} from "./workflow-pipeline.js";

export const WorkflowControlKindSchema = z.enum([
  "restart_stage",
  "start_from_stage",
  "switch_pipeline",
  "exit_workflow",
]);

export const WorkflowControlStatusSchema = z.enum([
  "pending",
  "claimed",
  "completed",
  "cancelled",
  "expired",
  "failed",
]);

export const WorkflowImportedArtifactCandidateSchema = z.object({
  artifact: CinematicArtifactSchema,
  sourceText: z.string().trim().min(1).max(8_000),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  normalizerVersion: z.string().trim().min(1).max(32),
}).strict();

export const WorkflowControlImpactSchema = z.object({
  skippedStageIds: z.array(WorkflowStageIdSchema).max(100).default([]),
  reusedArtifactKinds: z.array(z.string().trim().min(1).max(64)).max(100).default([]),
  invalidatedStageIds: z.array(WorkflowStageIdSchema).max(100).default([]),
  activeJobCount: z.number().int().nonnegative().max(100_000).default(0),
  summary: z.string().trim().min(1).max(2_000),
}).strict();

export const PendingWorkflowControlSchema = z.object({
  controlRequestId: z.string().uuid(),
  kind: WorkflowControlKindSchema,
  sourceWorkflowId: z.string().uuid().nullable(),
  targetPipelineId: WorkflowPipelineIdSchema.nullable(),
  targetStageId: WorkflowStageIdSchema.nullable(),
  expectedStateVersion: z.number().int().nonnegative(),
  candidate: WorkflowImportedArtifactCandidateSchema.nullable(),
  impact: WorkflowControlImpactSchema,
  requestedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const ResolveVideoWorkflowIntentResponseSchema = z.object({
  accepted: z.literal(true),
  route: z.enum(["workflow", "chat"]),
  applied: z.boolean(),
  intent: WorkflowUserIntentSchema,
  conversationId: z.string().uuid().nullable(),
  workflowId: z.string().uuid().nullable(),
  pendingAction: PendingWorkflowControlSchema.nullable(),
}).strict();

export type WorkflowControlCommand =
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "exit" }
  | { type: "restart_stage"; stageId: WorkflowStageId; text: string }
  | { type: "start_from_stage"; stageId: WorkflowStageId; text: string }
  | { type: "switch_pipeline"; target: string };

const CONTROL_CONFIRMATIONS = new Set([
  "确认", "确定", "执行", "继续", "好的", "可以", "确认执行", "确认切换", "确认退出", "确认开始",
]);
const CONTROL_CANCELLATIONS = new Set([
  "取消", "不执行", "算了", "返回", "取消操作", "取消切换", "取消退出", "取消开始",
]);
const EXIT_PATTERN = /^(?:退出|停止|终止|取消)(?:当前)?(?:视频)?(?:生成|工作流|管线|任务)?$/u;
const SWITCH_PATTERN = /(?:切换|换)(?:到|成)\s*([^，。,.]{1,32})(?:管线|流程)/u;
const RESTART_PATTERN = /(?:回到|返回(?:到)?|退回(?:到)?|回退(?:到)?|跳回(?:到)?|切回(?:到)?|撤回(?:到)?|回滚(?:到)?|重新开始|重新生成|重新做|再次执行|重新执行|重新运行|再做一遍|重做|重跑|重启|restart|start\s+over|go\s+back|return\s+to|roll\s*back|jump\s+back|rewind|re-?run|re-?do|repeat|regenerate|run.{0,40}again|execute.{0,40}again)/iu;
const DIRECT_ENTRY_PATTERN = /(?:直接)?(?:从|由).{0,48}(?:开始|做起|继续|生成)/iu;
const QUESTION_PATTERN = /(?:吗|么|如何|怎么|怎样|能否|能不能|可否|可不可以|是否|行不行|要不要|[?？])/u;

const normalizeControlText = (text: string): string => text.normalize("NFKC").trim();
const normalizeConfirmationText = (text: string): string => normalizeControlText(text)
  .replace(/[\s，。！？!?,.]+/gu, "");

const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const ENGLISH_ORDINALS: Readonly<Record<string, number>> = {
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4,
  five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8,
  nine: 9, ninth: 9, ten: 10, tenth: 10, twenty: 20, twentieth: 20,
};

const parseOrdinal = (value: string): number | null => {
  const normalized = value.toLocaleLowerCase("en-US").replace(/(?:st|nd|rd|th)$/u, "");
  if (/^[1-9]\d*$/u.test(normalized)) return Number(normalized);
  if (ENGLISH_ORDINALS[normalized]) return ENGLISH_ORDINALS[normalized] ?? null;
  if (normalized === "十") return 10;
  if (normalized.startsWith("十")) return 10 + (CHINESE_DIGITS[normalized[1] ?? ""] ?? 0);
  if (normalized.endsWith("十")) return (CHINESE_DIGITS[normalized[0] ?? ""] ?? 0) * 10;
  if (normalized.includes("十")) {
    return (CHINESE_DIGITS[normalized[0] ?? ""] ?? 0) * 10 +
      (CHINESE_DIGITS[normalized[2] ?? ""] ?? 0);
  }
  return CHINESE_DIGITS[normalized] ?? null;
};

const findOrdinal = (text: string): number | null => {
  const token = "[1-9]\\d*(?:st|nd|rd|th)?|[零〇一二两三四五六七八九十]+|" +
    Object.keys(ENGLISH_ORDINALS).join("|");
  const patterns = [
    new RegExp(`第\\s*(${token})\\s*(?:个\\s*)?(?:步骤|步|阶段|环节)`, "iu"),
    new RegExp(`(?:步骤|阶段|环节)\\s*(?:第\\s*)?(${token})`, "iu"),
    new RegExp(`(?:step|stage|phase|checkpoint)\\s*(?:number\\s*|no\\.?\\s*|#\\s*)?(${token})`, "iu"),
    new RegExp(`(?:the\\s+)?(${token})\\s*(?:step|stage|phase|checkpoint)`, "iu"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return parseOrdinal(match[1]);
  }
  return null;
};

const findMentionedStage = (
  text: string,
  pipeline: WorkflowPipelineDefinition,
  mode: "restart" | "direct",
): WorkflowStageId | null => {
  const normalized = text.toLocaleLowerCase("en-US");
  const matches = pipeline.stages.filter((stage) => {
    const isAllowed = mode === "restart"
      ? parseWorkflowRestartTarget(pipeline, stage.id) !== null
      : parseWorkflowDirectEntryTarget(pipeline, stage.id) !== null;
    return isAllowed && [stage.label, ...stage.aliases].some((alias) =>
      normalized.includes(alias.normalize("NFKC").toLocaleLowerCase("en-US")),
    );
  });
  if (matches.length === 1) return matches[0]?.id ?? null;
  const ordinal = findOrdinal(normalized);
  if (!ordinal) return null;
  const stage = pipeline.stages[ordinal - 1];
  if (!stage) return null;
  return mode === "restart"
    ? parseWorkflowRestartTarget(pipeline, stage.id)?.id ?? null
    : parseWorkflowDirectEntryTarget(pipeline, stage.id)?.id ?? null;
};

export const parseWorkflowControlCommand = (
  input: string,
  pipeline: WorkflowPipelineDefinition,
): WorkflowControlCommand | null => {
  const text = normalizeControlText(input);
  if (!text) return null;
  const confirmation = normalizeConfirmationText(text);
  if (CONTROL_CONFIRMATIONS.has(confirmation)) return { type: "confirm" };
  if (CONTROL_CANCELLATIONS.has(confirmation)) return { type: "cancel" };
  if (EXIT_PATTERN.test(confirmation)) return { type: "exit" };
  const switchMatch = SWITCH_PATTERN.exec(text);
  if (switchMatch?.[1]) return { type: "switch_pipeline", target: switchMatch[1].trim() };
  if (!QUESTION_PATTERN.test(text) && RESTART_PATTERN.test(text)) {
    const stageId = findMentionedStage(text, pipeline, "restart");
    if (stageId && getWorkflowStageIndex(pipeline, stageId) >= 0) {
      return { type: "restart_stage", stageId, text };
    }
  }
  if (!QUESTION_PATTERN.test(text) && DIRECT_ENTRY_PATTERN.test(text)) {
    const stageId = findMentionedStage(text, pipeline, "direct");
    if (stageId) return { type: "start_from_stage", stageId, text };
  }
  return null;
};

export type WorkflowControlKind = z.infer<typeof WorkflowControlKindSchema>;
export type WorkflowControlStatus = z.infer<typeof WorkflowControlStatusSchema>;
export type WorkflowImportedArtifactCandidate = z.infer<typeof WorkflowImportedArtifactCandidateSchema>;
export type WorkflowControlImpact = z.infer<typeof WorkflowControlImpactSchema>;
export type PendingWorkflowControl = z.infer<typeof PendingWorkflowControlSchema>;
export type ResolveVideoWorkflowIntentResponse = z.infer<typeof ResolveVideoWorkflowIntentResponseSchema>;
