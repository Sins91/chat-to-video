import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = resolve(import.meta.dirname, "..");

describe("two-step video workflow UI", () => {
  it("persists the conversation ID in the Agent URL and reconnects through EventSource", async () => {
    const provider = await readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8");
    expect(provider).toContain("conversationId=");
    expect(provider).toContain("new EventSource");
  });

  it("renders conversational review guidance and all video preview states", async () => {
    const [conversation, preview, artifactCard, storyboardCard] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/cinematic-artifact-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/storyboard-artifact-card.tsx"), "utf8"),
    ]);
    expect(conversation).toContain("阶段完成：");
    expect(conversation).toContain("完整结构化产物已同步到右侧展示区");
    expect(conversation).toContain("该阶段无需确认，将自动进入下一阶段。");
    expect(conversation).toContain("stageDefinition?.isRestartable === false");
    expect(conversation).toContain("automaticStageNotice(entry.artifact)");
    expect(conversation).toContain('entry.type === "cinematic_asset_batch"');
    expect(conversation).toContain("cinematicAssetBatchSummaryText(entry)");
    expect(conversation).toContain("阶段完成：素材生成");
    expect(conversation).toContain("entry.assetCount");
    expect(conversation).toContain("snapshot.assetBatch.batchId === entry.batchId");
    expect(conversation).toContain("/(无需确认|确认|修改|取消)/u");
    expect(conversation).toContain('part === "无需确认" || part === "确认" || part === "修改" || part === "取消" ? "text-warning-foreground"');
    expect(conversation).not.toContain("onApprove");
    expect(conversation).not.toContain("CinematicArtifactCard");
    expect(conversation).not.toContain("StoryboardArtifactCard");
    expect(conversation).toContain("completedVideoSummary");
    expect(conversation).toContain("insertConversationTimelineMarker");
    expect(conversation).toContain('item.type === "workflow_completion"');
    expect(conversation).toContain('snapshot?.status === "succeeded"');
    expect(conversation).toContain('snapshot.videoJob?.status === "succeeded"');
    expect(conversation).toContain("本次成片已完成");
    expect(conversation).toContain("成片已同步到右侧预览区");
    expect(conversation).toContain("hasCompletedVideo ? null");
    expect(preview).toContain("CinematicArtifactCard");
    expect(preview).toContain("StoryboardArtifactCard");
    expect(preview).toContain('aria-label="结构化创作工作区"');
    expect(preview).toContain("WorkflowPreviewShell");
    expect(preview).toContain("getWorkflowPreviewHistoryNodes");
    expect(preview).toContain("selectedHistoryNode");
    expect(preview).toContain("CURRENT_WORKFLOW_NODE_VALUE");
    expect(preview).toContain("onValueChange={(value)");
    expect(preview).toContain("selectedNodeLabel");
    expect(preview).toContain("<SelectValue>{selectedNodeLabel}</SelectValue>");
    expect(preview).toContain('contextLabel="视频 · 回看"');
    expect(preview).toContain('contextLabel="视频 · 已完成"');
    expect(preview.indexOf("if (historyWorkflowId && selectedHistoryNode)")).toBeLessThan(preview.indexOf('snapshot?.status === "cancelled"'));
    expect(preview.indexOf("if (historyWorkflowId && selectedHistoryNode)")).toBeLessThan(preview.indexOf("if (previewVideo)"));
    expect(preview.indexOf("if (historyWorkflowId && selectedHistoryNode)")).toBeLessThan(preview.indexOf('snapshot?.status === "succeeded"'));
    expect(preview.indexOf("if (historyWorkflowId && selectedHistoryNode)")).toBeLessThan(preview.indexOf('snapshot?.status === "failed"'));
    expect(preview.match(/return <WorkflowPreviewShell/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(preview.indexOf("{stepProgress ? <WorkflowStepStatusCard")).toBeLessThan(preview.indexOf("{snapshot.currentArtifact ?"));
    expect(preview).not.toContain("submitSceneDurations");
    expect(artifactCard).not.toContain("SceneDurationEditor");
    expect(artifactCard).not.toContain("<details");
    expect(storyboardCard).toContain("<details");
    expect(storyboardCard).not.toContain("group-open:hidden");
    expect(storyboardCard).toContain("aria-expanded={areShotsExpanded}");
    expect(storyboardCard).toContain("open={areShotsExpanded}");
    expect(storyboardCard).not.toContain("hidden={!isCardExpanded}");
    expect(storyboardCard).toContain("onClick={collapseExpandedDetails}");
    expect(artifactCard).not.toContain("ClapperboardIcon");
    expect(storyboardCard).not.toContain("SparklesIcon");
    expect(artifactCard).toContain("请在左侧对话中直接说明");
    expect(preview).toContain("queued");
    expect(preview).toContain("running");
    expect(preview).toContain("succeeded");
    expect(preview).toContain("failed");
    expect(preview).toContain("<VideoDownloadContextMenu");
    expect(preview).toContain('title: job.videoTitle ?? "视频成片"');
  });

  it("plays an archived video without rolling back the active workflow", async () => {
    const [provider, preview, shelf] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/generated-video-shelf.tsx"), "utf8"),
    ]);

    expect(provider).toContain("previewVideo");
    expect(provider).toContain("openGeneratedVideo");
    expect(provider).toContain("previewReturnLocationRef");
    expect(provider).toContain("const returnToCurrentVideo");
    expect(provider).toContain("setChatScrollRestoreRequest");
    expect(provider).toContain("followCurrentWorkflowPreview();");
    expect(preview).toContain("if (previewVideo)");
    expect(preview).toContain("previewVideo.workflowId");
    expect(preview).toContain("historySelection.workflowId === historyWorkflowId");
    expect(preview).toContain("视频 · 回看");
    expect(preview).toContain("onClick={() => void returnToCurrentVideo()}");
    expect(preview).toContain("返回当前");
    expect(shelf).toContain("await openGeneratedVideo(video)");
  });

  it("routes conversation by content without a separate video action", async () => {
    const panel = await readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8");

    expect(panel).toContain("createChatTransport");
    expect(panel).toContain("sendMessage({ text })");
    expect(panel).toContain("isVideoCreationIntent(text)");
    expect(panel).not.toContain("handleCreateVideo");
    expect(panel).toContain("isReviewingStoryboard");
    expect(panel).not.toContain("workflow.retryWorkflow()");
  });

  it("renders workflow failures as a normal assistant message", async () => {
    const conversation = await readFile(
      resolve(webRoot, "components/chat/chat-conversation.tsx"),
      "utf8",
    );

    expect(conversation).toContain("当前服务出现错误，建议新建对话重新开始。");
    expect(conversation).toContain('workflowErrorMessage ? <TextMessage');
    expect(conversation).not.toContain("视频工作流操作未完成");
    expect(conversation).not.toContain('role="alert"');
  });

  it("shows an intent-specific processing message before dispatching the behavior", async () => {
    const [panel, conversation, provider] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
    ]);

    expect(panel).toContain("正在确认并执行本次管线操作。");
    expect(panel).toContain("正在准备退出当前工作流。");
    expect(panel).toContain("正在检查目标管线并准备切换。");
    expect(panel).toContain("waitForPendingActionPaint()");
    expect(conversation).toContain('stepId: "pending-user-action"');
    expect(conversation).toContain("message: pendingActionMessage");
    expect(provider).toContain("appendOptimisticUserEntry");
    expect(provider).toContain("await waitForUiPaint()");
    expect(provider.indexOf("await waitForUiPaint()")).toBeLessThan(
      provider.indexOf("const result = await resolveVideoWorkflowIntent"),
    );
  });

  it("recovers an existing failed provider task instead of creating a second workflow", async () => {
    const [provider, client, retryRoute] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "lib/video-workflow-client.ts"), "utf8"),
      readFile(resolve(webRoot, "app/api/video-workflows/[workflowId]/retry/route.ts"), "utf8"),
    ]);
    expect(provider).toContain("retryVideoWorkflow(workflowId)");
    expect(provider).toContain('status: "queued"');
    expect(client).toContain("/retry");
    expect(retryRoute).toContain("proxyVideoWorkflow");
  });

  it("offers watchdog recovery through the dedicated recovery endpoint", async () => {
    const [provider, conversation, client, recoverRoute] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "lib/video-workflow-client.ts"), "utf8"),
      readFile(resolve(webRoot, "app/api/video-workflows/[workflowId]/recover/route.ts"), "utf8"),
    ]);
    expect(provider).toContain("recoverVideoWorkflow(workflowId)");
    expect(conversation).toContain("重新尝试");
    expect(conversation).toContain("<Confirmation approval=");
    expect(conversation).toContain("<ConfirmationAction disabled={isWorkflowSubmitting}");
    expect(client).toContain("/recover");
    expect(recoverRoute).toContain("proxyVideoWorkflow");
  });

  it("clears the preview immediately after exit confirmation", async () => {
    const provider = await readFile(
      resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"),
      "utf8",
    );

    expect(provider).toContain('pendingControlKind === "exit_workflow" && result.applied');
    expect(provider).toContain('status: "cancelled"');
    expect(provider).toContain("currentArtifact: null");
    expect(provider).toContain("videoJob: null");
    expect(provider).toContain("setPreviewVideo(null)");
    expect(provider).toContain("await refresh()");
  });

  it("refreshes persisted workflow guidance after control routing", async () => {
    const provider = await readFile(
      resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"),
      "utf8",
    );

    expect(provider).toContain('result.route === "workflow"');
    expect(provider).toContain("notifyConversationHistoryChanged()");
    expect(provider).toContain("await refresh()");
  });

  it("routes workflow creation through the unified API intent boundary", async () => {
    const [panel, provider] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
    ]);
    expect(panel).toContain("await workflow.resolveControlIntent(text, messageId)");
    expect(panel).not.toContain("await workflow.startWorkflow(text, crypto.randomUUID())");
    expect(panel).toContain('controlRoute.route === "workflow"');
    expect(panel).not.toContain('workflowStatus === "failed" && workflow.snapshot?.videoJob');
    expect(provider).toContain("created.conversationId === loadedConversationId");
    expect(provider).toContain("await refresh()");
  });

  it("keeps earlier workflow stages isolated when another video starts in the same conversation", async () => {
    const [conversation, artifactCard, storyboardCard, assetReviewCard] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/cinematic-artifact-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/storyboard-artifact-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/cinematic-asset-review-card.tsx"), "utf8"),
    ]);

    expect(conversation).toContain("entry.workflowId === snapshot.workflowId");
    expect(conversation).toContain("该轮生成阶段和成片已保留");
    expect(conversation).not.toContain("V{entry.storyboardVersion}");
    expect(conversation).not.toContain("分镜方案 V${version.version}");
    expect(conversation).not.toContain("版本：V${version.version}");
    expect(artifactCard).not.toContain("V{version.version}");
    expect(storyboardCard).not.toContain("V{version.version}");
    expect(assetReviewCard).not.toContain("V{batch.planVersion}");
    expect(conversation).not.toContain("历史成片 · 已由重新开始替代");
  });

  it("renders the AI Elements model selector and submits the selected model", async () => {
    const [composer, panel, provider, models] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-composer.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "lib/video-models.ts"), "utf8"),
    ]);
    expect(composer).toContain("ModelSelector");
    expect(composer).toContain('<PromptInputFooter className="font-sans">');
    expect(composer).toContain('ModelSelectorContent className="font-sans"');
    expect(composer).toContain("font-sans text-xs font-medium normal-case tracking-normal");
    expect(composer).toContain("font-sans text-xs font-normal tracking-normal");
    expect(composer).not.toContain("font-mono text-[10px] uppercase tracking-[0.06em]");
    expect(composer).toContain("focus-within:ring-foreground/15");
    expect(composer).not.toContain("focus-within:border-foreground");
    expect(composer).not.toContain("focus-within:border-ring");
    expect(composer).not.toContain("focus-within:ring-ring");
    expect(models).not.toContain("MiniMax-Hailuo-2.3");
    expect(models).toContain("doubao-seedance-2.0");
    expect(provider).toContain("videoModel,");
    expect(provider).toContain("detail.videoWorkflow.videoModel");
    expect(provider).toContain("updateVideoWorkflowModel");
    expect(panel).toContain("workflow.snapshot !== null && !workflow.snapshot.canChangeVideoModel");
    expect(provider).toContain("if (workflowId && !activeSnapshot?.canChangeVideoModel) return;");
    expect(provider.indexOf("if (workflowId && !activeSnapshot?.canChangeVideoModel) return;"))
      .toBeLessThan(provider.indexOf("setVideoModel(model);"));
    expect(composer).not.toContain("onPointerUpCapture");
  });

  it("keeps duration out of the user composer and workflow creation request", async () => {
    const [composer, panel, provider] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-composer.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
    ]);

    expect(composer).not.toContain("durationSeconds");
    expect(composer).not.toContain('type="number"');
    expect(panel).not.toContain("durationSeconds=");
    expect(provider).not.toContain("setDurationSeconds");
    expect(provider).not.toContain("DEFAULT_DURATION_SECONDS");
  });

  it("renders data-driven workflow progress and compact chat status", async () => {
    const [provider, conversation, card, tooltip] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/workflow-step-status-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/ui/tooltip.tsx"), "utf8"),
    ]);

    expect(provider).toContain("workflowStepFromEventData");
    expect(provider).toContain('"message.completed"');
    expect(provider).toContain("legacyWorkflowStep");
    expect(provider).toContain("stepProgress");
    expect(conversation).toContain("WorkflowActivityText");
    expect(conversation).toContain("<Task defaultOpen>");
    expect(conversation).toContain("<TaskTrigger");
    expect(conversation).toContain("<TaskContent");
    expect(conversation).toContain("<TaskItem");
    expect(conversation).not.toContain("ChainOfThought");
    expect(conversation).toContain("progressHistory.map");
    expect(conversation).toContain("workflowStepProgressHistory");
    expect(conversation).toContain("progress.toolActivity.toolLabel");
    expect(conversation).toContain("progress.toolActivity.summary");
    expect(conversation).toContain("progress.toolActivity ? activeActivityDetail : progress.stepLabel");
    expect(provider).toContain("appendWorkflowStepProgress");
    expect(provider).toContain("stepProgressHistory");
    expect(conversation).toContain('key="workflow-activity"');
    expect(conversation).toContain("<Shimmer");
    expect(conversation).toContain("WORKFLOW_PROGRESS_STALL_THRESHOLD_MS = 90_000");
    expect(conversation).toContain("可能阻塞");
    expect(conversation).toContain("activity={showProgressMeta && stalledActivity");
    expect(conversation).toContain("current: progress.stepIndex, total: progress.stepTotal");
    expect(conversation).not.toContain("正常进行");
    expect(conversation).not.toContain("{progress.stepIndex}/{progress.stepTotal}");
    expect(conversation).not.toContain("步骤 ${progress.stepIndex}/${progress.stepTotal}");
    expect(conversation).toContain('showProgressMeta={false}');
    expect(conversation).toContain("lastAutoScrolledInputKeyRef");
    expect(conversation).toContain("conversationContextRef.current?.scrollToBottom");
    expect(conversation).toContain("hasReviewableWorkflowAnswer");
    expect(conversation).toContain('workflowStepProgress?.stepState === "awaiting_input" && hasReviewableWorkflowAnswer');
    expect(conversation).toContain("reviewableAssetBatch");
    expect(conversation).toContain("所有素材均已生成并加载到右侧预览区");
    expect(conversation).toContain("确认后请回复“确认”");
    expect(conversation).not.toContain('id={`asset-review:${reviewableAssetBatch.batchId}`}');
    expect(conversation).toContain("visibleWorkflowStepProgress ? <WorkflowActivityText");
    expect(conversation).toContain('snapshot.failureCode === "DIRECTOR_ACTION_LIMIT_EXCEEDED"');
    expect(conversation).toContain("workflowReviewNotice");
    expect(conversation).toContain("当前规划已完成，等待确认或提出修改。");
    expect(conversation).toContain("WorkflowReviewNotice");
    expect(conversation).toContain("WORKFLOW_REVIEW_ACTION_PATTERN");
    expect(conversation).toContain('part === "无需确认" || part === "确认" || part === "修改" || part === "取消" ? "text-warning-foreground"');
    expect(conversation).toContain('text-muted-foreground" role="status"');
    expect(conversation).toContain("notice={canReview ? workflowReviewNotice : undefined}");
    expect(conversation).toContain("splitRestartConfirmationMessage(entry.content)");
    expect(conversation).toContain("notice={message.notice}");
    expect(conversation).toContain('const RESTART_CONFIRMATION_NOTICE = "请回复“确认”或“取消”。"');
    expect(conversation).not.toContain("RestartConfirmationNotice");
    expect(conversation).not.toContain("restartConfirmationText");
    expect(conversation).not.toContain("border border-warning/30 bg-warning-muted px-4 py-3");
    expect(conversation).not.toContain("WorkflowStepStatusCard");
    expect(conversation).toContain("正在理解你的问题并组织回复。");
    expect(conversation).not.toContain("正在生成结构化分镜");
    expect(card).toContain("progress.stepTotal");
    expect(card).toContain("progress.stepLabel");
    expect(card).toContain("currentStepLabel");
    expect(card).toContain("pipelineId ? findWorkflowPipelineDefinition(pipelineId) : null");
    expect(card).toContain("progress.message");
    expect(card).toContain("videoOutputEstimate.duration");
    expect(card).toContain("videoOutputEstimate.resolution");
    expect(card).toContain("预计 {videoOutputEstimate.duration} · {videoOutputEstimate.resolution}");
    expect(card).not.toContain("<dl");
    expect(card).not.toContain("预计码率");
    expect(provider).toContain("toolActivity: source.toolActivity");
    expect(provider).toContain("isWorkflowEventHistoricalReplay(workflowEvent.timestamp, initialSnapshotTimestampMs)");
    expect(card).toContain("ToolActivityIcon");
    expect(card).toContain("progress.toolActivity.toolLabel");
    expect(card).toContain("progress.toolActivity.summary");
    expect(card).toContain('progress.stepState === "running"');
    expect(card).toContain('aria-label="Agent 思考状态"');
    expect(card).toContain("正在处理当前步骤，完成前将保持此处稳定。");
    expect(card).toContain("min-h-[62px]");
    expect(card).toContain('progress.stepState === "awaiting_input"');
    expect(card).toContain("当前步骤 {progress.stepIndex} / {progress.stepTotal}");
    expect(card).not.toContain("displayedStepIndex");
    expect(card).not.toContain("completedSteps");
    expect(card).not.toContain("StateIcon");
    expect(card).toContain("pipeline.stages.map((stage) => stage.stepLabel ?? stage.label)");
    expect(card).not.toContain("DEFAULT_WORKFLOW_STEP_LABELS");
    expect(card).toContain("<TooltipContent>{stepLabel}</TooltipContent>");
    expect(card).toContain("tabIndex={0}");
    expect(card).toContain("before:-inset-x-0.5 before:-inset-y-3");
    expect(tooltip).toContain("border-border bg-popover");
    expect(tooltip).toContain("text-popover-foreground shadow-md");
  });

  it("keeps image generation progress on the current pipeline stage", async () => {
    const provider = await readFile(
      resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"),
      "utf8",
    );

    expect(provider).toContain("const stage = snapshot.currentStage;");
    expect(provider).not.toContain('const stage = snapshot.status === "queued"');
  });

  it("derives preview progress labels from the shared pipeline definition", async () => {
    const [preview, card] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/workflow-step-status-card.tsx"), "utf8"),
    ]);

    expect(card).toContain("pipelineId ? findWorkflowPipelineDefinition(pipelineId) : null");
    expect(card).toContain(
      "pipeline.stages.map((stage) => stage.stepLabel ?? stage.label)",
    );
    expect(card).not.toContain("DEFAULT_WORKFLOW_STEP_LABELS");
    expect(preview).toContain("pipelineId={snapshot.pipeline}");
    expect(preview).toContain("pipelineId={snapshot?.pipeline}");
  });

  it("treats a user-requested workflow exit as terminal and switches the preview", async () => {
    const [provider, conversation, preview] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
    ]);

    expect(provider).toContain('snapshot.status === "succeeded" || snapshot.status === "cancelled"');
    expect(provider).toContain('activeSnapshot?.status === "cancelled"');
    expect(provider).toContain('workflowEvent.type === "workflow.cancelled"');
    expect(provider).toContain("setStepView(null)");
    expect(provider).toContain("setPreviewVideo(null)");
    expect(provider).toContain("previewReturnLocationRef.current = null");
    expect(conversation).toContain('snapshot?.status === "cancelled" ? null');
    expect(preview.indexOf('snapshot?.status === "cancelled"')).toBeLessThan(
      preview.indexOf("if (previewVideo)"),
    );
    expect(preview).toContain("工作流已退出");
    expect(preview).toContain("当前预览已关闭，可以在左侧新建对话重新开始。");
  });

  it("polls and renders the live number of jobs ahead while queued", async () => {
    const [provider, preview] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
    ]);

    expect(provider).toContain("getVideoWorkflow(queuedWorkflowId)");
    expect(provider).toContain("QUEUE_POSITION_REFRESH_MS");
    expect(provider).toContain("window.setInterval");
    expect(preview).toContain("snapshot && job && isQueuedStatus(snapshot.status)");
    expect(preview).toContain("job.queueAhead");
    expect(preview).toContain("queueAhead === 0");
    expect(preview).toContain("queueMessage");
    expect(preview).toContain('job && (snapshot?.status === "queued" || snapshot?.status === "running")');
  });

  it("renders queued and running labels from the selected model snapshot", async () => {
    const preview = await readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8");
    expect(preview).toContain("getVideoModelPresentation(snapshot.videoModel)");
    expect(preview).toContain("`${model.name} 正在生成`");
    expect(preview).not.toContain('"Seedance 正在生成"');
  });

  it("restores switched conversations instantly without exposing the previous preview", async () => {
    const [conversation, panel, provider, preview, workspace] = await Promise.all([
      readFile(resolve(webRoot, "components/chat/chat-conversation.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/chat-panel.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/chat/agent-workspace.tsx"), "utf8"),
    ]);

    expect(panel).toContain("conversationId={activeSession.conversationId}");
    expect(conversation).toContain('initial={hasFocusedVideo ? false : "instant"}');
    expect(conversation).toContain('resize={status === "streaming" ? "instant" : "smooth"}');
    expect(conversation).toContain("viewportKey");
    expect(provider).toContain("conversationId: loadedConversationId");
    expect(provider).toContain("const activeEntries = entries");
    expect(provider).toContain("await loadConversation(nextConversationId)");
    expect(provider).toContain("preparedConversationIdRef.current !== null && preparedConversationIdRef.current === loadedConversationId");
    expect(provider).not.toContain("setLoadedConversationId(null);\n    setIsSubmitting(false)");
    expect(provider).toContain("setIsSubmitting(false)");
    expect(panel).toContain("onConversationSwitch={handleConversationSwitch}");
    expect(provider).toContain("snapshot: activeSnapshot");
    expect(preview).toContain("if (isLoading)");
    expect(preview).toContain("PREVIEW_LOADING_DELAY_MS");
    expect(preview).toContain("isSpinnerVisible ?");
    expect(preview).toContain('aria-label="正在加载可视化内容"');
    expect(preview).toContain('className="animate-spin text-zinc-500"');
    expect(preview).not.toContain("正在切换对话");
    expect(preview).toContain("WorkflowStepStatusCard");
    expect(preview).toContain('<ScrollArea className="h-full min-w-0">');
    expect(preview).not.toContain("overflow-y-auto");
    expect(preview).toContain("if (stepProgress)");
    expect(preview).not.toContain("absolute inset-x-4 bottom-4");
    expect(workspace).toContain("VideoWorkflowVisualization");
    expect(workspace).not.toContain("AgentVisualizationPanel");
    expect(workspace).toContain("min-h-[720px] min-w-[1380px]");
    expect(workspace).toContain("min-h-0 min-w-0 overflow-hidden max-xl:[display:none!important]");
  });

  it("merges live job progress into the preview snapshot and renders generation details", async () => {
    const [assetCard, provider, preview] = await Promise.all([
      readFile(resolve(webRoot, "components/video-workflow/cinematic-asset-review-card.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-workflow-provider.tsx"), "utf8"),
      readFile(resolve(webRoot, "components/video-workflow/video-preview.tsx"), "utf8"),
    ]);

    expect(provider).toContain('workflowEvent.type === "job.progress"');
    expect(provider).toContain("progress: workflowEvent.data.progress");
    expect(provider).toContain("asset.assetId === workflowEvent.data.jobId");
    expect(provider).toContain("assets: assetBatch.assets.map");
    expect(provider).toContain('workflowEvent.data.status === "succeeded"');
    expect(provider).toContain('type !== "agent.step" && type !== "job.progress"');
    expect(provider).toContain('workflowEvent.type === "agent.step" && workflowEvent.data.status === "awaiting_input"');
    expect(provider).toContain("scheduleRefresh(false)");
    expect(provider).toContain("scheduleRefresh(true)");
    expect(provider).not.toContain("void refresh().then(() => notifyConversationHistoryChanged())");
    expect(provider).toContain("preserveTransientUi: true");
    expect(preview).toContain("snapshot.durationSeconds");
    expect(preview).toContain("snapshot?.initialPrompt");
    expect(preview).toContain('entry.type === "text" && entry.role === "user"');
    expect(preview).toContain("预计成片 {videoOutputEstimate.duration} · {videoOutputEstimate.resolution}");
    expect(preview).not.toContain("VideoOutputEstimateDetails");
    expect(preview).toContain("generationMessage");
    expect(preview).toContain('className="w-full max-w-md rounded-xl');
    expect(preview).toContain('aria-live="polite"');
    expect(assetCard).toContain("asset.progress");
    expect(assetCard).toContain('transition-[width]');
    expect(assetCard).toContain("生成中");
  });
});
