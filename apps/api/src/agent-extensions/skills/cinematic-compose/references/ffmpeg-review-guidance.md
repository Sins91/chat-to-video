# FFmpeg Compose Review Guidance

Read this reference when reviewing the registered FFmpeg compose handoff or its output evidence.

## Pre-compose

- Confirm every scene has a validated asset object key and matching MIME type.
- Confirm generation duration covers final scene duration and every scene fits its model limit.
- Confirm scene durations total the approved runtime and order is contiguous.
- Confirm the music object, gain, aspect ratio, transitions, and audio requirements match approved edit decisions.
- Block on missing assets or unsupported media instead of substituting content.

## Post-compose

- Probe the actual output for a plausible container, video stream, codec, duration, resolution, and expected audio stream.
- Sample representative frames at opening, middle, climax, and ending rather than inspecting only the first frame.
- Check black or frozen frames, missing assets, bad crops, broken transitions, unreadable text, and inconsistent grade.
- Check dialogue or narration intelligibility, music balance, unintended silence, clipping, and obvious A/V drift.
- Compare actual motion coverage and source treatment with the approved delivery promise.

Do not convert missing `visual_qa`, `av_sync_qa`, subtitle, or export evidence into a passing statement. Those Tools remain `unconfigured` until their jobs and stages are registered.
