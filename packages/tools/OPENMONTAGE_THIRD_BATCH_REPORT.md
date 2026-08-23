# OpenMontage cinematic 第三批 Tool 移植报告

日期：2026-08-14

## 结论

第三批当前保留 9 个 TypeScript Tool，统一放入共享包 `@chat-to-video/tools`：

- `video_analyzer`
- `web_search`
- `transcriber`
- `tts_selector`
- `image_selector`
- `video_selector`
- `pixabay_music`
- `freesound_music`
- `export_bundle`

这些 Tool 现已进入 cinematic 的统一阶段 Tool 目录及 Worker capability snapshot。注册状态与运行状态分离：已接通的只读 Agent Tool 和现有生成/合成任务发布为 `available`；尚缺队列消费者、授权对象键交接或独立审批阶段的 Tool 发布为 `unconfigured`，不因已有 TypeScript 实现而误报可执行。

## 工具结果

| Tool | TypeScript 实现 | 运行前提 | 当前验证 |
| --- | --- | --- | --- |
| `video_analyzer` | 组合 FFprobe、场景检测、场景引导抽帧，输出结构/节奏/关键帧 brief | FFmpeg、FFprobe、本地任务素材 | 真实媒体测试通过 |
| `web_search` | APIMart Responses API 内置 `web_search` 适配器 | `APIMART_API_KEY`、Base URL 和支持搜索的模型 | 模拟 API 测试通过 |
| `transcriber` | APIMart Whisper-1 multipart 上传及时间段响应封装 | `APIMART_API_KEY`；输入不超过 25 MiB | 模拟 API 与文件写入测试通过 |
| `tts_selector` / TTS | selector 负责排序；`synthesizeSpeech` 调用 APIMart TTS | `APIMART_API_KEY`；调用方传入真实 capability candidates | 排序、二进制写入和 MIME 测试通过 |
| `image_selector` | 同一通用 selector 的图片操作适配 | 调用方传入图片 provider candidates | 单元测试通过 |
| `video_selector` | 同一通用 selector 的视频操作适配 | 调用方传入视频 provider candidates | 单元测试通过 |
| `pixabay_music` | Pixabay Music 页面 bootstrap 搜索及受控 CDN 下载 | 公网可达；Pixabay 页面结构稳定 | 模拟页面/API/CDN 测试通过 |
| `freesound_music` | Freesound 搜索、筛选与 MP3 preview 下载 | `FREESOUND_API_KEY` | 模拟 API/CDN 测试通过 |
| `export_bundle` | 视频、字幕、缩略图、metadata、chapters、publish log 的本地目录打包 | 已审批产物位于任务目录 | 文件系统测试通过，支持幂等覆盖 |

## 与 OpenMontage 的关键差异

### video_analyzer

OpenMontage 在一个 Tool 中自动处理 URL 下载、字幕、转写、场景检测和抽帧。本工程拆分为独立边界：

1. 用户通过受控上传链路提供授权媒体；
2. 需要文本时由 APIMart `transcriber` 处理上传媒体；
3. 本地视频再交给 `video_analyzer`。

这样可以分别设置网络、CPU、磁盘、超时、重试和幂等策略。

### web_search

OpenMontage 的 `web_search` 是宿主能力，没有单独 Python Tool。本工程已统一使用 APIMart Responses API 的内置 `web_search`，要求模型返回包含真实来源 URL 的受控 JSON；不符合结构时明确失败。

### transcriber

OpenMontage 直接使用 `faster-whisper`/WhisperX Python 库。本工程已改为 APIMart `whisper-1`，不再要求本地 Python、Whisper CLI 或模型。当前仍不支持 speaker diarization，且受 APIMart 25 MiB 单文件上限约束。

### selectors

三个 selector 只负责确定性排序和返回选择结果，不直接执行付费 provider。真实执行仍应由通过 Policy 的 Worker job 完成，避免 selector 同时承担决策和副作用。

### Pixabay / Freesound

- Freesound 使用官方 API，密钥只通过请求 header 发送，不写入结果或日志。
- Pixabay 沿用原库 bootstrap 方案，但固定 Pixabay 域名和 CDN 域名；页面结构变化时会明确失败。
- 下载校验 HTTPS、允许域名、MIME、Content-Length 和实际最大 50 MiB。
- 两者返回许可证来源，最终使用仍需保留资产 provenance。

