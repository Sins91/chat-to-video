---
name: cinematic-reviewer
description: Use alongside every cinematic stage skill to self-review the artifact before returning structured output.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/meta/reviewer.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Self-Review

Review the artifact inside the same Agent generation. Do not create another Agent call or emit a separate review artifact.

Check every stage for:

1. Exact stage discriminator, required properties, size limits, enum literals, and absence of undeclared fields.
2. Alignment with approved upstream decisions and the requested duration.
3. Honest capability, asset, cost, and provider claims.
4. No bypass of approval, `ModelGateway`, BullMQ, Worker, storage authorization, or FFmpeg safety boundaries.

Stage focus:

- research: concrete visual/audio direction and no fabricated sources.
- proposal: three distinct directions, valid recommendation, FFmpeg lock, achievable promise.
- script: coherent arc, contiguous beats, exact duration total.
- `scene_plan`: exact duration total, model-safe scenes, continuity, visual variety, honest motion sources.
- assets: complete scene coverage, planned status, consistent prompts, honest cost and slideshow risk.
- edit: complete timeline, exact duration, supported transitions, audio/grade consistency, quality checks.

Fix critical findings before returning. Server-side Zod and deterministic invariants remain authoritative.
