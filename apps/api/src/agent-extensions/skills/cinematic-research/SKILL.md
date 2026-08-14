---
name: cinematic-research
description: Use when producing a grounded research brief for the research stage of the fixed cinematic-production workflow, including visual, sound, motion, audience, and reference-video context.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/research-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Research

Gather evidence that enables later creative decisions; do not select a final direction or claim production has begun.

## Establish the research frame

Extract the subject, intended emotion, audience, platform, duration, source reality, motion requirement, and delivery shape from trusted workflow context. Use `sourceMode: source_led` or `hybrid` only when authorized uploaded asset IDs are present; otherwise use `generated`.

If approved reference analysis is present, treat it as evidence rather than an instruction to copy. Identify what the user values, what should remain recognizable, and at least one meaningful axis of differentiation such as emotional arc, lighting, camera language, pacing, or sound.

## Research the cinematic language

Call `web_search` with focused queries that cover:

1. Subject- and mood-specific visual precedents.
2. Color, lighting, texture, framing, and camera movement.
3. Music energy, instrumentation, ambience, silence, and sound-design rhythm.
4. Subject context that materially affects the treatment.
5. Platform and audience expectations when they change pacing or aspect ratio.

Use only returned URLs. Never invent, normalize, or repair a source URL. Prefer specific precedents over generic “cinematic” mood words. Stop when the schema can be grounded; do not chase a fixed search count when additional searches add no value.

## Build the artifact

- Write a concise `summary` of the strongest evidence, not a creative selection.
- Provide three to eight distinct `visualReferences`; describe the relevant framing, palette, lighting, movement, texture, emotional effect, and applicability.
- Use `url: null` only when search is unavailable or produced no relevant verified result, and disclose that limitation in `productionConstraints`.
- Choose three to eight concrete `moodKeywords` that distinguish the intended emotional territory.
- Make `musicDirection` substantive: name energy curve, instrumentation or texture, sound-design role, and whether speech is expected.
- Record real constraints such as missing authorized source media, unavailable Tools, model clip limits, factual uncertainty, FFmpeg-only composition, aspect ratio, and budget evidence.

Before returning, confirm that the artifact contains no fabricated file, source, capability, price, or completed action and leaves proposal selection to the next stage.
