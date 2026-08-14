---
name: cinematic-final-review
description: Use only when a registered final-review stage or trusted post-render review operation asks for evidence-based technical, visual, audio, subtitle, synchronization, and delivery-promise assessment of a cinematic output.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/meta/reviewer.md and schemas/artifacts/final_review.schema.json at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Final Review

Review the actual rendered output, not the plan or a claimed Worker status. This Skill is packaged for future use; the current pipeline has no final-review stage or artifact schema, so do not claim it ran until those server boundaries are registered.

## Require trusted evidence

- Technical probe: container, codec, duration, resolution, frame rate, file size, video stream, and expected audio stream.
- Visual spot-check: representative opening, middle, climax, and ending frames; inspect black frames, missing assets, broken overlays, unsafe crops, unreadable text, continuity, and grade consistency.
- Audio spot-check: expected narration/dialogue, music, ambience, silence, intelligibility, clipping, and balance.
- Subtitle check: expected presence, timing, legibility, coverage, and non-duplication with on-screen text.
- Promise check: actual motion coverage, approved source treatment, renderer family, emotional arc, and absence of a silent downgrade.
- A/V synchronization check when the registered Tool and evidence are available.

Never infer a passing result from `job.completed` alone. Missing evidence is an incomplete review, not a pass. Treat invalid media, missing scenes, unexpected silence, material sync drift, unreadable required text, or an unapproved motion downgrade as blocking.

Recommend the narrowest safe next action: re-render, revise edit, revise assets, or block for user/provider resolution. Only a fully evidenced passing result may proceed to publish approval.
