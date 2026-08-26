# APIMart Cinematic Generation Guidance

Read this reference only when an assets plan uses a currently available APIMart image, video, or music capability. Registered model constraints and Worker configuration override this document.

## Video

The current Worker uses `doubao-seedance-2.0` for new video generation. `MiniMax-Hailuo-2.3` is retained only to read historical workflows and old queue payloads. Query model constraints before writing a scene plan; never infer duration, resolution, aspect ratio, or audio behavior from the model name.

The proposal, script, scene plan, and approved consistency references own the creative facts. The assets stage only assembles those facts into one positive prompt per continuous shot, in this exact order:

1. **Core stability constraints:** select only relevant requirements such as coherent smooth motion without flicker, no continuity break, stable subject identity, stable product form, stable animation design, or accurate lip synchronization. Do not stack every requirement onto every scene.
2. **Shot and camera movement:** state one shot size or angle and one compatible camera movement, including framing, depth, camera height, or lens character only when they materially control the shot.
3. **Subject identity and continuous action:** preserve approved distinguishing traits and describe one observable action chain in temporal order, including expression, gaze, gesture, speech, or product interaction when relevant.
4. **Setting, time, and light:** name the concrete location, time, atmosphere, environmental motion, light type, direction, and softness needed by the approved scene.
5. **Verified quality requirements:** include only quality language supported by registered model constraints and structured runtime parameters. Never invent 8K/4K, 24/30 fps, aspect ratio, resolution, format, or provider features from a template.
6. **Approved style:** use the proposal's specific visual treatment and continuity palette; replace vague terms such as “premium” or “cinematic” with observable film, animation, commercial, documentary, or material treatment.
7. **Detail modifiers:** add three to five useful details at most, such as hair light, restrained grain, clean line work, soft palette, material texture, depth of field, or controlled reflections. Omit details that repeat earlier clauses.
8. **Seedance scene sound:** preserve the exact approved dialogue or narration, ambience, and synchronized effects, and explicitly request `no background music / no score`; the full-length FlowMusic track is separate.
9. **Continuous-shot requirement:** state that the output is one continuous shot suitable for trimming to the approved final scene duration.

Keep the assembled visual prompt compact because the Worker appends validated shared and per-scene audio instructions before provider submission. Use concrete observable motion. Avoid contradictory camera directions, unexplained scene changes, multiple unrelated actions, filler adjectives, provider marketing phrases, or continuity details that differ from adjacent scenes. Split a complex beat at the scene-plan stage instead of compressing several shots into one generation.

Apply only the conditional treatment justified by the approved scene:

- **Talking head or sales speech:** require accurate lip-to-line synchronization, a fixed frontal close or medium-close shot with at most a subtle slow push, natural expression, and natural hand gestures.
- **Narrative:** preserve character identity and adjacent-scene continuity; vary establishing, medium, close, or detail framing across separate scenes, never as several shots inside one generation.
- **Product:** keep product geometry, materials, logo placement, fine detail, and reflections stable while making the interaction physically executable.
- **Animation:** keep character design, line treatment, palette, and rendering style stable; describe motion as a coherent animated action rather than live-action realism.
- **Travel or landscape:** use stable aerial, tracking, lateral, or slow-push movement; control exposure, keep the subject legible, and describe environmental motion explicitly.

## Image

The current image adapter uses `doubao-seedream-5-0-pro`, a validated cinematic aspect ratio, one 2K PNG output, and no watermark. Describe the stable subject or product identity, environment, composition, depth, lighting direction, specific style, palette, material or line texture, three to five useful details, atmosphere, and intended scene role. Keep identity and continuity anchors identical across related prompts. Consistency-reference prompts must remain neutral and static: do not add camera movement, temporal action chains, dialogue, scene sound, frame rate, or unsupported quality claims.

Do not embed text in generated imagery when a title card can render it deterministically. Do not request an unsupported size, output count, file format, or editing mode.

## Music

The current music adapter uses `flowmusic` and enforces instrumental, no-vocals output. Describe the emotional arc, energy curve, instrumentation, texture, tempo feel, density, and key transition moments. Avoid copyrighted-artist imitation, lyrics, vocals, or timing claims the configured duration cannot support.

## Safety and honesty

Selectors choose among registered candidates; they do not execute generation. Prompts enter paid execution only through approved BullMQ jobs. Never include credentials, local paths, signed URLs, object keys, personal data, or instructions to imitate a living artist. Do not claim a seed, provider feature, price, or generated result unless trusted runtime data supplies it.
