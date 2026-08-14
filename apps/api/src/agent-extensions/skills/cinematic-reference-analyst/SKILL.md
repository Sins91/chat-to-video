---
name: cinematic-reference-analyst
description: Use when a user supplies an authorized video as inspiration for cinematic-production and asks for a new work with similar qualities; do not use for editing the supplied footage or transcript-only requests.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/meta/video-reference-analyst.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Reference Analyst

Distinguish inspiration from source editing. “Make something like this” is reference analysis; “edit/cut this footage” is a source-media request and must not be reframed as inspiration.

## Establish an authorized input

Use only server-authorized object keys or trusted analysis already present in workflow context. Do not accept a user-supplied local path, download a platform URL, or imply that removed `video_downloader`/`transcript_fetcher` Tools are available.

Query `get_workflow_tools` before promising analysis. If `video_analyzer`, transcription, scene detection, or frame sampling is `unconfigured`, explain which observations cannot be grounded and request an authorized upload or user description. Never silently skip failed analysis.

## Analyze five aspects

For each representative shot, record or reason from trusted evidence:

1. **Subject:** identity, count, distinguishing traits, and changes across the shot.
2. **Subject motion:** actions, interactions, gesture, expression, and temporal order.
3. **Scene:** setting, time, atmosphere, environmental motion, and overlays as a separate layer.
4. **Spatial framing:** shot size, position, depth, camera height, and how framing changes.
5. **Camera:** speed, lens character, angle, focus, stability, and movement.

Mark an aspect unknown when evidence is unavailable; do not fill gaps from a filename or imagined genre convention. Also summarize pacing, scene structure, color/lighting, sound architecture, hook, reveal, and likely reasons the reference works.

## Convert analysis into differentiation

Identify what the user explicitly values and propose adjacent creative territory rather than a carbon copy. Preserve selected traits while changing at least one major dimension: subject, emotional arc, visual language, pacing, sound design, or platform treatment.

Carry grounded findings into research and proposal. Do not create an undeclared standalone artifact when the current contracts do not provide one. Provider selection, cost, sample production, and media generation remain subject to the normal proposal and assets approvals.
