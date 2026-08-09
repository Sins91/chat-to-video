import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/chat/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("chat BFF route", () => {
  it("forwards the request and AI SDK stream response", async () => {
    vi.stubEnv("API_BASE_URL", "http://api.internal:3001/");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("data: stream\n\n", {
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "request-1",
          "x-vercel-ai-ui-message-stream": "v1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
    });

    const response = await POST(
      new Request("http://web.local/api/chat", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.internal:3001/chat-agent/messages",
      expect.objectContaining({ method: "POST", body }),
    );
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    await expect(response.text()).resolves.toBe("data: stream\n\n");
  });

  it("returns a safe error when the upstream API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("internal")));

    const response = await POST(
      new Request("http://web.local/api/chat", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      code: "MODEL_GATEWAY_FAILED",
      message: "The chat service is unavailable.",
    });
  });
});
