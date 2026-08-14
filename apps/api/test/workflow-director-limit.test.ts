import type { ConversationRepository, VideoWorkflowRepository } from "@chat-to-video/database";
import { describe, expect, it, vi } from "vitest";

import type { ModelGateway } from "../src/model-gateway/model-gateway.js";
import type { VideoWorkflowOperations } from "../src/video-workflow/video-workflow.operations.js";
import {
  DIRECTOR_ACTION_LIMIT,
  DIRECTOR_FALLBACK_REPLY,
  WorkflowDirectorService,
} from "../src/video-workflow/workflow-director.service.js";
import type { WorkflowEventService } from "../src/video-workflow/workflow-event.service.js";

describe("workflow director action limit", () => {
  const proposal = {
    stage: "proposal" as const,
    data: {
      directions: [
        { id: "direction-1", title: "方向一", logline: "方向一故事", emotionalArc: ["起", "承", "转"], visualTreatment: "写实", colorPalette: ["黑", "白", "灰"], musicDirection: "克制" },
        { id: "direction-2", title: "方向二", logline: "方向二故事", emotionalArc: ["起", "承", "转"], visualTreatment: "诗意", colorPalette: ["蓝", "金", "白"], musicDirection: "温暖" },
        { id: "direction-3", title: "方向三", logline: "方向三故事", emotionalArc: ["起", "承", "转"], visualTreatment: "纪实", colorPalette: ["绿", "棕", "白"], musicDirection: "自然" },
      ],
      recommendedDirectionId: "direction-1",
      rendererFamily: "ffmpeg" as const,
      durationSeconds: 5,
      estimatedCostUsd: 1,
      deliveryPromise: "交付五秒短片",
    },
  };

  it("ends with a normal persisted fallback reply before attempting action 19", async () => {
    const updateWorkflow = vi.fn().mockResolvedValue(undefined);
    const updateDirectorCycle = vi.fn().mockResolvedValue(undefined);
    const appendMessage = vi.fn().mockResolvedValue(undefined);
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const service = new WorkflowDirectorService(
      {
        findWorkflow: vi.fn().mockResolvedValue({
          conversationId: "00000000-0000-4000-8000-000000000003",
          requestId: "00000000-0000-4000-8000-000000000004",
          stateVersion: 8,
          currentStageId: "proposal",
          currentVersion: 1,
        }),
        updateWorkflow,
        updateDirectorCycle,
      } as unknown as VideoWorkflowRepository,
      { appendMessage } as unknown as ConversationRepository,
      {} as ModelGateway,
      {} as VideoWorkflowOperations,
      { append: appendEvent } as unknown as WorkflowEventService,
    );

    expect(DIRECTOR_ACTION_LIMIT).toBe(18);
    await expect(service.runCycle({
      workflowId: "00000000-0000-4000-8000-000000000001",
      cycleId: "00000000-0000-4000-8000-000000000002",
      iteration: DIRECTOR_ACTION_LIMIT + 1,
    })).resolves.toMatchObject({ outcome: "terminal", actionId: null });

    expect(updateWorkflow).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({
        status: "failed",
        failureCode: "DIRECTOR_ACTION_LIMIT_EXCEEDED",
        errorMessage: null,
      }),
    );
    expect(updateDirectorCycle).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000002",
      {
        status: "failed",
        errorCode: "DIRECTOR_ACTION_LIMIT_EXCEEDED",
      },
    );
    expect(appendMessage).toHaveBeenCalledWith({
      conversationId: "00000000-0000-4000-8000-000000000003",
      messageId: "00000000-0000-4000-8000-000000000002:fallback",
      role: "assistant",
      content: DIRECTOR_FALLBACK_REPLY,
    });
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "message.completed",
      data: { messageId: "00000000-0000-4000-8000-000000000002:fallback" },
    }));
  });

  it("allows a legal stage transition even when it records decisions for the next approval gate", async () => {
    const repository = {
      findWorkflowScope: vi.fn().mockResolvedValue({
        tenantId: "tenant-1",
        projectId: "project-1",
        workflow: {
          id: "00000000-0000-4000-8000-000000000001",
          conversationId: "00000000-0000-4000-8000-000000000003",
          requestId: "00000000-0000-4000-8000-000000000004",
          currentStageId: "research",
          stateVersion: 1,
          currentVersion: 1,
          status: "drafting",
          initialPrompt: "制作一段湖面视频",
          durationSeconds: 5,
          videoModel: "doubao-seedance-2.0",
        },
      }),
      listCinematicArtifacts: vi.fn().mockResolvedValue([{
        stage: "research",
        version: 1,
        artifact: { stage: "research", data: {} },
      }]),
      listPendingWorkflowApprovals: vi.fn().mockResolvedValue([]),
      findLatestCinematicAssetBatch: vi.fn().mockResolvedValue(null),
      findWorkflowVideoJob: vi.fn().mockResolvedValue(null),
      listProductionDecisions: vi.fn().mockResolvedValue([]),
      updateDirectorCycle: vi.fn().mockResolvedValue(undefined),
      saveDirectorProposal: vi.fn().mockResolvedValue(undefined),
      claimDirectorAction: vi.fn().mockResolvedValue(true),
      saveProductionDecisions: vi.fn().mockResolvedValue(undefined),
      updateWorkflow: vi.fn().mockResolvedValue(undefined),
      completeDirectorAction: vi.fn().mockResolvedValue(undefined),
    };
    const decideWorkflowAction = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      expectedStateVersion: 1,
      rationale: "研究已完成，进入创意方案阶段。",
      confidence: 0.9,
      decisionEntries: [{
        category: "render_runtime",
        subject: "成片合成运行时",
        value: "待方案阶段确认",
        estimatedCostUsd: null,
        requiresApproval: true,
      }],
      action: {
        type: "advance_stage",
        fromStageId: "research",
        toStageId: "proposal",
      },
    });
    const append = vi.fn().mockResolvedValue(undefined);
    const service = new WorkflowDirectorService(
      repository as unknown as VideoWorkflowRepository,
      {} as ConversationRepository,
      { decideWorkflowAction } as unknown as ModelGateway,
      { getDirectorCapabilityResolutions: vi.fn().mockResolvedValue([]) } as unknown as VideoWorkflowOperations,
      { append } as unknown as WorkflowEventService,
    );

    await expect(service.runCycle({
      workflowId: "00000000-0000-4000-8000-000000000001",
      cycleId: "00000000-0000-4000-8000-000000000002",
      iteration: 2,
    })).resolves.toMatchObject({ outcome: "continue", stage: "proposal" });
    expect(repository.saveDirectorProposal).toHaveBeenCalledWith(expect.objectContaining({
      status: "proposed",
    }));
    expect(repository.updateWorkflow).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      expect.objectContaining({ currentStageId: "proposal" }),
    );
    const expectedStepData: unknown = expect.objectContaining({
      stepId: "proposal",
      stepState: "running",
    });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      type: "agent.step",
      data: expectedStepData,
    }));
  });

  it("audits and rejects a Director proposal that repeats an approved stage", async () => {
    const repository = {
      findWorkflowScope: vi.fn().mockResolvedValue({
        tenantId: "tenant-1",
        projectId: "project-1",
        workflow: {
          id: "00000000-0000-4000-8000-000000000001",
          conversationId: "00000000-0000-4000-8000-000000000003",
          requestId: "00000000-0000-4000-8000-000000000004",
          currentStageId: "proposal",
          stateVersion: 2,
          currentVersion: 1,
          status: "drafting",
          initialPrompt: "制作湖面短片",
          durationSeconds: 5,
          videoModel: "doubao-seedance-2.0",
        },
      }),
      listCinematicArtifacts: vi.fn().mockResolvedValue([{
        stage: "proposal",
        version: 1,
        artifact: proposal,
      }]),
      listPendingWorkflowApprovals: vi.fn().mockResolvedValue([]),
      findLatestCinematicAssetBatch: vi.fn().mockResolvedValue(null),
      findWorkflowVideoJob: vi.fn().mockResolvedValue(null),
      listProductionDecisions: vi.fn().mockResolvedValue([]),
      updateDirectorCycle: vi.fn().mockResolvedValue(undefined),
      saveDirectorProposal: vi.fn().mockResolvedValue(undefined),
      claimDirectorAction: vi.fn().mockResolvedValue(true),
      saveProductionDecisions: vi.fn().mockResolvedValue(undefined),
      updateWorkflow: vi.fn().mockResolvedValue(undefined),
      completeDirectorAction: vi.fn().mockResolvedValue(undefined),
    };
    const service = new WorkflowDirectorService(
      repository as unknown as VideoWorkflowRepository,
      {} as ConversationRepository,
      { decideWorkflowAction: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        expectedStateVersion: 2,
        rationale: "模型错误地再次请求创意方案审批。",
        confidence: 0.8,
        decisionEntries: [],
        action: {
          type: "produce_artifact",
          stageId: "proposal",
          artifact: proposal,
          disposition: "request_approval",
        },
      }) } as unknown as ModelGateway,
      { getDirectorCapabilityResolutions: vi.fn().mockResolvedValue([]) } as unknown as VideoWorkflowOperations,
      { append: vi.fn().mockResolvedValue(undefined) } as unknown as WorkflowEventService,
    );

    await expect(service.runCycle({
      workflowId: "00000000-0000-4000-8000-000000000001",
      cycleId: "00000000-0000-4000-8000-000000000002",
      iteration: 1,
      interaction: { type: "approve" },
      trigger: {
        type: "approval_claimed",
        stateVersion: 2,
        approvals: [{
          approvalId: "00000000-0000-4000-8000-000000000020",
          scope: "artifact",
          stageId: "proposal",
          targetId: "00000000-0000-4000-8000-000000000001:1",
          targetVersion: 1,
        }],
      },
    })).resolves.toMatchObject({
      outcome: "continue",
      stage: "proposal",
      policyRejection: { code: "APPROVAL_TRIGGER_ACTION_MISMATCH" },
    });
    const rejectedAction: unknown = expect.objectContaining({ type: "produce_artifact" });
    expect(repository.saveDirectorProposal).toHaveBeenCalledWith(expect.objectContaining({
      status: "rejected",
      action: rejectedAction,
      policyCode: "APPROVAL_TRIGGER_ACTION_MISMATCH",
    }));
    expect(repository.updateWorkflow).not.toHaveBeenCalled();
  });

  it("records and continues an explicit selection-only proposal revision", async () => {
    const activateCinematicArtifact = vi.fn().mockResolvedValue(undefined);
    const recordApprovedWorkflowApproval = vi.fn().mockResolvedValue("approval-1");
    const repository = {
      findWorkflowScope: vi.fn().mockResolvedValue({
        tenantId: "tenant-1",
        projectId: "project-1",
        workflow: {
          id: "00000000-0000-4000-8000-000000000001",
          conversationId: "00000000-0000-4000-8000-000000000003",
          requestId: "00000000-0000-4000-8000-000000000004",
          currentStageId: "proposal",
          stateVersion: 2,
          currentVersion: 1,
          status: "drafting",
          initialPrompt: "制作湖面短片",
          durationSeconds: 5,
          videoModel: "doubao-seedance-2.0",
        },
      }),
      listCinematicArtifacts: vi.fn().mockResolvedValue([{ stage: "proposal", version: 1, artifact: proposal }]),
      listPendingWorkflowApprovals: vi.fn().mockResolvedValue([]),
      findLatestCinematicAssetBatch: vi.fn().mockResolvedValue(null),
      findWorkflowVideoJob: vi.fn().mockResolvedValue(null),
      listProductionDecisions: vi.fn().mockResolvedValue([]),
      updateDirectorCycle: vi.fn().mockResolvedValue(undefined),
      saveDirectorProposal: vi.fn().mockResolvedValue(undefined),
      claimDirectorAction: vi.fn().mockResolvedValue(true),
      saveProductionDecisions: vi.fn().mockResolvedValue(undefined),
      recordApprovedWorkflowApproval,
      completeDirectorAction: vi.fn().mockResolvedValue(undefined),
    };
    const deterministicProposal = {
      ...proposal,
      data: { ...proposal.data, recommendedDirectionId: "direction-2" },
    };
    const service = new WorkflowDirectorService(
      repository as unknown as VideoWorkflowRepository,
      {} as ConversationRepository,
      { decideWorkflowAction: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        expectedStateVersion: 2,
        rationale: "按用户选择切换到方向二并继续。",
        confidence: 0.95,
        decisionEntries: [],
        action: {
          type: "produce_artifact",
          stageId: "proposal",
          artifact: deterministicProposal,
          disposition: "request_approval",
        },
      }) } as unknown as ModelGateway,
      {
        getDirectorCapabilityResolutions: vi.fn().mockResolvedValue([]),
        activateCinematicArtifact,
      } as unknown as VideoWorkflowOperations,
      { append: vi.fn().mockResolvedValue(undefined) } as unknown as WorkflowEventService,
    );

    await expect(service.runCycle({
      workflowId: "00000000-0000-4000-8000-000000000001",
      cycleId: "00000000-0000-4000-8000-000000000002",
      iteration: 1,
      interaction: {
        type: "message",
        messageId: "selection-message",
        text: "选择第二个方案，直接进入下一步",
        advanceAfterChange: true,
      },
    })).resolves.toMatchObject({ outcome: "continue", artifactVersion: 2 });
    expect(activateCinematicArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifact: deterministicProposal,
      requiresApproval: false,
    }));
    expect(recordApprovedWorkflowApproval).toHaveBeenCalledWith(expect.objectContaining({
      stageId: "proposal",
      targetVersion: 2,
      userMessageId: "selection-message",
    }));
  });
});
