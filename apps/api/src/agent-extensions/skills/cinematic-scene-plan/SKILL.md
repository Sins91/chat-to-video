---
name: cinematic-scene-plan
description: Use when producing the scene_plan artifact for the scene_plan stage of the fixed cinematic-production workflow.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/scene-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Scene Plan

Convert the approved script into executable, ordered scenes.

- Query video-model constraints and keep every scene within the selected model's single-generation limit.
- Split longer beats into sequential scenes while preserving narrative, subject, lighting, wardrobe, spatial, and motion continuity.
- Make scene durations total exactly the requested final duration and keep orders contiguous from 1.
- Use only `generated_video`, `generated_image`, or `title_card`; no supplied media is authorized in the current demo.
- A motion-required scene must use generated video. Do not hide a still-image downgrade behind camera wording.
- Specify a concrete visual prompt, camera direction, transition, audio direction, and narrative purpose for every scene.

Self-check duration arithmetic, model limits, source types, visual variety, and continuity.
