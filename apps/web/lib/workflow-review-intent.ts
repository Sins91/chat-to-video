export type WorkflowReviewInputIntent = "approve" | "revise" | "chat";

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
