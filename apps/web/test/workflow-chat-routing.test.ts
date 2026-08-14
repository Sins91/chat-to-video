import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defineWorkflowPipeline } from "@chat-to-video/contracts";

import {
  classifyWorkflowRestartConfirmation,
  classifyWorkflowReviewInput,
  parseWorkflowRestartCommand,
} from "@/lib/workflow-review-intent";

const webRoot = resolve(import.meta.dirname, "..");

describe("workflow and chat routing", () => {
  it.each([
    ["从脚本重新开始，并把旁白写得更克制", "script"],
    ["回退到分镜重新生成，减少镜头数量", "scene_plan"],
    ["回到步骤2", "proposal"],
    ["回到第2步", "proposal"],
    ["回到第二步", "proposal"],
    ["返回到第 2 个步骤", "proposal"],
    ["退回第二阶段", "proposal"],
    ["回退到步骤二", "proposal"],
    ["跳回第2个环节", "proposal"],
    ["切回到阶段2", "proposal"],
    ["撤回到第2步", "proposal"],
    ["回滚到第二步", "proposal"],
    ["从第2步开始", "proposal"],
    ["从第二阶段重来", "proposal"],
    ["由步骤2重新开始", "proposal"],
    ["重新从第2步开始", "proposal"],
    ["第2步重新开始", "proposal"],
    ["重做步骤2", "proposal"],
    ["重新做第二步", "proposal"],
    ["再做一遍第2步", "proposal"],
    ["重跑第二阶段", "proposal"],
    ["重新执行第2步", "proposal"],
    ["再次执行步骤2", "proposal"],
    ["重新运行第二步", "proposal"],
    ["重新生成第2阶段", "proposal"],
    ["重启步骤2", "proposal"],
    ["返回第 3 步并缩短旁白", "script"],
    ["退回第三个阶段", "script"],
    ["跳回步骤三", "script"],
    ["restart from step 4", "scene_plan"],
    ["go back to step 2", "proposal"],
    ["return to the second stage", "proposal"],
    ["roll back to phase 2", "proposal"],
    ["jump back to checkpoint #2", "proposal"],
    ["rewind to stage two", "proposal"],
    ["restart from step #2", "proposal"],
    ["start over at the 2nd step", "proposal"],
    ["rerun stage two", "proposal"],
    ["re-run the second stage", "proposal"],
    ["redo step 2", "proposal"],
    ["re-do the second phase", "proposal"],
    ["repeat step number 2", "proposal"],
    ["regenerate from phase two", "proposal"],
    ["run stage 2 again", "proposal"],
    ["execute step 2 again", "proposal"],
    ["restart from assets with generated footage only", "assets"],
    ["redo proposal and make it warmer", "proposal"],
  ])("recognizes an explicit single-stage restart command: %s", (content, targetStage) => {
    expect(parseWorkflowRestartCommand(content)).toMatchObject({ targetStage, text: content });
  });

  it.each([
    "能不能从脚本重新开始？",
    "可以回到第二步吗？",
    "是否应该退回步骤2",
    "要不要从第二阶段重来",
    "从脚本或分镜重新开始",
    "回到第二步或第三步",
    "修改脚本，让旁白更短",
    "继续完善当前素材方案",
  ])("keeps ambiguous or non-restart wording out of restart routing: %s", (content) => {
    expect(parseWorkflowRestartCommand(content)).toBeNull();
  });

  it("classifies only explicit confirmation responses while restart is pending", () => {
    expect(classifyWorkflowRestartConfirmation("确认")).toBe("confirm");
    expect(classifyWorkflowRestartConfirmation("cancel restart")).toBe("cancel");
    expect(classifyWorkflowRestartConfirmation("确认一下脚本内容是什么？")).toBe("chat");
  });

  it("parses stages from a newly registered pipeline without parser changes", () => {
    const pipeline = defineWorkflowPipeline({
      id: "audio-story",
      definitionVersion: 1,
      initialStageId: "brief",
      terminalStageIds: ["voice"],
      stages: [
        { id: "brief", label: "需求", aliases: ["需求"], stepId: "brief", producesArtifact: true, requiresApproval: false, allowsRevision: false, isRestartable: false, intentTopics: ["需求"], ownedArtifactKinds: ["brief"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: ["voice"], inputArtifactKinds: [], outputArtifactKinds: ["brief"], execution: "agent", planningReview: { requiresApproval: false, allowsRevision: false }, capabilities: { required: [], optional: [], conditional: [] } },
        { id: "voice", label: "配音", aliases: ["配音", "voice"], stepId: "voice", producesArtifact: true, requiresApproval: true, allowsRevision: true, isRestartable: true, intentTopics: ["配音"], ownedArtifactKinds: ["voice"], allowsAutoAdvanceAfterRevision: false, allowedNextStageIds: [], inputArtifactKinds: ["brief"], outputArtifactKinds: ["voice"], execution: "agent", planningReview: { requiresApproval: true, allowsRevision: true }, capabilities: { required: [], optional: [], conditional: [] } },
      ],
    });
    expect(parseWorkflowRestartCommand("从配音重新开始", pipeline))
      .toMatchObject({ targetStage: "voice" });
    expect(parseWorkflowRestartCommand("回到步骤2", pipeline))
      .toMatchObject({ targetStage: "voice" });
  });

  it.each([
    "回到步骤1",
    "回到第一步",
    "回到步骤2或步骤3",
    "退回第二阶段和第三阶段",
    "回到步骤2的脚本阶段",
    "回到步骤99",
    "restart from the twentieth stage",
  ])("does not route a non-restartable, conflicting, or invalid ordinal: %s", (content) => {
    expect(parseWorkflowRestartCommand(content)).toBeNull();
  });

  it.each([
    "好的",
    "我看行",
    "我觉得行",
    "这样行",
    "这版行",
    "Yes",
    "I agree",
    "Confirmed",
    "1",
    "我完全同意这个方案，请继续",
    "Okay, please proceed",
    "确认生成",
    "可以继续",
    "继续下一个阶段",
    "进入下一阶段",
    "把背景改成蓝色",
    "请删除第二个镜头",
    "选择第二个方案",
    "那就按第二个方案继续",
    "继续完善原来的分镜",
    "切换回原工作流",
    "继续刚才的视频任务",
    "继续生成原来的视频",
    "Please revise the music direction",
    "时长 20 秒",
    "画面比例 16:9",
    "第二个方案",
    "旁白更克制一些",
  ])("keeps an explicit review action in the workflow: %s", (content) => {
    expect(classifyWorkflowReviewInput(content)).not.toBe("chat");
  });

  it.each(["我看行", "我觉得行", "这样行", "这版行"])(
    "routes colloquial approval to the next workflow step: %s",
    (content) => expect(classifyWorkflowReviewInput(content)).toBe("approve"),
  );

  it.each([
    "不对",
    "不可以",
    "不同意",
    "No",
    "I disagree",
    "Not approved",
  ])("does not treat a negative response as approval: %s", (content) => {
    expect(classifyWorkflowReviewInput(content)).not.toBe("approve");
  });

  it.each([
    "为什么推荐第二个方案？",
    "这个方案大概会花多少钱？",
    "你觉得这个画面怎么样？",
    "我想先聊聊电影蒙太奇",
    "这个方案可以怎么修改？",
    "回到工作流后应该怎么修改？",
    "继续聊聊视频生成技术",
  ])("routes a conversational question to chat: %s", (content) => {
    expect(classifyWorkflowReviewInput(content)).toBe("chat");
  });

  it("keeps chat available while a background workflow is active", async () => {
    const panel = await readFile(
      resolve(webRoot, "components/chat/chat-panel.tsx"),
      "utf8",
    );

    expect(panel).toContain("workflow.resolveUserIntent(text");
    expect(panel).toContain('if (routed === "chat") await sendChatMessage(text)');
    expect(panel).toContain(
      "const isGenerating = isChatGenerating || workflow.isSubmitting",
    );
    expect(panel).toContain("const isWorkflowProcessing = workflowStatus === \"drafting\"");
    expect(panel).toContain('const isAgentBusy = isGenerating || isQueueDispatching || workflowStatus === "drafting"');
    expect(panel).toContain("const isAgentProcessing = isAgentBusy || isWorkflowProcessing");
    expect(panel).not.toContain(
      "const isGenerating = isChatGenerating || isWorkflowLocked",
    );
  });

  it("queues new input until the current Agent turn is fully available", async () => {
    const [panel, composer, conversation] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-composer.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
    ]);

    expect(panel).toContain('status === "ready"');
    expect(panel).toContain('isGenerating || isQueueDispatching || workflowStatus === "drafting"');
    expect(panel).toContain('status === "ready" && !isAgentBusy');
    expect(panel).toContain("queuedInputs[0]");
    expect(panel).toContain("current.slice(1)");
    expect(panel).toContain("runText(nextInput.text)");
    expect(panel).toContain("current.filter((item) => item.id !== id)");
    expect(panel).toContain("setQueuedInputs([])");
    expect(composer).not.toContain("disabled={isGenerating}");
    expect(composer).toContain('aria-label={willQueueInput ? "加入发送队列" : "发送消息"}');
    expect(composer).toContain('aria-label={canStop ? "暂停并停止当前回复"');
    expect(composer).toContain('status={canStop ? "streaming" : "ready"}');
    expect(composer).toContain("onStop={onStop}");
    expect(composer).toContain("PauseIcon");
    expect(composer).not.toContain("SquareIcon");
    expect(composer).toContain('aria-label="待发送消息"');
    expect(composer).toContain("queuedInputs.map");
    expect(composer).toContain("条排队消息");
    expect(composer).toContain('from "@/src/components/ai-elements/queue"');
    expect(composer).toContain("<Queue aria-label=");
    expect(composer).toContain("<QueueSectionLabel");
    expect(composer).toContain("<QueueItemContent");
    expect(composer).not.toContain('<ol className="max-h-36');
    expect(conversation).not.toContain("QueuedMessage");
    expect(conversation).not.toContain("queuedInputs.map");
  });

  it("keeps independent in-flight chat sessions alive when switching conversations", async () => {
    const [panel, conversation] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
    ]);

    expect(panel).toContain("new Map<string, ChatSession>()");
    expect(panel).toContain("new Chat<UIMessage>");
    expect(panel).toContain("chat: activeSession.chat");
    expect(panel).toContain("await workflow.prepareConversationSwitch(conversationId)");
    expect(panel).toContain("if (!isReady) return false");
    expect(panel).toContain("activateConversation(conversationId)");
    expect(panel.indexOf("await workflow.prepareConversationSwitch(conversationId)")).toBeLessThan(panel.lastIndexOf("activateConversation(conversationId)"));
    expect(panel).toContain("messages={messages}");
    expect(panel).toContain("status={status}");
    expect(panel).not.toContain("void stop();\n    setMessages([]);");
    expect(panel).not.toContain("if (isChatGenerating) void stop()");
    expect(panel).toContain("const completedIds = new Set(completedMessageIds);");
    expect(panel).toContain("session.chat.messages.filter((message) => !completedIds.has(message.id))");
    expect(panel.indexOf("refreshConversationRef.current().then")).toBeLessThan(panel.indexOf("releasePersistedMessages();"));
    expect(panel).toContain("if (isError) {");
    expect(panel).toContain("session.chat.clearError();");
    expect(panel).toContain("当前无法连接聊天服务。我暂时无法完成回答");
    expect(panel).not.toContain("await regenerate();");
    expect(conversation).toContain("const visibleMessages = messages");
    expect(conversation).not.toContain("const visibleMessages = isLoadingHistory ? [] : messages");
    expect(conversation).not.toContain("聊天响应失败，请稍后重试");
  });
});
