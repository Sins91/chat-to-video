---
name: cinematic-assets
description: Use when producing a complete, provenance-aware asset manifest and music plan for the assets planning approval stage.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/asset-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Asset Manifest

Plan the assets required by the approved scene plan. This Agent stage does not acquire files, call paid providers, write objects, or enqueue jobs.

## Resolve sources honestly

Prioritize approved supplied footage where it exists and is actually suitable. Use `sourceMode: supplied` only for authorized server-side assets, `library` only for a configured library Tool, and `generate` only for an available generation path.

Query `image_selector` and `video_selector` before naming generated visual routes. Query `tts_selector` only when narration is planned. Treat unavailable selector results as blockers or reasons to revise the plan, not permission to invent a provider.

When an available APIMart generator is selected, read [APIMart generation guidance](references/apimart-generation-guidance.md) before writing its prompt.

## Cover every scene

- Give every scene at least one required visual asset; add audio entries only when the scene needs narration, dialogue, ambience, or a discrete effect.
- Keep every asset `status: planned`.
- Write prompts that preserve approved subject identity, style, palette, lighting, camera language, and continuity.
- Use actual video for motion-required beats. Generated stills and title cards must not silently replace approved motion.
- Separate source selects from generated support inserts and keep inserts limited to places where they add narrative value.

## Resolve audio and budget

Make the music object match the approved proposal: supplied, configured library, generated, or intentionally absent only where the schema and approved direction permit it. Describe energy curve, instrumentation, texture, and interaction with narration or sound design.

Use only reviewed pricing. Sum `totalEstimatedCostUsd` from the manifest entries and do not imply it is a live quote when pricing is unavailable. Score `slideshowRisk` from 0–10 based on repeated stills, decorative coverage, weak or unjustified motion, repeated layouts, and typography dependence.

Before returning, verify scene coverage, source authorization, provider availability, prompt continuity, music resolution, arithmetic, motion-promise preservation, and the absence of claimed files.
