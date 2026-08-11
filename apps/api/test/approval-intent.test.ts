import { describe, expect, it } from "vitest";

import { classifyApprovalIntent } from "../src/video-workflow/approval-intent.js";

const APPROVAL_CASES = [
  "是", "对", "好", "可以", "行", "没错", "正确", "确实", "的确", "当然", "自然", "无疑",
  "一定", "必定", "必然", "势必", "毫无疑问", "毋庸置疑", "千真万确", "确凿无疑", "不容置疑", "确定无疑",
  "同意", "赞成", "认可", "认同", "支持", "赞许", "首肯", "赞同", "通过",
  "嗯", "对啊", "是的", "没问题", "可以的", "当然啦", "行啊", "好的", "收到", "明白",
  "确认", "肯定", "承认", "证实", "确认无误", "予以肯定", "表示赞同",
  "Yes", "Yeah", "Yep", "Right", "Correct", "OK", "Okay", "Sure", "Exactly",
  "Absolutely", "Definitely", "Certainly", "Definitely yes", "Without a doubt", "Undoubtedly", "Exactly right", "100%",
  "Agree", "I agree", "I approve", "I support it", "Sounds good", "That makes sense", "I’m with you",
  "Got it", "Sure thing", "No problem", "Of course", "You got it", "For sure", "Sounds great",
  "Affirmative", "Confirmed", "Acknowledged", "Approved", "Agreed", "Accepted", "1",
] as const;

describe("classifyApprovalIntent", () => {
  it.each(APPROVAL_CASES)("classifies %s as approval", (message) => {
    expect(classifyApprovalIntent(message)).toBe("approve");
  });

  it.each(["好的！", "  I AGREE. ", "我完全同意这个方案，请继续", "Okay, please proceed"])(
    "normalizes conversational approval: %s",
    (message) => expect(classifyApprovalIntent(message)).toBe("approve"),
  );

  it.each(["不对", "不可以", "不同意", "不通过", "还需要修改", "No", "I disagree", "Not approved", "Do not proceed"])(
    "does not advance on rejection or revision: %s",
    (message) => expect(classifyApprovalIntent(message)).toBe("revise"),
  );
});
