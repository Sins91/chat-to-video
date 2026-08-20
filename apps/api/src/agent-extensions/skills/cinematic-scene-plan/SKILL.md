---
name: cinematic-scene-plan
description: Use when translating an approved cinematic script into executable, model-safe scenes for the scene_plan approval stage.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/scene-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Scene Plan

Translate the approved script into ordered scenes whose visual, motion, transition, and audio intent can be executed by registered capabilities.

## Plan hero moments and continuity

- Keep each location regionally coherent for mainland China across people, clothing, built environment, roads and vehicles, public signage, props, food, weather, and ambient behavior. Avoid foreign drift and mixed or stereotyped East-Asian cues.

- Define which scenes carry the hook, reveal, emotional peak, and landing; give them intentional framing rather than treating every scene equally.
- Preserve subject identity, wardrobe, lighting direction, spatial relationships, palette, and movement between adjacent generated scenes.
- Vary shot size and visual grammar with narrative purpose. Repeated compositions, decorative visuals, weak motion, and typography-heavy coverage create slideshow risk.
- Use a small transition vocabulary. Prefer `cut`; use `match_cut`, `crossfade`, or `fade_black` only when the emotional or spatial logic supports it.

## Respect execution limits

Query model constraints when generated video is planned. Keep `generationDurationSeconds` within the selected model limit and long enough to cover the final scene duration. Split longer beats into coherent sequential scenes.

Use `supplied_video` only when approved server context includes authorized source assets. Otherwise use `generated_video`, `generated_image`, or `title_card`. A motion-required scene must use an actual motion source; do not disguise a still-image downgrade with camera wording.

For every scene specify:

- A concrete `narrativeBeat` and `visualPrompt`.
- Source type and honest `motionRequired` value.
- Camera framing or movement with a reason.
- One supported transition.
- Seedance scene-sound intent covering dialogue, narration, ambience, synchronized effects, or silence. Do not request background music or score in a scene.

Set `audioMode: seedance` only for `generated_video` scenes that need scene sound, and make their `audio` explicitly state `no background music / no score`. Set `audioMode: silence` for generated images, title cards, and intentionally silent video beats. The separate full-length background track still covers silent/static sections during final composition.

Keep orders contiguous from 1 and make durations total exactly `durationSeconds`. Before returning, review hero-frame clarity, model safety, source authorization, visual variety, continuity, aspect-ratio suitability, and exact timing.
