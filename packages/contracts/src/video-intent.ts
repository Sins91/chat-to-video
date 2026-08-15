const NEGATED_VIDEO_WORK = /(?:不要|不用|无需|先别|暂不|不需要)[^。！？?]{0,80}(?:生成|制作|创建|编写|规划|设计|剪辑|渲染)[^。！？?]{0,80}(?:视频|短片|影片|动画|宣传片|脚本|分镜)/u;
const INFORMATION_REQUEST = /(?:如何|怎么|怎样|为什么|什么是|有哪些|教程|原理|方法|步骤|区别).{0,24}(?:视频|短片|影片|动画|宣传片)|(?:视频|短片|影片|动画|宣传片).{0,24}(?:如何|怎么|怎样|为什么|有哪些|教程|原理|方法|步骤|区别)/u;
const VIDEO_OUTPUT_REQUEST = /(?:生成|制作|创建|做一个|做一段|做个|做段|渲染)[^。！？?]{0,120}(?:视频|短片|影片|动画|宣传片)|(?:把|将)[^。！？?]{1,160}(?:做成|制成|生成|制作成|转换成|转成)[^。！？?]{0,24}(?:视频|短片|影片|动画|宣传片)/u;
const VIDEO_RESULT_REQUEST = /(?:给我|帮我|我要|我想要|我想做|我想制作|来一个|来一段|来个)[^。！？?]{0,120}(?:视频|短片|影片|动画|宣传片)/u;
const VIDEO_PLANNING_REQUEST = /(?:生成|制作|创建|构思|编写|输出|规划|设计|修改|调整|给我|帮我|我要|我想要)[^。！？?]{0,80}(?:视频|短片|影片|动画|宣传片)(?:的)?[^。！？?]{0,24}(?:脚本|文案|提示词|创意|方案|分镜|大纲|场景|素材|剪辑|配音|字幕)|(?:生成|制作|创建|构思|编写|输出|规划|设计|修改|调整)[^。！？?]{0,32}(?:视频脚本|视频文案|视频分镜|短片脚本|影片脚本)/u;
const SPEC_DRIVEN_VIDEO_WORK = /(?:生成|制作|创建|渲染)[^。！？?]{0,160}(?:(?:时长|片长|持续)\s*(?:约|大约)?\s*\d{1,3}\s*(?:秒|s|seconds?)|\b(?:720p|768p|1080p|2k|4k)\b|运镜|镜头运动|转场|画面比例|横屏|竖屏)/iu;
const ENGLISH_VIDEO_WORK = /\b(?:generate|create|make|produce|render|plan|write|edit|revise)\b.{0,160}\b(?:video|clip|movie|animation|storyboard|video script)\b|\b(?:video|clip|movie|animation|storyboard|video script)\b.{0,160}\b(?:generate|create|make|produce|render|plan|write|edit|revise)\b/iu;

export type VideoWorkflowIntentHint = "workflow" | "chat" | "ambiguous";

/** Rule-only routing hint. Ambiguous terminal follow-ups must be resolved by the API. */
export const getVideoWorkflowIntentHint = (content: string): VideoWorkflowIntentHint => {
  const normalized = content.normalize("NFKC").trim();
  if (!normalized || NEGATED_VIDEO_WORK.test(normalized) || INFORMATION_REQUEST.test(normalized)) {
    return "chat";
  }
  return VIDEO_OUTPUT_REQUEST.test(normalized)
    || VIDEO_RESULT_REQUEST.test(normalized)
    || VIDEO_PLANNING_REQUEST.test(normalized)
    || SPEC_DRIVEN_VIDEO_WORK.test(normalized)
    || ENGLISH_VIDEO_WORK.test(normalized)
    ? "workflow"
    : "ambiguous";
};

/** Shared coarse routing guard. The API remains the authoritative workflow boundary. */
export const isVideoWorkflowIntent = (content: string): boolean =>
  getVideoWorkflowIntentHint(content) === "workflow";
