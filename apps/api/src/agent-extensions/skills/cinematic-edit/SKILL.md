---
name: cinematic-edit
description: Use when translating approved scenes and assets into deterministic FFmpeg-oriented edit decisions for the edit stage.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/edit-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Edit Decisions

Create editorial decisions; do not execute FFmpeg or enqueue the render job.

## Cut for the emotional arc

- Preserve scene order while shaping pace through shot duration, sound transitions, and contrast.
- Protect hero moments, reveals, reaction space, and intentional silence. Do not overcut strong footage or cover it with unnecessary text.
- Use only supported transitions and justify anything other than a cut through emotional, visual, or spatial continuity.
- Keep `rendererFamily: ffmpeg`; never switch renderer or introduce unapproved assets or providers.

## Make the timeline deterministic

Keep `sceneOrder` contiguous, `startSeconds` monotonic, and timeline durations equal exactly `durationSeconds`. Keep audio gain within schema bounds. Use `audioMix` to require this deterministic order: concatenate Seedance embedded dialogue, narration, ambience, and synchronized effects; insert silence for static scenes; then mix the one full-length FlowMusic background track underneath with peak control.

Describe one coherent `colorGrade` tied to the approved palette and lighting rather than a generic “cinematic” preset. Make `renderPrompt` summarize the approved scene, pacing, grade, audio, aspect-ratio, and motion commitments without adding creative scope. Do not regenerate, reorder, or embellish the Seedance generation prompts; those are approved asset-stage inputs, not edit-stage creative material.

Create a deterministic `subtitles` track from the approved script and scene plan. When dialogue or narration is present, set `enabled: true` and include every exact spoken line as ordered, non-overlapping segments within the final duration. Do not caption ambience, sound effects, music directions, or text already presented only as a title card. When no dialogue or narration exists, set `enabled: false` with an empty segment array. Use the schema defaults for subtitle styling unless an approved requirement calls for another readable size or bottom margin.

Preserve the approved Chinese setting in `renderPrompt` and quality checks. Treat foreign-location drift, mixed regional cues, and inappropriate non-Chinese visible text as continuity failures unless the approved subject requires them as factual exceptions.

Include quality checks for timeline arithmetic, source coverage, continuity, motion-promise preservation, exact subtitle wording, timing, legibility and non-duplication, audio intelligibility, peak control, output duration, and playability.

Before returning, recompute slideshow risk qualitatively: flag repeated layouts, weak shot intent, typography dependence, or a motion-led promise with insufficient real motion.
