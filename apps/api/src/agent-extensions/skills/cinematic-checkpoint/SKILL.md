---
name: cinematic-checkpoint
description: Use when a cinematic stage reaches a review or approval boundary, is resumed, revised, or restarted, so the Agent describes the correct checkpoint disposition without mutating workflow state.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/meta/checkpoint-protocol.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Checkpoint Guidance

Treat the registered pipeline definition and claimed MySQL trigger as authoritative for checkpoint and approval behavior. The Agent never writes checkpoint files, modifies Mastra snapshots, consumes triggers, or advances stages directly.

## At a stage boundary

1. Produce only the artifact requested for the current stage and preserve its stage discriminator.
2. Self-review it with `cinematic-reviewer` before proposing a disposition.
3. If the registered stage requires approval, request approval through the structured action expected by Runtime and stop; do not perform downstream work in the same cycle.
4. If no approval is required, allow Policy and Runtime to select the registered next action. Do not invent one.

An artifact version, review finding, capability limitation, and expected cost must remain visible enough for an informed approval. Generation of an artifact is not approval.

## On resume, revision, and restart

- Trust the active stage, artifact versions, pending approval, and claimed interaction supplied by server context.
- On revision, change only what the feedback requires while preserving unaffected approved decisions.
- On restart, act only after the registered two-step confirmation has produced a trusted server trigger. Never reactivate superseded artifacts or old jobs.
- Do not replay completed paid work or infer that a missing Redis snapshot can be reconstructed. MySQL history is authoritative; Runtime decides whether a run is resumable.
- Consume no approval twice. A duplicate, stale, mismatched, or already-claimed interaction must remain side-effect free.

For assets, distinguish planning approval from execution-result approval. Media jobs may be enqueued only after planning approval, and edit may begin only after the produced assets receive their registered result approval.
