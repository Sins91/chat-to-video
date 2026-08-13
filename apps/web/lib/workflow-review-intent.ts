import {
  CINEMATIC_PIPELINE_DEFINITION,
  type WorkflowPipelineDefinition,
  type WorkflowStageId,
} from "@chat-to-video/contracts";

export type WorkflowReviewInputIntent = "approve" | "revise" | "chat";
export type WorkflowRestartConfirmationIntent = "confirm" | "cancel" | "chat";

const APPROVAL_PHRASES = new Set([
  "1",
  "我看行", "我觉得行", "这样行", "这版行",
  "是", "对", "好", "可以", "行", "没错", "正确", "确实", "的确", "当然", "自然", "无疑",
  "一定", "必定", "必然", "势必", "毫无疑问", "毋庸置疑", "千真万确", "确凿无疑", "不容置疑", "确定无疑",
  "同意", "赞成", "认可", "认同", "支持", "赞许", "首肯", "赞同", "通过",
  "嗯", "对啊", "是的", "没问题", "可以的", "当然啦", "行啊", "好的", "收到", "明白", "确认无误", "予以肯定", "表示赞同",
  "肯定", "承认", "证实",
  "继续",
  "可以继续",
  "确认",
  "确认生成",
  "开始生成",
  "生成视频",
  "没问题继续",
  "下一步",
  "继续下一步",
  "进入下一步",
  "下一阶段",
  "下一个阶段",
  "继续下一阶段",
  "继续下一个阶段",
  "进入下一阶段",
  "进入下一个阶段",
  "yes", "yeah", "yep", "right", "correct", "ok", "okay", "sure", "exactly",
  "absolutely", "definitely", "certainly", "definitelyyes", "withoutadoubt", "undoubtedly", "exactlyright", "100%",
  "agree", "iagree", "iapprove", "isupportit", "soundsgood", "thatmakessense", "imwithyou",
  "gotit", "surething", "noproblem", "ofcourse", "yougotit", "forsure", "soundsgreat",
  "affirmative", "confirmed", "acknowledged", "approved", "agreed", "accepted",
]);

const CHINESE_APPROVAL_SENTENCE = /^(?:我)?(?:完全|非常|十分)?(?:同意|赞成|认可|认同|支持|赞同|确认|接受|通过)(?:这个|该)?(?:方案|版本|结果|内容)?(?:了|啦|啊|呀|吧)?(?:请)?(?:继续|进入下一步|开始生成|生成视频)?$/u;
const ENGLISH_APPROVAL_SENTENCE = /^(?:yes|yeah|yep|ok|okay|sure|agreed|approved|accepted|confirmed|affirmative|absolutely|definitely|certainly|exactly|correct|right)(?:please)?(?:proceed|continue|goahead|movetonextstep)?$/u;

const DIRECT_REVISION_REQUEST = /^(?:(?:请|帮我|麻烦|能否|能不能|可以|可不可以)\s*)?(?:(?:把|将).{1,240}(?:改成|改为|换成|替换成|替换为|删掉|删除|去掉|移除|增加|添加|补充|缩短|延长)|(?:修改|调整|优化|重做|重新生成|删除|移除|增加|添加|补充|减少|缩短|延长|加强|减弱|降低|提高|选择|选用|采用).{0,240})/u;
const TARGETED_NEGATIVE_REVISION = /^(?:请\s*)?(?:不要|取消|保留).{0,80}(?:方案|方向|脚本|分镜|镜头|场景|素材|音乐|配乐|旁白|字幕|文案|画面|风格|色调|节奏|运镜|转场|人物|主角|背景|时长|比例)/u;
const ENGLISH_REVISION_REQUEST = /^(?:(?:please|could you|can you|would you)\s+)?(?:revise|modify|change|replace|remove|delete|add|adjust|optimize|use|choose|select|shorten|extend)\b/iu;
const CONVERSATIONAL_WORKFLOW_ACTION = /^(?:(?:那|那么|好的?|明白了|行|好吧|还是|接下来)\s*)?(?:就\s*)?(?:(?:选择|选用|采用|使用|用|按|按照).{0,160}(?:方案|方向|版本|脚本|分镜|镜头|场景|素材|风格)|继续(?:修改|完善|处理|制作).{0,160})/u;
const QUESTION = /[?？]\s*$|(?:为什么|怎么|怎样|如何|什么|哪些|哪里|哪种|多少|是否|是不是|有没有|吗|呢)/u;
const CHAT_DISCUSSION = /(?:聊聊|讨论|解释|介绍|分析|咨询|问问|说说)/u;
const approvalKey = (content: string): string =>
  content
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}%]+/gu, "");

