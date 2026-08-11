const APPROVAL_PHRASES = new Set([
  "1",
  "是", "对", "好", "可以", "行", "没错", "正确", "确实", "的确", "当然", "自然", "无疑",
  "一定", "必定", "必然", "势必", "毫无疑问", "毋庸置疑", "千真万确", "确凿无疑", "不容置疑", "确定无疑",
  "同意", "赞成", "认可", "认同", "支持", "赞许", "首肯", "赞同", "通过",
  "嗯", "对啊", "是的", "没问题", "可以的", "当然啦", "行啊", "好的", "收到", "明白",
  "确认", "肯定", "承认", "证实", "确认无误", "予以肯定", "表示赞同",
  "继续", "可以继续", "确认生成", "开始生成", "生成视频", "没问题继续", "下一步", "继续下一步", "进入下一步",
  "下一阶段", "下一个阶段", "继续下一阶段", "继续下一个阶段", "进入下一阶段", "进入下一个阶段",
  "yes", "yeah", "yep", "right", "correct", "ok", "okay", "sure", "exactly",
  "absolutely", "definitely", "certainly", "definitelyyes", "withoutadoubt", "undoubtedly", "exactlyright", "100%",
  "agree", "iagree", "iapprove", "isupportit", "soundsgood", "thatmakessense", "imwithyou",
  "gotit", "surething", "noproblem", "ofcourse", "yougotit", "forsure", "soundsgreat",
  "affirmative", "confirmed", "acknowledged", "approved", "agreed", "accepted",
]);

const normalizeApprovalMessage = (message: string): string =>
  message
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/gu, "'")
    .replace(/[^\p{L}\p{N}%]+/gu, "");

const CHINESE_APPROVAL_SENTENCE = /^(?:我)?(?:完全|非常|十分)?(?:同意|赞成|认可|认同|支持|赞同|确认|接受|通过)(?:这个|该)?(?:方案|版本|结果|内容)?(?:了|啦|啊|呀|吧)?(?:请)?(?:继续|进入下一步|开始生成|生成视频)?$/u;
const ENGLISH_APPROVAL_SENTENCE = /^(?:yes|yeah|yep|ok|okay|sure|agreed|approved|accepted|confirmed|affirmative|absolutely|definitely|certainly|exactly|correct|right)(?:please)?(?:proceed|continue|goahead|movetonextstep)?$/u;

export const classifyApprovalIntent = (message: string): "approve" | "revise" => {
  const normalized = normalizeApprovalMessage(message);
  if (APPROVAL_PHRASES.has(normalized)) return "approve";
  return CHINESE_APPROVAL_SENTENCE.test(normalized) || ENGLISH_APPROVAL_SENTENCE.test(normalized)
    ? "approve"
    : "revise";
};
