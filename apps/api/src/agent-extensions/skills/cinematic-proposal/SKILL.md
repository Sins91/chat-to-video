---
name: cinematic-proposal
description: Use when turning approved cinematic research into three distinct, feasible proposal directions for the proposal approval stage.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/proposal-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Proposal

Convert approved research into exactly three emotionally distinct, reviewable directions. This is a planning gate: do not generate assets, spend money, or enqueue work.

## Audit feasibility first

Use `get_workflow_tools`, provider selectors, model constraints, and reviewed pricing when the proposal depends on them. Treat `unconfigured` as unavailable for the promise. The only registered renderer family is `ffmpeg`; do not offer Remotion, HyperFrames, or an unregistered fallback.

Resolve the music plan at proposal time as one full-length FlowMusic background track. Separately define Seedance scene sound for dialogue, narration, ambience, and synchronized effects, and explicitly exclude background score from Seedance output. Do not defer a known music blocker to assets.

## Design three differentiated directions

Set all three directions in credible Chinese regional contexts. Replace generic foreign institutions, streets, homes, transport, currency, holidays, and everyday behavior with Chinese counterparts; make the directions distinct through filmmaking choices rather than superficial cultural decoration.

Give every direction:

- A specific title and emotional logline.
- An `emotionalArc` with at least three ordered beats and a clear landing.
- A concrete visual treatment covering the global stability intent, framing and camera language, lighting direction, texture, specific style reference, typography restraint, and editing rhythm.
- A palette of three to eight usable color or material descriptors.
- A `musicDirection` for the single full-length background track and a separate `soundDirection` for Seedance scene sound; the latter must say no background music/no score.

Treat these as approved upstream facts for later prompt assembly, not as a finished provider prompt. Describe observable filmmaking choices instead of vague labels such as “premium”, “cinematic”, or “atmospheric”. Do not prescribe unsupported resolution, frame rate, aspect ratio, or other provider parameters here.

Make the directions differ in more than adjectives. Vary the primary emotional arc, shot language, pacing, or sound strategy. Include an intimate or texture-led alternative when spectacle would make all three converge.

For reference-driven work, preserve explicitly valued traits while changing at least one major creative dimension. Never propose a carbon copy.

## Lock an honest promise

- Recommend exactly one existing direction ID and explain the fit through declared fields only.
- Preserve the requested `durationSeconds` and set `rendererFamily: ffmpeg`.
- Make `deliveryPromise` explicit about motion coverage, source dependence, quality floor, audio treatment, and any approved fallback.
- Never describe a still-led treatment as motion-led. If required motion cannot be delivered, state the constraint rather than silently weakening the promise.
- Use reviewed pricing when available. If pricing is unavailable, do not present `estimatedCostUsd` as a provider quote; keep it schema-valid and conservative.

Before returning, verify three-way creative diversity, capability feasibility, music resolution, duration, recommendation validity, and the absence of undeclared schema fields.
