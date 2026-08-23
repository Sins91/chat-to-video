import {
  CINEMATIC_PIPELINE_DEFINITION,
  parseWorkflowControlCommand,
  type VideoWorkflowSnapshot,
} from "@chat-to-video/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import {
  chatQueueItemsForConversation,
  selectDispatchableChatQueueHeads,
  useChatQueueStore,
} from "@/lib/chat-queue-store";
import {
  canDispatchWorkflowCommandImmediately,
  deriveWorkflowInteractionState,
  workflowComposerPlaceholder,
} from "@/lib/workflow-interaction-state";

const conversationA = "00000000-0000-4000-8000-000000000010";
const conversationB = "00000000-0000-4000-8000-000000000011";

const snapshot = (
  status: VideoWorkflowSnapshot["status"],
  currentStage: VideoWorkflowSnapshot["currentStage"] = "proposal",
  extra: Partial<VideoWorkflowSnapshot> = {},
): VideoWorkflowSnapshot => ({
  pipeline: "cinematic-production",
  status,
  currentStage,
  ...extra,
} as VideoWorkflowSnapshot);

describe("workflow interaction state", () => {
  it.each(["drafting", "queued", "running"] as const)(
    "treats %s as processing",
    (status) => expect(deriveWorkflowInteractionState(snapshot(status)).kind).toBe("processing"),
  );

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "treats %s as terminal",
    (status) => expect(deriveWorkflowInteractionState(snapshot(status)).kind).toBe("terminal"),
  );

  it("distinguishes planning review from consistency-reference and asset execution review", () => {
    expect(deriveWorkflowInteractionState(snapshot("awaiting_input", "script")).kind)
      .toBe("planning_review");
    const consistency = deriveWorkflowInteractionState(snapshot(
      "awaiting_input",
      "consistency_reference",
      {
        consistencyReferenceBatch: {
          stageId: "consistency_reference",
          status: "awaiting_approval",
        },
      } as Partial<VideoWorkflowSnapshot>,
    ));
    expect(consistency).toMatchObject({
      kind: "execution_review",
      stageId: "consistency_reference",
    });
    expect(workflowComposerPlaceholder(consistency)).toContain("一致性参考");

    expect(deriveWorkflowInteractionState(snapshot("awaiting_input", "assets", {
      assetBatch: { stageId: "assets", status: "awaiting_approval" },
    } as Partial<VideoWorkflowSnapshot>))).toMatchObject({
      kind: "execution_review",
      stageId: "assets",
    });
  });

  it("only lets bare confirm or cancel bypass the queue for a pending control", () => {
    const confirm = parseWorkflowControlCommand("确认", CINEMATIC_PIPELINE_DEFINITION);
    const cancel = parseWorkflowControlCommand("取消", CINEMATIC_PIPELINE_DEFINITION);
    const restart = parseWorkflowControlCommand("从脚本重新开始", CINEMATIC_PIPELINE_DEFINITION);
    expect(canDispatchWorkflowCommandImmediately(confirm, null)).toBe(false);
    expect(canDispatchWorkflowCommandImmediately(cancel, null)).toBe(false);
    expect(canDispatchWorkflowCommandImmediately(confirm, {} as never)).toBe(true);
    expect(canDispatchWorkflowCommandImmediately(cancel, {} as never)).toBe(true);
    expect(canDispatchWorkflowCommandImmediately(restart, null)).toBe(true);
  });
});

describe("conversation-isolated chat queue", () => {
  beforeEach(() => {
    useChatQueueStore.setState({ items: [], isHydrated: true });
  });

  it("keeps FIFO records when switching A to B and back to A", () => {
    const enqueue = useChatQueueStore.getState().enqueue;
    const first = enqueue({
      conversationId: conversationA,
      messageId: "message-a-1",
      text: "A 的第一条",
      referenceImages: [],
      videoModel: "doubao-seedance-2.0",
      subtitlesEnabled: false,
    });
    enqueue({
      conversationId: conversationB,
      messageId: "message-b-1",
      text: "B 的第一条",
      referenceImages: [],
      videoModel: "doubao-seedance-2.0",
      subtitlesEnabled: false,
    });
    const second = enqueue({
      conversationId: conversationA,
      messageId: "message-a-2",
      text: "A 的第二条",
      referenceImages: [],
      videoModel: "doubao-seedance-2.0",
      subtitlesEnabled: true,
    });

    expect(chatQueueItemsForConversation(useChatQueueStore.getState().items, conversationB))
      .toHaveLength(1);
    expect(chatQueueItemsForConversation(useChatQueueStore.getState().items, conversationA)
      .map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it("exposes failed items for retry and removes all records for a deleted conversation", () => {
    const store = useChatQueueStore.getState();
    const item = store.enqueue({
      conversationId: conversationA,
      messageId: "message-a-1",
      text: "稍后重试",
      referenceImages: [],
      videoModel: "doubao-seedance-2.0",
      subtitlesEnabled: false,
    });
    useChatQueueStore.getState().markFailed(item.id, "会话已删除");
    expect(useChatQueueStore.getState().items[0]).toMatchObject({ status: "failed" });
    useChatQueueStore.getState().retry(item.id);
    expect(useChatQueueStore.getState().items[0]).toMatchObject({
      status: "queued",
      errorMessage: null,
    });
    expect(useChatQueueStore.getState().removeConversation(conversationA)).toHaveLength(1);
    expect(useChatQueueStore.getState().items).toHaveLength(0);
  });

  it("dispatches at most two conversation heads and never skips a failed FIFO head", () => {
    const enqueue = useChatQueueStore.getState().enqueue;
    const failedHead = enqueue({
      conversationId: conversationA,
      messageId: "message-a-1",
      text: "A 的失败头部",
      referenceImages: [],
      videoModel: "doubao-seedance-2.0",
      subtitlesEnabled: false,
    });
    enqueue({
      conversationId: conversationA,
      messageId: "message-a-2",
      text: "A 不能越过头部",
      referenceImages: [],
      videoModel: "doubao-seedance-2.0",
      subtitlesEnabled: false,
    });
    const conversationBHead = enqueue({
      conversationId: conversationB,
      messageId: "message-b-1",
      text: "B 可以独立发送",
      referenceImages: [],
      videoModel: "doubao-seedance-2.0",
      subtitlesEnabled: false,
    });
    useChatQueueStore.getState().markFailed(failedHead.id, "永久失败");

    expect(selectDispatchableChatQueueHeads({
      items: useChatQueueStore.getState().items,
      activeConversationIds: new Set(),
      now: Date.now(),
      limit: 2,
    }).map((item) => item.id)).toEqual([conversationBHead.id]);
  });
});
