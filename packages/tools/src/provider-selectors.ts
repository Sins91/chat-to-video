export type ProviderCandidate = {
  id: string;
  provider: string;
  status: "available" | "unconfigured" | "disabled";
  operations: readonly string[];
  qualityScore: number;
  costScore: number;
  latencyScore: number;
};
export type ProviderSelection = { selected: ProviderCandidate; alternatives: ProviderCandidate[]; score: number };

const select = (input: {
  candidates: readonly ProviderCandidate[]; operation: string; preferredProvider?: string;
  allowedProviders?: readonly string[]; preferredProviderGap?: number;
}): ProviderSelection => {
  if (input.candidates.length > 100 || input.candidates.some((candidate) =>
    !candidate.id.trim() || !candidate.provider.trim() || candidate.operations.length > 100 ||
    [candidate.qualityScore, candidate.costScore, candidate.latencyScore].some((score) => !Number.isFinite(score) || score < 0 || score > 1)
  )) throw new Error("Provider candidates are invalid.");
  const allowed = input.allowedProviders?.length ? new Set(input.allowedProviders) : null;
  const ranked = input.candidates
    .filter((candidate) => candidate.status === "available" && candidate.operations.includes(input.operation) && (!allowed || allowed.has(candidate.provider)))
    .map((candidate) => ({ candidate, score: candidate.qualityScore * 0.5 + candidate.costScore * 0.25 + candidate.latencyScore * 0.25 }))
    .sort((left, right) => right.score - left.score || left.candidate.id.localeCompare(right.candidate.id));
  const top = ranked.at(0);
  if (!top) throw new Error(`No available provider supports ${input.operation}.`);
  const preferred = input.preferredProvider && input.preferredProvider !== "auto" ? ranked.find((item) => item.candidate.provider === input.preferredProvider) : undefined;
  const selected = preferred && top.score - preferred.score <= (input.preferredProviderGap ?? 0.15) ? preferred : top;
  return { selected: selected.candidate, score: Number(selected.score.toFixed(4)), alternatives: ranked.filter((item) => item.candidate.id !== selected.candidate.id).map((item) => item.candidate) };
};

type SelectorInput = Omit<Parameters<typeof select>[0], "operation">;
export const selectTtsProvider = (input: SelectorInput): ProviderSelection => select({ ...input, operation: "text_to_speech" });
export const selectImageProvider = (input: SelectorInput & { operation?: "generate_image" | "edit_image" | "search_image" }): ProviderSelection => select({ ...input, operation: input.operation ?? "generate_image" });
export const selectVideoProvider = (input: SelectorInput & { operation?: "text_to_video" | "image_to_video" | "reference_to_video" | "search_video" }): ProviderSelection => select({ ...input, operation: input.operation ?? "text_to_video" });
