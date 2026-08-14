# APIMart Cinematic Generation Guidance

Read this reference only when an assets plan uses a currently available APIMart image, video, or music capability. Registered model constraints and Worker configuration override this document.

## Video

The current Worker supports `MiniMax-Hailuo-2.3` and the retained `doubao-seedance-2.0` profile. Query model constraints before writing a scene plan; never infer duration, resolution, aspect ratio, or audio behavior from the model name.

Build one prompt per continuous shot in this order:

1. Subject identity and stable distinguishing traits.
2. Subject action in temporal order.
3. Setting, time, atmosphere, and environmental motion.
4. Framing, depth, camera height, lens character, and camera movement.
5. Lighting, palette, texture, and continuity anchors.
6. Narrative beat and audio intent when the selected profile supports it.
7. State that the result must be one continuous shot suitable for trimming to the requested final scene duration.

Use concrete observable motion. Avoid contradictory camera instructions, unexplained scene changes, multiple unrelated actions, provider marketing phrases, or continuity details that differ from adjacent scenes. Split a complex beat instead of compressing several shots into one generation.

## Image

The current image adapter uses `doubao-seedream-5-0-pro`, a validated cinematic aspect ratio, one 2K PNG output, and no watermark. Describe the subject, composition, depth, lighting direction, palette, material texture, atmosphere, and intended scene role. Keep identity and continuity anchors identical across related prompts.

Do not embed text in generated imagery when a title card can render it deterministically. Do not request an unsupported size, output count, file format, or editing mode.

## Music

The current music adapter uses `flowmusic` and enforces instrumental, no-vocals output. Describe the emotional arc, energy curve, instrumentation, texture, tempo feel, density, and key transition moments. Avoid copyrighted-artist imitation, lyrics, vocals, or timing claims the configured duration cannot support.

## Safety and honesty

Selectors choose among registered candidates; they do not execute generation. Prompts enter paid execution only through approved BullMQ jobs. Never include credentials, local paths, signed URLs, object keys, personal data, or instructions to imitate a living artist. Do not claim a seed, provider feature, price, or generated result unless trusted runtime data supplies it.
