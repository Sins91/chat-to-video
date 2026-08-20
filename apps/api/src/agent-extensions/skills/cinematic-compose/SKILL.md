---
name: cinematic-compose
description: Use for compose-stage planning and review of the registered FFmpeg render handoff, including hard requirements, audio dynamics, frame treatment, and verification evidence.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/compose-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Compose

Preserve the approved edit decisions when the workflow prepares or reviews the Worker render handoff. The Agent does not execute FFmpeg, build object keys, or mark a render successful.

## Check hard requirements

- Require the registered `video_compose` capability and every conditional capability implied by the approved plan.
- Keep the renderer family `ffmpeg`; never substitute another runtime or replace missing motion with stills.
- Require validated scene asset object keys and MIME types from trusted server context, not user text.
- Preserve scene order, durations, transitions, aspect ratio, grade, audio hierarchy, and the approved delivery promise. Concatenate Seedance embedded scene sound first, insert silence for static scenes, then mix the approved full-length FlowMusic background track underneath.
- Escalate missing assets, unavailable Tools, invalid media, or an incompatible render plan instead of weakening it.

## Preserve cinematic treatment

Use letterbox, crop, overlays, grain, fades, and transition treatments only when already represented by approved edit intent and supported by the renderer. Keep Seedance dialogue or narration intelligible, preserve synchronized effects, keep the separate background-music dynamics intentional, and control mixed peaks.

## Require verification evidence

Treat Worker success as necessary but not sufficient. A valid compose result needs a playable output, plausible FFprobe duration and streams, expected resolution/aspect ratio, audio presence when planned, and no missing scene. Visual QA, A/V-sync QA, and export remain unavailable until their registered jobs and review stages exist; do not fabricate those results.

Read [FFmpeg compose review guidance](references/ffmpeg-review-guidance.md) when evaluating a render handoff or result.

Return guidance or review findings only through the schema requested by the caller. Runtime state transitions and completion remain server responsibilities.