export const classifyWorkflowReviewInput = (
  content: string,
): WorkflowReviewInputIntent => {
  const normalized = content.normalize("NFKC").trim();
  if (!normalized) return "chat";
  const normalizedApproval = approvalKey(normalized);
  if (
    APPROVAL_PHRASES.has(normalizedApproval)
    || CHINESE_APPROVAL_SENTENCE.test(normalizedApproval)
    || ENGLISH_APPROVAL_SENTENCE.test(normalizedApproval)
  ) {
    return "approve";
  }
  if (
    DIRECT_REVISION_REQUEST.test(normalized)
    || TARGETED_NEGATIVE_REVISION.test(normalized)
    || ENGLISH_REVISION_REQUEST.test(normalized)
    || CONVERSATIONAL_WORKFLOW_ACTION.test(normalized)
  ) {
    return "revise";
  }
  if (QUESTION.test(normalized) || CHAT_DISCUSSION.test(normalized)) return "chat";
  // At an approval checkpoint, concise parameter values and preferences are
  // revisions even when users omit an explicit verb such as “修改” or “调整”.
  return "revise";
};

// Restart commands are parsed as an explicit action plus one pipeline stage target.
// The grammar stays pipeline-agnostic: stage names come from aliases and ordinals
// are resolved against the registered stage order.
const RESTART_ACTION = /(?:回到|返回(?:到)?|退回(?:到)?|回退(?:到)?|跳回(?:到)?|切回(?:到)?|撤回(?:到)?|回滚(?:到)?|(?:从|由).{0,40}(?:开始|重来|再来|重新开始|重新来|重做|重跑|重新执行|重新运行|重新生成)|(?:重新|再次|再)(?:从.{0,40})?(?:开始|来|做|跑|走|执行|运行|生成)|重(?:做|跑|走|执行|运行|生成|启|来)|restart|start\s+over|go\s+back|return\s+to|roll\s*back|jump\s+back|rewind|re-?run|re-?do|repeat|regenerate|run.{0,40}again|execute.{0,40}again)/iu;
const RESTART_QUESTION = /(?:吗|么|如何|怎么|怎样|能否|能不能|可否|可不可以|是否|行不行|要不要|[?？])/u;

const CHINESE_NUMBER_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};
const CHINESE_NUMBER_UNITS: Readonly<Record<string, number>> = {
  十: 10,
  百: 100,
  千: 1_000,
};
const ENGLISH_STAGE_NUMBERS: Readonly<Record<string, number>> = {
  one: 1,
  first: 1,
  two: 2,
  second: 2,
  three: 3,
  third: 3,
  four: 4,
  fourth: 4,
  five: 5,
  fifth: 5,
  six: 6,
  sixth: 6,
  seven: 7,
  seventh: 7,
  eight: 8,
  eighth: 8,
  nine: 9,
  ninth: 9,
  ten: 10,
  tenth: 10,
  eleven: 11,
  eleventh: 11,
  twelve: 12,
  twelfth: 12,
  thirteen: 13,
  thirteenth: 13,
  fourteen: 14,
  fourteenth: 14,
  fifteen: 15,
  fifteenth: 15,
  sixteen: 16,
  sixteenth: 16,
  seventeen: 17,
  seventeenth: 17,
  eighteen: 18,
  eighteenth: 18,
  nineteen: 19,
  nineteenth: 19,
  twenty: 20,
  twentieth: 20,
};
const STAGE_NUMBER_TOKEN = "[1-9]\\d*(?:st|nd|rd|th)?|[零〇一二两三四五六七八九十百千]+|" +
  Object.keys(ENGLISH_STAGE_NUMBERS).join("|");
