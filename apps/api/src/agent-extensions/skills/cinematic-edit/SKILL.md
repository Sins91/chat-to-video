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

Keep `sceneOrder` contiguous, `startSeconds` monotonic, and timeline durations equal exactly `durationSeconds`. Keep audio gain within schema bounds. Use `audioMix` to state hierarchy among dialogue or narration, music, ambience, and effects, including ducking and peak-control intent.

Describe one coherent `colorGrade` tied to the approved palette and lighting rather than a generic “cinematic” preset. Make `renderPrompt` summarize the approved scene, pacing, grade, audio, aspect-ratio, and motion commitments without adding creative scope.

Include quality checks for timeline arithmetic, source coverage, continuity, motion-promise preservation, subtitle intent, audio intelligibility, peak control, output duration, and playability.

Before returning, recompute slideshow risk qualitatively: flag repeated layouts, weak shot intent, typography dependence, or a motion-led promise with insufficient real motion.
