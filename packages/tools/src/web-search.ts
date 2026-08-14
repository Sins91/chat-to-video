import {
  apimartAuthorization,
  apimartEndpoint,
  apimartJsonError,
  record,
  unwrapApimartData,
} from "./apimart-runtime.js";

export type WebSearchResult = { title: string; url: string; description: string; age: string | null };

const responseText = (raw: unknown): string | null => {
  const value = unwrapApimartData(raw);
  if (!record(value)) return null;
  if (typeof value.output_text === "string") return value.output_text;
  if (Array.isArray(value.choices)) {
    const choice = value.choices.find(record);
    if (choice && record(choice.message) && typeof choice.message.content === "string") return choice.message.content;
  }
  if (Array.isArray(value.output)) {
    for (const item of value.output) {
      if (!record(item) || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (record(content) && typeof content.text === "string") return content.text;
      }
    }
  }
  return null;
};

const parseResultJson = (text: string): unknown => {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(text.trim());
  const value = fenced?.[1] ?? text;
  try {
    return JSON.parse(value) as unknown;
  } catch (error: unknown) {
    throw new Error("APIMart web search returned invalid result JSON.", { cause: error });
  }
};

export const searchWeb = async (input: {
  apiKey: string; baseUrl: string; model: string; query: string; count?: number;
  freshness?: "day" | "week" | "month" | "year"; timeoutMs?: number; fetchImpl?: typeof fetch;
}): Promise<{ provider: "apimart"; query: string; results: WebSearchResult[] }> => {
  const query = input.query.trim();
  const model = input.model.trim();
  const count = input.count ?? 8;
  if (!query || query.length > 500 || !model || model.includes("\0") || !Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error("Web search input is invalid.");
  }
  const freshness = input.freshness ? ` Prefer sources published within the last ${input.freshness}.` : "";
  const prompt = [
    `Search the web for: ${query}.${freshness}`,
    `Return only valid JSON with this shape: {"results":[{"title":"...","url":"https://...","description":"...","published_at":null}]}.`,
    `Return at most ${count} results. Every URL must be an actual source used for the answer. Do not wrap the JSON in Markdown.`,
  ].join("\n");
  const response = await (input.fetchImpl ?? fetch)(apimartEndpoint(input.baseUrl, "/responses"), {
    method: "POST",
    headers: { Authorization: apimartAuthorization(input.apiKey), "Content-Type": "application/json" },
    body: JSON.stringify({ model, tools: [{ type: "web_search" }], input: prompt }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  });
  if (!response.ok) throw apimartJsonError("web search", response.status);
  const raw = await response.json() as unknown;
  const content = responseText(raw);
  if (!content) throw new Error("APIMart web search returned no response text.");
  const parsed = parseResultJson(content);
  if (!record(parsed) || !Array.isArray(parsed.results)) throw new Error("APIMart web search returned an invalid response.");
  const results: WebSearchResult[] = [];
  for (const item of parsed.results) {
    if (!record(item) || typeof item.title !== "string" || typeof item.url !== "string" || typeof item.description !== "string") continue;
    let resultUrl: URL;
    try { resultUrl = new URL(item.url); } catch { continue; }
    if (resultUrl.protocol !== "https:" && resultUrl.protocol !== "http:") continue;
    const publishedAt = typeof item.published_at === "string" ? item.published_at : null;
    results.push({ title: item.title.slice(0, 300), url: resultUrl.href, description: item.description.slice(0, 1_000), age: publishedAt?.slice(0, 100) ?? null });
  }
  return { provider: "apimart", query, results: results.slice(0, count) };
};
