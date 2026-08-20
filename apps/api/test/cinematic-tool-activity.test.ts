import type { CinematicArtifact } from "@chat-to-video/contracts";
import { APICallError } from "ai";
import { describe, expect, it, vi } from "vitest";

import { ApimartModelGateway } from "../src/model-gateway/apimart-model-gateway.js";
import type { MastraAgents } from "../src/model-gateway/mastra-agents.js";
import type { ModelToolActivity } from "../src/model-gateway/model-gateway.js";

type HookContext = {
  readonly toolName: string;
  readonly input: unknown;
  readonly context: unknown;
  readonly error?: unknown;
};

type GenerateOptionsWithHooks = {
  readonly hooks: {
    readonly beforeToolCall: (context: HookContext) => void | Promise<void>;
    readonly afterToolCall: (context: HookContext) => void | Promise<void>;
  };
};

const researchArtifact: CinematicArtifact = {
  stage: "research",
  data: {
    summary: "A restrained noir mood.",
    sourceMode: "generated",
    moodKeywords: ["noir", "rain", "mystery"],
    visualReferences: [
      { title: "Wet street", description: "Reflections and sodium light.", url: null },
      { title: "Sealed letter", description: "Macro paper texture.", url: null },
      { title: "Empty doorway", description: "Negative space and silhouette.", url: null },
    ],
    musicDirection: "Low strings and rain ambience.",
    soundDirection: "Rain, dialogue, and synchronized effects; no score.",
    productionConstraints: ["Ten second runtime"],
  },
};

const createRequest = (onToolActivity: (activity: ModelToolActivity) => void | Promise<void>) => ({
  requestId: "00000000-0000-4000-8000-000000000001",
  workflowId: "00000000-0000-4000-8000-000000000002",
  conversationId: "00000000-0000-4000-8000-000000000003",
  tenantId: "tenant-1",
  projectId: "project-1",
  initialPrompt: "Create a rainy noir short film.",
  stage: "research" as const,
  videoModel: "MiniMax-Hailuo-2.3" as const,
  durationSeconds: 10,
  modelMaxDurationSeconds: 10,
  approvedArtifacts: [],
  onToolActivity,
});

const createAgents = (generate: ReturnType<typeof vi.fn>): MastraAgents => ({
  cinematic: { generate },
  cinematicStructurer: {
    generate: vi.fn().mockResolvedValue({ object: researchArtifact }),
  },
  chat: { stream: vi.fn() },
  storyboard: { generate: vi.fn() },
  providerName: "deepseek",
  storyboardTimeoutMs: 120_000,
  timeoutMs: 30_000,
} as unknown as MastraAgents);

describe("Cinematic tool activity", () => {
  it("emits ordered, redacted lifecycle updates for successful and failed tools", async () => {
    const activities: ModelToolActivity[] = [];
    const generate = vi.fn().mockImplementation(
      async (_prompt: unknown, options: GenerateOptionsWithHooks) => {
        const secretInput = { query: "rain", token: "secret-input" };
        await options.hooks.beforeToolCall({
          toolName: "search_assets",
          input: secretInput,
          context: {},
        });
        await options.hooks.afterToolCall({
          toolName: "search_assets",
          input: secretInput,
          context: {},
        });
        await options.hooks.beforeToolCall({
          toolName: "inspect/source",
          input: { signedUrl: "secret-url" },
          context: {},
        });
        await options.hooks.afterToolCall({
          toolName: "inspect/source",
          input: { signedUrl: "secret-url" },
          context: {},
          error: new Error("secret-provider-error"),
        });
        return { text: "Grounded research evidence." };
      },
    );
    const gateway = new ApimartModelGateway(createAgents(generate));

    await gateway.generateCinematicArtifact(createRequest((activity) => {
      activities.push(activity);
    }));

    expect(activities.map(({ state, attempt, activitySequence }) => ({
      state,
      attempt,
      activitySequence,
    }))).toEqual([
      { state: "running", attempt: 1, activitySequence: 1 },
      { state: "completed", attempt: 1, activitySequence: 2 },
      { state: "running", attempt: 1, activitySequence: 3 },
      { state: "failed", attempt: 1, activitySequence: 4 },
    ]);
    expect(activities[0]).toMatchObject({
      toolName: "search_assets",
      toolLabel: "search assets",
      summary: "调用 search assets",
    });
    expect(activities[1]).toMatchObject({
      toolName: "search_assets",
      toolLabel: "search assets",
      summary: "调用 search assets",
    });
    expect(JSON.stringify(activities)).not.toContain("运行完成");
    expect(activities[2]?.toolName).toBe("inspect-source");
    expect(JSON.stringify(activities)).not.toContain("secret");
  });

  it("uses the generation attempt and activity sequence as a stable composite identity", async () => {
    const activities: ModelToolActivity[] = [];
    let attempt = 0;
    const generate = vi.fn().mockImplementation(
      async (_prompt: unknown, options: GenerateOptionsWithHooks) => {
        attempt += 1;
        await options.hooks.beforeToolCall({
          toolName: "search_assets",
          input: {},
          context: {},
        });
        if (attempt === 1) {
          throw new APICallError({
            message: "fetch failed",
            url: "https://api.example.test/v1/chat/completions",
            requestBodyValues: {},
            isRetryable: true,
          });
        }
        return { text: "Grounded research evidence." };
      },
    );
    const gateway = new ApimartModelGateway(createAgents(generate));

    await gateway.generateCinematicArtifact(createRequest((activity) => {
      activities.push(activity);
    }));

    expect(activities.map(({ attempt: generationAttempt, activitySequence }) =>
      `${generationAttempt}:${activitySequence}`,
    )).toEqual(["1:1", "2:1"]);
  });

  it("does not fail model generation when activity persistence rejects", async () => {
    const generate = vi.fn().mockImplementation(
      async (_prompt: unknown, options: GenerateOptionsWithHooks) => {
        await options.hooks.beforeToolCall({
          toolName: "search_assets",
          input: {},
          context: {},
        });
        return { text: "Grounded research evidence." };
      },
    );
    const gateway = new ApimartModelGateway(createAgents(generate));

    await expect(gateway.generateCinematicArtifact(
      createRequest(() => Promise.reject(new Error("database unavailable"))),
    )).resolves.toEqual(researchArtifact);
  });
});
