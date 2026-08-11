---
name: cinematic-assets
description: Use when producing the asset manifest for the assets stage of the fixed cinematic-production workflow.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/asset-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Asset Manifest

Plan the assets needed by the approved `scene_plan`; do not acquire or generate them.

- Cover every scene with explicit video, image, title-card, or audio requirements.
- Keep every asset `status` equal to `planned`.
- Use `sourceMode: generate` or `library` unless approved server context identifies authorized supplied media.
- Keep prompts consistent with approved subjects, style, palette, lighting, camera language, and continuity.
- Use reviewed pricing only. Do not invent provider quotes or claim a file already exists.
- Score slideshow risk honestly; repeated stills, decorative visuals, weak motion, and typography dependence increase the score.

This stage never writes objects, downloads files, invokes paid providers, or enqueues media jobs.
