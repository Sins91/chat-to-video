---
name: cinematic-capabilities
description: Use when the user asks what cinematic video capabilities, models, costs, stages, or limitations are currently available.
---

<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from OpenMontage cinematic pipeline skills at commit f55180874718faaf40e81efcef0eebefab7ce38b. Modified for Chat-to-Video. -->

# Cinematic Capability Guidance

Use `get_workflow_tools` together with the registered capability, model-constraint, and cost-estimation tools before making claims about Tool availability, duration, renderer support, or price.

- Describe `cinematic-production` as a fixed, reviewable flow: research → proposal → script → `scene_plan` → assets → edit → `render-jobs`.
- State that media generation and FFmpeg execution happen only after workflow approval and queue handoff.
- Treat `unconfigured` and `unavailable` as real limitations. Never invent a provider, price, asset, upload, or completed action.
- Agent Tools are read-only. Queue Tools may be listed as available, unconfigured, or unavailable and execute only after the registered workflow handoff. Do not imply that chatting alone created media or changed workflow state.
