import { describe, expect, it } from "vitest";
import { getChatErrorMessage } from "@/lib/chat-error";

describe("getChatErrorMessage", () => {
  it("returns a plain error message", () => {
    expect(getChatErrorMessage(new Error("模型服务暂时不可用"))).toBe("模型服务暂时不可用");
  });

  it("extracts the message field from a JSON error response", () => {
    expect(getChatErrorMessage(new Error('{"code":"MODEL_GATEWAY_FAILED","message":"上游模型连接失败"}'))).toBe("上游模型连接失败");
  });

  it("returns undefined when there is no error", () => {
    expect(getChatErrorMessage(undefined)).toBeUndefined();
  });

});
