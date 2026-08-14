import { Inject, Injectable } from "@nestjs/common";
import { searchWeb } from "@chat-to-video/tools";

import type { ResearchToolGateway } from "../agent-extensions/research-tool-gateway.js";
import { APIMART_CONFIG, type ApimartConfig } from "./apimart.config.js";

@Injectable()
export class ApimartResearchToolGateway implements ResearchToolGateway {
  constructor(@Inject(APIMART_CONFIG) private readonly config: ApimartConfig) {}

  searchWeb(input: {
    query: string;
    count: number;
    freshness?: "day" | "week" | "month" | "year";
  }) {
    return searchWeb({
      ...input,
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseUrl,
      model: this.config.modelId,
      timeoutMs: this.config.timeoutMs,
    });
  }
}
