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

Query `image_selector` and `video_selector` before naming generated visual routes. Dialogue and narration are part of Seedance scene sound; do not select or plan a separate TTS route. Treat unavailable selector results as blockers or reasons to revise the plan, not permission to invent a provider.

When an available APIMart generator is selected, read [APIMart generation guidance](references/apimart-generation-guidance.md) before writing its prompt.

## Cover every scene

- Give every scene exactly one required visual asset. Never add per-scene audio entries.
- Keep every asset `status: planned`.
- Write prompts that preserve approved subject identity, style, palette, lighting, camera language, and continuity.
- Preserve the approved Chinese region in every prompt through concrete visible details such as people, built environment, transport, signage, wardrobe, props, and customs. Do not let generic provider defaults introduce foreign or mixed-regional cues.
- Use actual video for motion-required beats. Generated stills and title cards must not silently replace approved motion.
- Separate source selects from generated support inserts and keep inserts limited to places where they add narrative value.

## Resolve audio and budget

Make the music object describe the one full-length FlowMusic background track and match the approved proposal. Describe its energy curve, instrumentation, texture, and interaction with scene sound.

Set `seedanceAudioDirection` from the approved sound direction. For every generated-video asset, merge that direction with the approved scene `audio` in its prompt and explicitly require dialogue/narration, ambience, and synchronized effects only: `no background music / no score`. Static assets remain silent at scene level and receive the full-length music only in final composition.

Use only reviewed pricing. Sum `totalEstimatedCostUsd` from the manifest entries and do not imply it is a live quote when pricing is unavailable. Score `slideshowRisk` from 0–10 based on repeated stills, decorative coverage, weak or unjustified motion, repeated layouts, and typography dependence.

Before returning, verify scene coverage, source authorization, provider availability, prompt continuity, music resolution, arithmetic, motion-promise preservation, and the absence of claimed files.

## Consume approved consistency anchors

Read the persisted `consistency_reference` artifact before planning generated visual assets. When it is `required`, preserve every applicable continuity group in the scene prompt and expect the runtime to attach the approved persisted `referenceBindings`; prompt repetition is not a substitute for a binding.

Do not plan or approve downstream generation when a required anchor object is missing, superseded, failed, or not approved. Treat those states, and an unavailable `image.generate.reference` or `video.generate.reference` capability, as permanent execution blockers. Never silently retry without references. Bind at most three groups per task in character, product, environment, then style priority.
