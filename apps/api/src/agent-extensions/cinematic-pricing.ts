import {
  CinematicArtifactSchema,
  getVideoModelMaxDurationSeconds,
  roundVideoModelDurationSeconds,
  VideoModelSchema,
  type CinematicArtifact,
  type VideoModel,
} from "@chat-to-video/contracts";
import { z } from "zod";

const APIMART_PRICING_SOURCE = "https://api.apimart.ai/api/pricing/model";
const APIMART_PRICING_VERSION = "2026-08-14";

type CinematicPrice = {
  readonly usdPerGeneratedSecond: number;
  readonly source: string;
  readonly version: string;
};

export type CinematicPricingCatalog = Partial<
  Readonly<Record<VideoModel, CinematicPrice>>
>;

type CinematicMediaPricing = {
  readonly usdPerGeneratedImage: number;
  readonly usdPerMusicGeneration: number;
};

const REVIEWED_PRICING: CinematicPricingCatalog = Object.freeze({
  "MiniMax-Hailuo-2.3": {
    usdPerGeneratedSecond: 0.061,
    source: APIMART_PRICING_SOURCE,
    version: APIMART_PRICING_VERSION,
  },
  "doubao-seedance-2.0": {
    usdPerGeneratedSecond: 0.1775,
    source: APIMART_PRICING_SOURCE,
    version: APIMART_PRICING_VERSION,
  },
});

const REVIEWED_MEDIA_PRICING: CinematicMediaPricing = Object.freeze({
  usdPerGeneratedImage: 0.0732,
  usdPerMusicGeneration: 0.075,
});

export const EstimateCinematicCostInputSchema = z.object({
  model: VideoModelSchema,
  durationsSeconds: z.array(z.number().int().positive()).min(1).max(60),
  generatedImageCount: z.number().int().min(0).max(120).default(0),
  generatedMusicCount: z.number().int().min(0).max(10).default(0),
}).strict().superRefine((input, context) => {
  const maximum = getVideoModelMaxDurationSeconds(input.model);
  input.durationsSeconds.forEach((duration, index) => {
    if (duration > maximum) {
      context.addIssue({
        code: "custom",
        message: `Scene duration exceeds the ${maximum} second model limit.`,
        path: ["durationsSeconds", index],
      });
    }
  });
});

export const EstimateCinematicCostOutputSchema = z.object({
  status: z.enum(["estimated", "unavailable"]),
  amountUsd: z.number().min(0).max(1_000_000).nullable(),
  pricingSource: z.string().trim().min(1).max(500).nullable(),
  pricingVersion: z.string().trim().min(1).max(100).nullable(),
  reason: z.literal("pricing_not_configured").nullable(),
}).strict();

const roundUsd = (amount: number): number => Number(amount.toFixed(6));

export const estimateCinematicCost = (
  input: z.input<typeof EstimateCinematicCostInputSchema>,
  pricing: CinematicPricingCatalog = REVIEWED_PRICING,
  mediaPricing: CinematicMediaPricing = REVIEWED_MEDIA_PRICING,
) => {
  const parsed = EstimateCinematicCostInputSchema.parse(input);
  const price = pricing[parsed.model];
  if (!price) {
    return EstimateCinematicCostOutputSchema.parse({
      status: "unavailable",
      amountUsd: null,
      pricingSource: null,
      pricingVersion: null,
      reason: "pricing_not_configured",
    });
  }
  const generatedSeconds = parsed.durationsSeconds.reduce(
    (total, duration) =>
      total + roundVideoModelDurationSeconds(parsed.model, duration),
    0,
  );
  return EstimateCinematicCostOutputSchema.parse({
    status: "estimated",
    amountUsd: roundUsd(
      generatedSeconds * price.usdPerGeneratedSecond +
      parsed.generatedImageCount * mediaPricing.usdPerGeneratedImage +
      parsed.generatedMusicCount * mediaPricing.usdPerMusicGeneration,
    ),
    pricingSource: price.source,
    pricingVersion: price.version,
    reason: null,
  });
};

const splitDurationForModel = (
  model: VideoModel,
  durationSeconds: number,
): number[] => {
  const maximum = getVideoModelMaxDurationSeconds(model);
  const durations: number[] = [];
  let remaining = durationSeconds;
  while (remaining > 0) {
    const duration = Math.min(remaining, maximum);
    durations.push(duration);
    remaining -= duration;
  }
  return durations;
};

const requiredAmount = (
  input: z.input<typeof EstimateCinematicCostInputSchema>,
): number => {
  const estimate = estimateCinematicCost(input);
  if (estimate.status !== "estimated" || estimate.amountUsd === null) {
    throw new Error(`Reviewed APIMart pricing is missing for ${input.model}.`);
  }
  return estimate.amountUsd;
};

export const applyReviewedCinematicPricing = (
  artifact: CinematicArtifact,
  input: {
    readonly videoModel: VideoModel;
    readonly approvedArtifacts: readonly CinematicArtifact[];
  },
): CinematicArtifact => {
  if (artifact.stage === "proposal") {
    return CinematicArtifactSchema.parse({
      ...artifact,
      data: {
        ...artifact.data,
        estimatedCostUsd: requiredAmount({
          model: input.videoModel,
          durationsSeconds: splitDurationForModel(
            input.videoModel,
            artifact.data.durationSeconds,
          ),
          generatedMusicCount: 1,
        }),
      },
    });
  }
  if (artifact.stage !== "assets") return artifact;

  const scenePlan = input.approvedArtifacts.find(
    (approved): approved is Extract<CinematicArtifact, { stage: "scene_plan" }> =>
      approved.stage === "scene_plan",
  );
  if (!scenePlan) {
    throw new Error("Reviewed pricing for an asset manifest requires an approved scene plan.");
  }
  const scenesByOrder = new Map(
    scenePlan.data.scenes.map((scene) => [scene.order, scene] as const),
  );
  const assets = artifact.data.assets.map((asset) => {
    if (asset.sourceMode !== "generate" || asset.kind === "title_card") {
      return { ...asset, estimatedCostUsd: 0 };
    }
    if (asset.kind === "image") {
      return { ...asset, estimatedCostUsd: REVIEWED_MEDIA_PRICING.usdPerGeneratedImage };
    }
    if (asset.kind === "audio") {
      return { ...asset, estimatedCostUsd: REVIEWED_MEDIA_PRICING.usdPerMusicGeneration };
    }
    const scene = scenesByOrder.get(asset.sceneOrder);
    if (!scene) {
      throw new Error(`Asset scene ${asset.sceneOrder} is missing from the approved scene plan.`);
    }
    return {
      ...asset,
      estimatedCostUsd: requiredAmount({
        model: input.videoModel,
        durationsSeconds: [scene.generationDurationSeconds ?? scene.durationSeconds],
      }),
    };
  });
  const musicCost = artifact.data.music.sourceMode === "generate"
    ? REVIEWED_MEDIA_PRICING.usdPerMusicGeneration
    : 0;
  return CinematicArtifactSchema.parse({
    ...artifact,
    data: {
      ...artifact.data,
      assets,
      totalEstimatedCostUsd: roundUsd(
        assets.reduce((total, asset) => total + asset.estimatedCostUsd, musicCost),
      ),
    },
  });
};
