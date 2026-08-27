import type { CinematicGenerativeStage } from "@chat-to-video/contracts";
import { z } from "zod";

export const SHORT_VIDEO_FASHION_OUTFIT_CHANGE_SKILL_ID =
  "short-video-fashion-outfit-change";
export const SHORT_VIDEO_TALKING_HEAD_SKILL_ID =
  "short-video-talking-head";
export const SHORT_VIDEO_STORE_VISIT_SKILL_ID =
  "short-video-store-visit";
export const SHORT_VIDEO_JIAOLU_FOOD_SKILL_ID =
  "short-video-jiaolu-food";
export const SHORT_VIDEO_MAGIC_LAMP_SKILL_ID =
  "short-video-magic-lamp";
export const SHORT_VIDEO_HANDHELD_DV_VLOG_SKILL_ID =
  "short-video-handheld-dv-vlog";
export const SHORT_VIDEO_FILM_LOOK_SKILL_ID =
  "short-video-film-look";

export const CinematicSkillTemplateIdSchema = z.enum([
  SHORT_VIDEO_JIAOLU_FOOD_SKILL_ID,
  SHORT_VIDEO_MAGIC_LAMP_SKILL_ID,
  SHORT_VIDEO_HANDHELD_DV_VLOG_SKILL_ID,
  SHORT_VIDEO_FASHION_OUTFIT_CHANGE_SKILL_ID,
  SHORT_VIDEO_STORE_VISIT_SKILL_ID,
  SHORT_VIDEO_TALKING_HEAD_SKILL_ID,
  SHORT_VIDEO_FILM_LOOK_SKILL_ID,
]);

export type CinematicSkillTemplateId = z.infer<
  typeof CinematicSkillTemplateIdSchema
>;

export type CinematicSkillTemplateDefinition = Readonly<{
  skillId: CinematicSkillTemplateId;
  priority: number;
  keywords: readonly string[];
  stages: readonly CinematicGenerativeStage[];
}>;

const NEGATED_MATCH_PREFIX =
  /(?:不要|不需要|无需|取消|避免|拒绝|非)(?:做|进行|生成|制作|拍摄|采用|使用)?$|(?:no|not|without|avoid|cancel)(?:make|create|use|shoot|a|an|the)?$/u;

const normalizeForMatch = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]+/gu, "");

const hasPositiveKeywordMatch = (text: string, keyword: string): boolean => {
  const normalizedKeyword = normalizeForMatch(keyword);
  let offset = text.indexOf(normalizedKeyword);
  while (offset >= 0) {
    const prefix = text.slice(Math.max(0, offset - 12), offset);
    if (!NEGATED_MATCH_PREFIX.test(prefix)) return true;
    offset = text.indexOf(normalizedKeyword, offset + normalizedKeyword.length);
  }
  return false;
};

export const CINEMATIC_SKILL_TEMPLATE_DEFINITIONS = Object.freeze([
  {
    skillId: SHORT_VIDEO_JIAOLU_FOOD_SKILL_ID,
    priority: 170,
    keywords: ["角卤", "角卤视频", "角卤熟食", "角卤门店"],
    stages: ["proposal", "script", "scene_plan", "assets"],
  },
  {
    skillId: SHORT_VIDEO_MAGIC_LAMP_SKILL_ID,
    priority: 160,
    keywords: [
      "神灯视频",
      "阿拉丁神灯",
      "沙漠神灯",
      "灯神现身",
      "magic lamp",
      "genie lamp",
    ],
    stages: ["proposal", "script", "scene_plan", "assets"],
  },
  {
    skillId: SHORT_VIDEO_HANDHELD_DV_VLOG_SKILL_ID,
    priority: 150,
    keywords: [
      "手持直播效果",
      "手持dv",
      "手持minidv",
      "minidv自拍",
      "dv自拍",
      "后台vlog",
      "handheld dv",
      "backstage vlog",
    ],
    stages: ["proposal", "script", "scene_plan", "assets"],
  },
  {
    skillId: SHORT_VIDEO_FASHION_OUTFIT_CHANGE_SKILL_ID,
    priority: 140,
    keywords: [
      "模特换装",
      "模特变装",
      "女模换装",
      "穿搭变装",
      "时装换装",
      "丝滑变装",
      "多套服装切换",
      "多套穿搭切换",
      "多套造型切换",
      "outfit change",
      "model outfit change",
    ],
    stages: ["proposal", "script", "scene_plan", "assets"],
  },
  {
    skillId: SHORT_VIDEO_STORE_VISIT_SKILL_ID,
    priority: 130,
    keywords: [
      "探店视频",
      "线下探店",
      "美食探店",
      "餐饮探店",
      "门店探访",
      "到店体验",
      "store visit",
      "shop visit",
    ],
    stages: ["proposal", "script", "scene_plan", "assets"],
  },
  {
    skillId: SHORT_VIDEO_TALKING_HEAD_SKILL_ID,
    priority: 120,
    keywords: [
      "口播",
      "口播视频",
      "真人口播",
      "人物口播",
      "商品口播",
      "销售口播",
      "talking head",
      "spokesperson video",
    ],
    stages: ["proposal", "script", "scene_plan", "assets"],
  },
  {
    skillId: SHORT_VIDEO_FILM_LOOK_SKILL_ID,
    priority: 110,
    keywords: [
      "电影效果",
      "电影级效果",
      "写实电影质感",
      "35mm电影感",
      "自然主义摄影",
      "cinematic film look",
    ],
    stages: ["proposal", "script", "scene_plan", "assets"],
  },
] as const satisfies readonly CinematicSkillTemplateDefinition[]);

export const validateCinematicSkillTemplateDefinitions = (
  definitions: readonly CinematicSkillTemplateDefinition[],
): void => {
  const skillIds = new Set<string>();
  const priorities = new Set<number>();
  for (const definition of definitions) {
    if (skillIds.has(definition.skillId)) {
      throw new Error(`Duplicate cinematic Skill template ID: ${definition.skillId}.`);
    }
    if (priorities.has(definition.priority)) {
      throw new Error(`Duplicate cinematic Skill template priority: ${definition.priority}.`);
    }
    if (definition.keywords.length === 0 || definition.stages.length === 0) {
      throw new Error(`Cinematic Skill template ${definition.skillId} is incomplete.`);
    }
    skillIds.add(definition.skillId);
    priorities.add(definition.priority);
  }
};

validateCinematicSkillTemplateDefinitions(CINEMATIC_SKILL_TEMPLATE_DEFINITIONS);

export const matchCinematicSkillTemplate = (
  initialPrompt: string,
): CinematicSkillTemplateDefinition | null => {
  const normalizedPrompt = normalizeForMatch(initialPrompt);
  return [...CINEMATIC_SKILL_TEMPLATE_DEFINITIONS]
    .sort((left, right) => right.priority - left.priority)
    .find((definition) =>
      definition.keywords.some((keyword) =>
        hasPositiveKeywordMatch(normalizedPrompt, keyword)
      )
    ) ?? null;
};

export const isCinematicSkillTemplateStage = (
  skillId: CinematicSkillTemplateId,
  stage: CinematicGenerativeStage,
): boolean => {
  const definition = CINEMATIC_SKILL_TEMPLATE_DEFINITIONS.find(
    (candidate) => candidate.skillId === skillId,
  );
  if (!definition) {
    throw new Error(`Cinematic Skill template is not registered: ${skillId}.`);
  }
  return (definition.stages as readonly CinematicGenerativeStage[]).includes(stage);
};
