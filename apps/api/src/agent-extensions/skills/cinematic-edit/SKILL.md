---
name: cinematic-edit
description: Use when producing edit decisions for the edit stage of the fixed cinematic-production workflow.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/edit-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Edit Decisions

Translate approved scenes and assets into deterministic FFmpeg-oriented edit decisions.

- Preserve scene order and make timeline durations total exactly the requested final duration.
- Use supported transitions only and keep audio gain within the schema range.
- Lock `rendererFamily` to `ffmpeg`.
- Describe one coherent color grade and audio mix aligned with the approved direction.
- Build a final provider prompt consistent with the approved scenes; do not introduce new assets or providers.
- Include quality checks for duration, continuity, motion promise, audio, and output playability.

Return decisions only. FFmpeg execution and `render-jobs` handoff remain workflow/Worker responsibilities.
