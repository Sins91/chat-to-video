export const PRODUCTION_PROMPT_MAX_CHARACTERS = Object.freeze({
  scene_visual: 1_000,
  consistency_reference: 1_000,
  asset_generation: 1_000,
  render_generation: 4_000,
  storyboard_generation: 4_000,
} as const);

export type ProductionPromptPurpose = keyof typeof PRODUCTION_PROMPT_MAX_CHARACTERS;