### 已移除的可选 Tool

`video_downloader`、`transcript_fetcher` 和 `hyperframes_compose` 已按产品边界移除。当前 cinematic 只处理用户上传或系统生成的授权素材，并固定使用 FFmpeg renderer，不再要求 yt-dlp 或 HyperFrames CLI。

### export_bundle

与 OpenMontage 相同，输出的是自包含目录而不是 ZIP：

```text
export/
├── video/
│   ├── output.mp4
│   └── subtitles.srt（可选）
├── metadata/
│   ├── metadata.json
│   ├── description.txt
│   ├── tags.txt（可选）
│   ├── chapters.txt（可选）
│   └── publish-log.json
└── thumbnails/
    ├── thumbnail.*（可选）
    └── concept.json（无缩略图时可选）
```

## 安全边界

- CLI 调用均使用受控 executable、参数数组与 `shell: false`。
- 所有本地输入/输出必须位于调用方声明的任务目录。
- 外部 URL 必须使用 HTTPS 且命中固定域名白名单。
- stdout、stderr、超时、媒体大小、结果数量和元数据长度均有限制。
- API/CLI 响应均以 `unknown` 处理，验证后才返回。
- selector 不执行外部副作用。

## 验证结果

执行命令：

```text
pnpm --filter @chat-to-video/tools typecheck
pnpm --filter @chat-to-video/tools lint
pnpm --filter @chat-to-video/tools test
```

结果：

- TypeScript：通过。
- ESLint：通过。
- Vitest：1 个测试文件、11 个测试全部通过。
- `video_analyzer` 使用真实 FFmpeg/FFprobe 两场景视频测试。
- APIMart web search、Whisper、TTS 以及 Pixabay、Freesound 使用模拟响应测试协议解析、域名和文件写入。
- `export_bundle` 验证目录结构、元数据和重复执行。

未执行：

- 真实 APIMart、Pixabay、Freesound 公网请求；

这些项目需要外部网络、凭据或未安装 CLI，不能由单元测试结果推断为已配置。

## 工作流注册结果

阶段 Tool 映射由 `packages/contracts/src/cinematic.ts` 单点声明，API、Agent 和 Worker 不再各自维护另一份阶段表：

| cinematic 阶段 | 注册 Tool | 当前运行状态 |
| --- | --- | --- |
| `research` | `web_search` | Agent 只读 Tool，已接通 APIMart research gateway |
| `proposal` | `image_selector`、`video_selector`、`tts_selector` | selector 已可调用；TTS selector 会依据真实语音 capability 返回可用或不可用 |
| `script` | `transcriber`、`scene_detect` | 已注册，等待受控源素材 job/对象键交接 |
| `scene_plan` | `video_analyzer`、`audio_probe`、`scene_detect`、`frame_sampler` | 已注册，等待 `media-probe-jobs` 消费者及授权素材交接 |
| `assets` | selectors、APIMart TTS、素材音乐、生成器、标题卡、字幕和音频增强 | image/video/music generator 与 title card 已接通；其余按真实依赖发布状态 |
| `edit` | 裁切、字幕烧录、音频增强、静音裁切、调色 | 字幕轨已通过 edit artifact 与 render payload 接入 Worker；其余能力仍按真实依赖发布状态 |
| `compose` | `video_compose`、`audio_mixer`、探测、QA、`export_bundle` | FFmpeg compose/audio mix 已接通；QA/export 等待 final review/publish 审批边界 |

Mastra Agent 根据当前 stage 仅暴露该阶段允许的只读 Tool；媒体计算仍通过 BullMQ Worker，未进入 API 请求线程。Worker capability snapshot 会公开每个执行 Tool 的 `available` 或 `unconfigured` 状态及原因，供能力预检和 selector 使用。

仍需后续实现的是执行链路，而非再次注册：

1. 为 source analysis、transcription、edit、final review 和 publish 定义共享 job payload 与幂等消费者。
2. 通过受控对象键把用户授权素材交给 `media-probe-jobs`，不得把本地路径交给 Agent。
3. 增加独立 final review、publish 阶段后，再把 `visual_qa`、`av_sync_qa`、`export_bundle` 从 `unconfigured` 提升为可执行。
