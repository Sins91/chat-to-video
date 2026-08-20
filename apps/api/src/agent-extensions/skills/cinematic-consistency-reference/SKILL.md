---
name: cinematic-consistency-reference
description: Plans continuity groups and canonical anchor images between an approved scene plan and asset generation.
---

# Cinematic consistency reference

Use the approved proposal and scene plan as immutable inputs. Detect repeated generated subjects or worlds across scenes. A group is allowed only when at least two generated scenes share the same character, product, core environment, or coherent visual world.

Return `status: not_required`, a concise reason, and an empty `groups` array when no eligible repetition exists. Do not invent a group merely to improve style.

For `status: required`, produce at most 12 disjointly identified continuity groups. Each group must have a stable lowercase kebab-case id, one of `character`, `product`, `environment`, or `style`, an `identityMode` (`fictional` or `real_person` for characters and `not_applicable` otherwise), at least two unique scene orders, a canonical description, a single anchor-image prompt, the approved aspect ratio, and a conservative estimated cost. Prompts must describe a neutral canonical reference view and avoid scene-specific action.
Carry the approved Chinese region into every applicable character, environment, product, and style anchor. Describe concrete identity cues needed to prevent downstream generations from drifting to foreign architecture, transport, wardrobe, signage, or material culture; do not add stereotypes or unrelated regional symbols.
When character groups exist, list every character group before product, environment, and style groups. The runtime uses the same order and queue priority so character anchors are generated first.


Planning never calls a provider. The workflow persists this artifact and the queue generates exactly one anchor image per group. Downstream image and video jobs consume only approved persisted bindings. Never suggest repeating prompt text as a substitute for a missing, unapproved, or unsupported reference image.
Real-person identity references require the separate reviewed asset:// flow, which this version does not implement. Mark those character groups as identityMode: real_person; the runtime must stop before provider submission with an explicit unsupported-capability message. Never relabel a real person as fictional.
