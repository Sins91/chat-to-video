import { describe, expect, it, vi } from "vitest";
import { createReferenceImageDraft } from "@/lib/reference-image-draft";
import { deferred } from "./helpers/deferred";

describe("reference image draft ownership", () => {
  it("discards a late upload after switching drafts without touching the new draft", async () => {
    const cleanup = { revokeObjectUrl: vi.fn(), abandon: vi.fn() };
    const previous = createReferenceImageDraft(cleanup);
    previous.register("local-a", "blob:a");
    const upload = deferred<string>();
    const result = upload.promise.then((id) => previous.resolve("local-a", id));
    previous.dispose();
    const current = createReferenceImageDraft(cleanup);
    current.register("local-b", "blob:b");
    upload.resolve("remote-a");
    expect(await result).toBe(false);
    expect(cleanup.abandon).toHaveBeenCalledWith("remote-a");
    expect(cleanup.revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(current.size).toBe(1);
    expect(current.resolve("local-b", "remote-b")).toBe(true);
  });

  it("keeps submitted image ownership when the composer later unmounts", () => {
    const cleanup = { revokeObjectUrl: vi.fn(), abandon: vi.fn() };
    const draft = createReferenceImageDraft(cleanup);
    draft.register("local", "blob:image");
    expect(draft.resolve("local", "remote")).toBe(true);
    draft.release();
    draft.dispose();
    expect(cleanup.abandon).not.toHaveBeenCalled();
    expect(cleanup.revokeObjectUrl).toHaveBeenCalledExactlyOnceWith("blob:image");
  });

  it("abandons unsubmitted ready images once and suppresses late failures", async () => {
    const cleanup = { revokeObjectUrl: vi.fn(), abandon: vi.fn() };
    const draft = createReferenceImageDraft(cleanup);
    draft.register("ready", "blob:ready");
    draft.resolve("ready", "remote");
    draft.register("pending", "blob:pending");
    const upload = deferred<string>();
    const visibleErrors: string[] = [];
    const pending = upload.promise.catch(() => {
      if (draft.reject("pending")) visibleErrors.push("failed");
    });
    draft.dispose();
    draft.dispose();
    upload.reject(new Error("upload failed"));
    await pending;
    expect(visibleErrors).toEqual([]);
    expect(cleanup.abandon).toHaveBeenCalledExactlyOnceWith("remote");
    expect(cleanup.revokeObjectUrl).toHaveBeenCalledTimes(2);
  });

  it("cleans up removal during upload and still allows failures in the active draft", () => {
    const cleanup = { revokeObjectUrl: vi.fn(), abandon: vi.fn() };
    const draft = createReferenceImageDraft(cleanup);
    draft.register("removed", "blob:removed");
    draft.remove("removed");
    expect(draft.resolve("removed", "remote-removed")).toBe(false);
    expect(cleanup.abandon).toHaveBeenCalledWith("remote-removed");
    draft.register("failed", "blob:failed");
    expect(draft.reject("failed")).toBe(true);
    draft.dispose();
    expect(cleanup.revokeObjectUrl).toHaveBeenCalledTimes(2);
  });
});
