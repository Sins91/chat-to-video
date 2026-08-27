const { randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const { loadRepositoryEnvironment } = require("./repository-environment.cjs");

const REPOSITORY_ROOT = resolve(__dirname, "..");
const API_DIST_ROOT = resolve(REPOSITORY_ROOT, "apps/api/dist/src");
const CONTRACTS_DIST_ENTRY = resolve(REPOSITORY_ROOT, "packages/contracts/dist/index.js");
const DEFAULT_API_BASE_URL = "http://localhost:4101";
const PLANNING_CONFIRMATION = "CALL_TEXT_MODELS";

const templateCases = Object.freeze([
  {
    label: "电商模特换装",
    expectedSkillId: "short-video-fashion-outfit-change",
    initialPrompt: "生成一条16秒电商模特换装视频，使用模板默认人物、酒店内景、四套造型顺序和抖音快节奏。",
    scenes: [
      ["第一套造型自然转身展示", "快速推进", "酒店环境声，无背景配乐"],
      ["第二套造型自然转身展示", "快速拉远", "酒店环境声，无背景配乐"],
      ["第三套造型自然转身展示", "跟随", "酒店环境声，无背景配乐"],
      ["第四套造型自然转身并收束", "快速推进", "酒店环境声，无背景配乐"],
    ],
  },
  {
    label: "口播视频",
    expectedSkillId: "short-video-talking-head",
    initialPrompt: "生成一条15秒办公室真人口播视频，使用模板默认人物、构图、灯光和动作。",
    scenes: [["完整15秒正面口播", "轻微慢推", "同步对白与办公室环境声，无背景配乐"]],
  },
  {
    label: "探店视频",
    expectedSkillId: "short-video-store-visit",
    initialPrompt: "生成一条12秒美食探店视频，使用模板默认三镜头、中文旁白、音效和背景音乐，不要字幕。",
    scenes: [
      ["从门口推进展示门店环境", "推进", "门店环境声与中文旁白，无背景配乐"],
      ["展示冰箱中的新鲜食材", "平移", "冰箱开启与食材环境声，无背景配乐"],
      ["成年情侣品尝美食并自然表达好吃", "固定", "进食音效与中文旁白，无背景配乐"],
    ],
  },
  {
    label: "角卤视频",
    expectedSkillId: "short-video-jiaolu-food",
    initialPrompt: "生成一条12秒角卤视频，使用模板默认酸辣鸡丝、门店排队和虚构成年女性进食三镜头。",
    scenes: [
      ["筷子夹起酸辣鸡丝的微距特写", "固定微距", "食物与餐具音效，无背景配乐"],
      ["角卤熟食门店外顾客排队", "电影级平移", "街道与排队环境声，无背景配乐"],
      ["虚构年轻成年女性在店内吃酸辣鸡丝", "固定", "进食与明亮门店环境声，无背景配乐"],
    ],
  },
  {
    label: "神灯视频",
    expectedSkillId: "short-video-magic-lamp",
    initialPrompt: "生成一条12秒沙漠神灯视频，使用模板默认发现、挖掘擦拭、蓝烟灯神现身三镜头。",
    scenes: [
      ["成年印度男子行走时发现沙中神灯", "推进", "脚步与风沙声，无背景配乐"],
      ["男子挖出并擦拭神灯，壶口冒出蓝烟", "过肩推进", "刨沙、擦拭与烟雾音效，无背景配乐"],
      ["灯神从蓝烟中现身，三名成年人惊讶", "低位固定", "烟雾与惊讶反应声，无背景配乐"],
    ],
  },
  {
    label: "手持直播效果",
    expectedSkillId: "short-video-handheld-dv-vlog",
    initialPrompt: "生成一条15秒手持MiniDV后台vlog，使用模板默认23岁韩国成年女性、对白和真实自拍效果。",
    scenes: [["登台前的连续后台自拍、行走口述与镜前停留", "第一人称手持", "同步自然对白与机身麦克风后台环境声，无背景配乐"]],
  },
  {
    label: "电影效果",
    expectedSkillId: "short-video-film-look",
    initialPrompt: "生成一条20秒写实电影质感短片，使用模板默认西域沙漠部落五镜头、35mm暖灰色调和环境音效，无背景音乐。",
    scenes: [
      ["晨雾中的崖壁部落与骆驼", "极缓慢推进", "晨风、远处人声与骆驼响鼻，无背景配乐"],
      ["陶罐和铜壶随震颤轻碰", "固定", "器物轻碰、低频震颤与远处低鸣，无背景配乐"],
      ["西域胡人老妇停下揉面并抬头", "固定", "粗重吸气、震颤与低鸣，无背景配乐"],
      ["骆驼先于成年少年察觉异样", "固定", "踏蹄、嘶鸣、绳索与低鸣，无背景配乐"],
      ["织毯随震颤抖动，成年妇人抬头", "固定", "织物、晾绳、震颤与低鸣，无背景配乐"],
    ],
  },
]);

const importApiModule = (relativePath) =>
  import(pathToFileURL(resolve(API_DIST_ROOT, relativePath)).href);

const createScenePlan = (contracts, testCase) => {
  const durationSeconds = testCase.label === "口播视频" || testCase.label === "手持直播效果"
    ? 15
    : testCase.scenes.length * 4;
  return contracts.CinematicArtifactSchema.parse({
    stage: "scene_plan",
    data: {
      durationSeconds,
      aspectRatio: "16:9",
      scenes: testCase.scenes.map(([narrativeBeat, camera, audio], index) => ({
        order: index + 1,
        durationSeconds: testCase.scenes.length === 1 ? durationSeconds : 4,
        narrativeBeat,
        visualPrompt: narrativeBeat,
        sourceType: "generated_video",
        motionRequired: true,
        camera,
        transition: "cut",
        audio,
        audioMode: "seedance",
      })),
    },
  });
};

const getBalance = async (baseUrl) => {
  const response = await fetch(`${baseUrl}/apimart/account/balance`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Balance lookup failed (${response.status}).`);
  const body = await response.json();
  if (body.isUnlimited || !Number.isFinite(body.remainingBalance)) {
    throw new Error("A finite APIMart balance is required for budget enforcement.");
  }
  return body.remainingBalance;
};

const run = async () => {
  loadRepositoryEnvironment({ repositoryRoot: REPOSITORY_ROOT });
  const mode = process.argv[2] ?? "dry-run";
  if (mode !== "dry-run" && mode !== "planning") {
    throw new Error("Usage: node scripts/template-prompt-planning-test.cjs <dry-run|planning>.");
  }
  const registry = await importApiModule("agent-extensions/cinematic-skill-template.registry.js");
  for (const testCase of templateCases) {
    const matched = registry.matchCinematicSkillTemplate(testCase.initialPrompt);
    if (matched?.skillId !== testCase.expectedSkillId) {
      throw new Error(
        `${testCase.label} matched ${matched?.skillId ?? "none"}; expected ${testCase.expectedSkillId}.`,
      );
    }
  }
  if (mode === "dry-run") {
    console.log(JSON.stringify(templateCases.map((testCase) => ({
      label: testCase.label,
      initialPrompt: testCase.initialPrompt,
      triggeredTemplateName: testCase.expectedSkillId,
    })), null, 2));
    return;
  }
  if (process.env.TEMPLATE_PLANNING_CONFIRM !== PLANNING_CONFIRMATION) {
    throw new Error(`Planning requires TEMPLATE_PLANNING_CONFIRM=${PLANNING_CONFIRMATION}.`);
  }
  const maximumCostUsd = Number(process.env.TEMPLATE_PLANNING_MAX_TOTAL_COST_USD);
  if (!Number.isFinite(maximumCostUsd) || maximumCostUsd <= 0) {
    throw new Error("TEMPLATE_PLANNING_MAX_TOTAL_COST_USD must be a positive finite number.");
  }
  const baseUrl = (process.env.CONNECTIVITY_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/u, "");
  const [contracts, { AgentSkillCatalog }, { ApimartModelGateway }, { loadApimartConfig },
    { loadLlmConfig }, { createMastraAgents }] = await Promise.all([
    import(pathToFileURL(CONTRACTS_DIST_ENTRY).href),
    importApiModule("agent-extensions/agent-skill.catalog.js"),
    importApiModule("model-gateway/apimart-model-gateway.js"),
    importApiModule("model-gateway/apimart.config.js"),
    importApiModule("model-gateway/llm.config.js"),
    importApiModule("model-gateway/mastra-agents.js"),
  ]);
  const config = loadLlmConfig(loadApimartConfig());
  const toolRegistry = { forChat: () => ({}), forCinematic: () => ({}) };
  const agents = createMastraAgents(config, new AgentSkillCatalog(), toolRegistry);
  const gateway = new ApimartModelGateway(agents);
  const balanceBefore = await getBalance(baseUrl);
  const reports = [];
  for (const testCase of templateCases) {
    const scenePlan = createScenePlan(contracts, testCase);
    const workflowId = randomUUID();
    const artifact = await gateway.generateCinematicArtifact({
      requestId: randomUUID(),
      workflowId,
      conversationId: randomUUID(),
      tenantId: "connectivity-template-test",
      projectId: "connectivity-template-test",
      initialPrompt: testCase.initialPrompt,
      subtitlesEnabled: false,
      stage: "assets",
      videoModel: "doubao-seedance-2.0",
      durationSeconds: scenePlan.data.durationSeconds,
      modelMaxDurationSeconds: 15,
      approvedArtifacts: [scenePlan],
    });
    if (artifact.stage !== "assets") throw new Error(`${testCase.label} did not return assets.`);
    reports.push({
      label: testCase.label,
      initialPrompt: testCase.initialPrompt,
      triggeredTemplateName: testCase.expectedSkillId,
      finalPrompts: artifact.data.assets.map((asset) => ({
        sceneOrder: asset.sceneOrder,
        kind: asset.kind,
        prompt: asset.prompt,
      })),
    });
    const balanceNow = await getBalance(baseUrl);
    const spentUsd = Number((balanceBefore - balanceNow).toFixed(6));
    if (spentUsd > maximumCostUsd) {
      throw new Error(
        `Observed template planning cost $${spentUsd} exceeded limit $${maximumCostUsd}.`,
      );
    }
    console.log(`completed=${testCase.expectedSkillId} observedCostUsd=${spentUsd}`);
  }
  const balanceAfter = await getBalance(baseUrl);
  console.log(JSON.stringify({
    observedCostUsd: Number((balanceBefore - balanceAfter).toFixed(6)),
    reports,
  }, null, 2));
};

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
