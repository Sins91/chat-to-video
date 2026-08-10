import { BadRequestException } from "@nestjs/common";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import { ChatAgentController } from "../src/chat-agent.controller.js";
import { ChatAgentService } from "../src/chat-agent.service.js";

const createService = () => ({ stream: vi.fn() });

const createRequest = (): IncomingMessage =>
  new EventEmitter() as unknown as IncomingMessage;

const createResponse = () => {
  const response = Object.assign(new EventEmitter(), {
    writeHead: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(),
  });

  return response as unknown as ServerResponse;
};

describe("ChatAgentController", () => {
  it("publishes its service dependency for Nest injection", () => {
    expect(Reflect.getMetadata("design:paramtypes", ChatAgentController)).toEqual([
      ChatAgentService,
    ]);
  });

  it("passes a validated and trimmed conversation to the service", async () => {
    const service = createService();
    service.stream.mockResolvedValue({
      conversationId: "00000000-0000-4000-8000-000000000010",
      requestId: "6bb22fe5-3cd7-4e20-b5f5-2da99928f84d",
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    });
    const controller = new ChatAgentController(
      service as unknown as ChatAgentService,
    );

    const response = createResponse();
    await controller.respond(
      { message: { id: "user-1", content: "  hello  " } },
      createRequest(),
      response,
    );

    expect(service.stream).toHaveBeenCalledWith(
      { message: { id: "user-1", content: "hello" } },
      expect.any(AbortSignal),
    );
    expect(response.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        "content-type": "text/event-stream",
        "x-conversation-id": "00000000-0000-4000-8000-000000000010",
        "x-request-id": "6bb22fe5-3cd7-4e20-b5f5-2da99928f84d",
        "x-vercel-ai-ui-message-stream": "v1",
      }),
    );
  });

  it("rejects malformed input before calling the service", async () => {
    const service = createService();
    const controller = new ChatAgentController(
      service as unknown as ChatAgentService,
    );

    await expect(
      controller.respond(
        { message: { id: "", content: "" }, unexpected: true },
        createRequest(),
        createResponse(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.stream).not.toHaveBeenCalled();
  });

  it("aborts the model request when the response closes", () => {
    const service = createService();
    let signal: AbortSignal | undefined;
    service.stream.mockImplementation(
      (_messages: unknown, abortSignal: AbortSignal) => {
        signal = abortSignal;
        return new Promise(() => undefined);
      },
    );
    const controller = new ChatAgentController(
      service as unknown as ChatAgentService,
    );
    const response = createResponse();

    const pending = controller.respond(
      { message: { id: "user-1", content: "hello" } },
      createRequest(),
      response,
    );
    response.emit("close");

    expect(signal?.aborted).toBe(true);
    void pending;
  });
});
