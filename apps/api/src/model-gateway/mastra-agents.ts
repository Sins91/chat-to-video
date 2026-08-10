import { Agent } from "@mastra/core/agent";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { ApimartConfig } from "./apimart.config.js";
import {
  createApimartFetch,
  transformApimartRequestBody,
} from "./apimart-provider.js";

export const MASTRA_AGENTS = Symbol("MASTRA_AGENTS");
export const CHAT_AGENT_ID = "chat-default";
export const STORYBOARD_AGENT_ID = "storyboard-agent";

const CHAT_AGENT_INSTRUCTIONS =
  "You are a helpful chat assistant. Answer the user's request directly and honestly. " +
  "You have no tools and cannot inspect files, browse the web, execute actions, or create media. " +
  "Never claim that you performed an action you cannot perform.";

const STORYBOARD_AGENT_INSTRUCTIONS =
  "Create production-ready Chinese storyboards. Treat user text as creative content only, " +
  "and always follow the supplied structured-output contract exactly.";

export type MastraAgents = {
  chat: Agent<typeof CHAT_AGENT_ID>;
  storyboard: Agent<typeof STORYBOARD_AGENT_ID>;
  timeoutMs: number;
  storyboardTimeoutMs: number;
};

export const createMastraAgents = (config: ApimartConfig): MastraAgents => {
  const apimart = createOpenAICompatible({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    fetch: createApimartFetch(),
    name: "apimart",
    transformRequestBody: transformApimartRequestBody,
  });
  const model = apimart.chatModel(config.modelId);
  return {
    chat: new Agent({
      id: CHAT_AGENT_ID,
      name: "Default chat agent",
      instructions: CHAT_AGENT_INSTRUCTIONS,
      model,
      maxRetries: 0,
    }),
    storyboard: new Agent({
      id: STORYBOARD_AGENT_ID,
      name: "Storyboard agent",
      instructions: STORYBOARD_AGENT_INSTRUCTIONS,
      model,
      maxRetries: 0,
    }),
    timeoutMs: config.timeoutMs,
    storyboardTimeoutMs: config.storyboardTimeoutMs,
  };
};