const RESTART_STAGE_ORDINAL_PATTERNS = [
  new RegExp(`第\\s*(${STAGE_NUMBER_TOKEN})\\s*(?:个\\s*)?(?:步骤|步|阶段|环节)`, "giu"),
  new RegExp(`(?:步骤|阶段|环节)\\s*(?:第\\s*)?(${STAGE_NUMBER_TOKEN})`, "giu"),
  new RegExp(`(?:step|stage|phase|checkpoint)\\s*(?:number\\s*|no\\.?\\s*|#\\s*)?(${STAGE_NUMBER_TOKEN})`, "giu"),
  new RegExp(`(?:the\\s+)?(${STAGE_NUMBER_TOKEN})\\s*(?:step|stage|phase|checkpoint)`, "giu"),
] as const;

const parseChineseStageNumber = (value: string): number | null => {
  let total = 0;
  let digit = 0;
  let hasNumber = false;
  for (const character of value) {
    const nextDigit = CHINESE_NUMBER_DIGITS[character];
    if (nextDigit !== undefined) {
      digit = nextDigit;
      hasNumber = true;
      continue;
    }
    const unit = CHINESE_NUMBER_UNITS[character];
    if (unit === undefined) return null;
    total += (digit || 1) * unit;
    digit = 0;
    hasNumber = true;
  }
  return hasNumber ? total + digit : null;
};

const parseStageNumber = (value: string): number | null => {
  const normalized = value.toLocaleLowerCase("en-US").replace(/(?:st|nd|rd|th)$/u, "");
  if (/^[1-9]\d*$/u.test(normalized)) return Number(normalized);
  const english = ENGLISH_STAGE_NUMBERS[normalized];
  if (english !== undefined) return english;
  return parseChineseStageNumber(normalized);
};

const extractRestartStageOrdinals = (content: string): Set<number> => {
  const ordinals = new Set<number>();
  for (const pattern of RESTART_STAGE_ORDINAL_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const ordinal = match[1] ? parseStageNumber(match[1]) : null;
      if (ordinal !== null) ordinals.add(ordinal);
    }
  }
  return ordinals;
};
export const parseWorkflowRestartCommand = (
  content: string,
  pipeline: WorkflowPipelineDefinition = CINEMATIC_PIPELINE_DEFINITION,
): { targetStage: WorkflowStageId; text: string } | null => {
  const normalized = content.normalize("NFKC").trim();
  if (!normalized || RESTART_QUESTION.test(normalized) || !RESTART_ACTION.test(normalized)) return null;
  const normalizedLower = normalized.toLocaleLowerCase("en-US");
  const matchedStageIds = new Set(pipeline.stages.filter((stage) =>
    stage.isRestartable && stage.aliases.some((alias) =>
      normalizedLower.includes(alias.normalize("NFKC").toLocaleLowerCase("en-US")),
    ),
  ).map((stage) => stage.id));
  for (const ordinal of extractRestartStageOrdinals(normalizedLower)) {
    const stage = pipeline.stages[ordinal - 1];
    if (!stage?.isRestartable) return null;
    matchedStageIds.add(stage.id);
  }
  const [targetStage] = matchedStageIds;
  return matchedStageIds.size === 1 && targetStage
    ? { targetStage, text: normalized }
    : null;
};

const RESTART_CONFIRMATIONS = new Set(["确认", "确认重启", "确认重新开始", "confirm", "confirmed", "confirmrestart", "yes"]);
const RESTART_CANCELLATIONS = new Set(["取消", "取消重启", "取消重新开始", "不重启", "cancel", "cancelrestart"]);

export const classifyWorkflowRestartConfirmation = (
  content: string,
): WorkflowRestartConfirmationIntent => {
  const normalized = content.normalize("NFKC").trim().toLocaleLowerCase("en-US")
    .replace(/[\s，。！？!?,.]+/gu, "");
  if (RESTART_CONFIRMATIONS.has(normalized)) return "confirm";
  if (RESTART_CANCELLATIONS.has(normalized)) return "cancel";
  return "chat";
};
