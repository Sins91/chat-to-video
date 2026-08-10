const NEGATED_VIDEO_ACTION = /(?:不要|不用|无需|先别|暂不|不需要)[^。！？!?]{0,80}(?:生成|制作|创建|做成|渲染)[^。！？!?]{0,80}(?:视频|短片|影片|动画|宣传片)/u;
const INFORMATION_REQUEST = /(?:如何|怎么|怎样|为什么|什么是|有哪些|教程|原理|方法|步骤|区别).{0,16}(?:视频|短片|影片|动画|宣传片)|(?:视频|短片|影片|动画|宣传片).{0,16}(?:如何|怎么|怎样|为什么|有哪些|教程|原理|方法|步骤|区别)|^(?:请)?(?:介绍|讲讲|聊聊|分析).{0,16}(?:视频|短片|影片|动画|宣传片)/u;
const PLANNING_ARTIFACT_REQUEST = /(?:生成|制作|创建|做一个|做一段|做个|做段|构思|编写|输出)[^。！？!?]{0,80}(?:视频|短片|影片|动画|宣传片)(?:的)?(?:脚本|文案|提示词|创意|方案|分镜|大纲)/u;
const DIRECT_VIDEO_ACTION = /(?:请|帮我|给我|我要|我想|现在|直接|开始|立刻|马上)?[^。！？!?]{0,24}(?:生成|制作|创建|做一个|做一段|做个|做段|渲染)[^。！？!?]{0,80}(?:视频|短片|影片|动画|宣传片)(?!的?(?:脚本|文案|提示词|创意|方案|分镜|大纲))/u;
const TRANSFORM_TO_VIDEO = /(?:把|将)[^。！？!?]{1,160}(?:做成|制成|生成|制作成|转换成|转成)[^。！？!?]{0,24}(?:视频|短片|影片|动画|宣传片)(?!的?(?:脚本|文案|提示词|创意|方案|分镜|大纲))/u;
const REQUEST_VIDEO_RESULT = /(?:我要|我想要?|想做|想制作|帮我|给我|来一个|来一段|来个)[^。！？!?]{0,120}(?:视频|短片|影片|动画|宣传片)(?!的?(?:脚本|文案|提示词|创意|方案|分镜|大纲))/u;
const VIDEO_PRODUCTION_SPECS = /(?:(?:时长|持续|片长)?\s*(?:约|大约)?\s*\d{1,3}\s*(?:秒|s|seconds?)|\b(?:720p|768p|1080p|2k|4k)\b|(?:运镜|镜头运动|转场|画面比例|横屏|竖屏))/iu;
const SPEC_DRIVEN_GENERATION = /(?:生成|制作|创建|渲染)[^。！？!?]{0,160}/u;
const ENGLISH_VIDEO_ACTION = /\b(?:generate|create|make|produce|render)\b.{0,160}\b(?:video|clip|movie|animation)\b|\b(?:video|clip|movie|animation)\b.{0,160}\b(?:generate|create|make|produce|render)\b/iu;

export const isVideoCreationIntent = (content: string): boolean => {
  const normalized = content.normalize("NFKC").trim();
  if (!normalized
    || NEGATED_VIDEO_ACTION.test(normalized)
    || INFORMATION_REQUEST.test(normalized)) return false;
  const hasCreationAction = DIRECT_VIDEO_ACTION.test(normalized)
    || TRANSFORM_TO_VIDEO.test(normalized)
    || REQUEST_VIDEO_RESULT.test(normalized)
    || ENGLISH_VIDEO_ACTION.test(normalized)
    || (SPEC_DRIVEN_GENERATION.test(normalized)
      && VIDEO_PRODUCTION_SPECS.test(normalized)
      && !PLANNING_ARTIFACT_REQUEST.test(normalized));
  return hasCreationAction;
};
