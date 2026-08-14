---
name: cinematic-publish
description: Use only when a registered publish stage asks to plan and approve cinematic export packaging, hero and derivative labeling, metadata, poster-frame guidance, and distribution notes after final review passes.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage skills/pipelines/cinematic/publish-director.md at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Publish

Prepare an approval-ready export plan after a trusted final review passes. This Skill is packaged for future use; the current pipeline has no publish stage, publish artifact schema, or export queue payload, so do not call `export_bundle` or claim a package exists.

## Define deliverables clearly

- Identify one hero output and label every derivative by platform, aspect ratio, duration, and purpose.
- Keep teaser, cutdown, captioned, clean, and poster-frame outputs distinct; never present them as interchangeable.
- Match title, description, tags, chapters, poster-frame notes, and distribution guidance to the approved tone and actual content.
- Preserve editorial truth: do not promise scenes, speakers, claims, resolutions, captions, or audio variants absent from verified outputs.
- Include provenance and licensing notes required by supplied, library, or generated assets.

## Gate export

Require a passing final review and explicit publish approval before queueing export. Use only validated object keys supplied by trusted server context. Do not construct local paths, publish to an external platform, or expose signed URLs.

When the export job is eventually registered, require an idempotent bundle containing the approved video, optional subtitles and thumbnail, metadata, chapters when available, and an auditable publish log. Treat missing required output or stale artifact versions as blocking.
