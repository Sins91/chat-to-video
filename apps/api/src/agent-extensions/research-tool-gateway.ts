import type { WebSearchResult } from "@chat-to-video/tools";

export const RESEARCH_TOOL_GATEWAY = Symbol("RESEARCH_TOOL_GATEWAY");

export type ResearchToolGateway = {
  searchWeb(input: {
    query: string;
    count: number;
    freshness?: "day" | "week" | "month" | "year";
  }): Promise<{ provider: "apimart"; query: string; results: WebSearchResult[] }>;
};
