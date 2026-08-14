# OpenMontage cinematic 第二批 Tool 移植报告

日期：2026-08-14

## 结果

第二批剩余能力已迁移到 `packages/media`：

| 管线步骤 | Tool / 能力 | 结果 |
| --- | --- | --- |
| assets 异步生产 / edit | `subtitle_burn` | 已实现 FFmpeg/libass 确定性字幕烧录 |
| edit | `video_trimmer.speed` | 已实现 0.25–4 倍音视频同步变速 |
| edit / compose | `video_trimmer.concat` | 已实现带可选区间的多片段规格归一与拼接 |
| edit / compose 前处理 | `color_grade.lut` | 已实现任务目录内受控 `.cube` LUT |
| edit | `silence_cutter.detect` | 已实现静音段检测与保留语音段计算 |
| edit | `silence_cutter.cut` | 已实现带 padding 的静音裁切 |
| final review | `av_sync_qa` | 已实现音视频流起止时间戳偏差检查 |

本批没有修改 cinematic 管线、BullMQ、数据库、API 或 Web。

## 实现与 OpenMontage 的差异

### video_trimmer.speed

- 视频使用 `setpts`，音频使用受控 `atempo` 链。
- 输出统一为 H.264/AAC MP4，并显式约束目标输出时长。
- 测试发现低帧率无音轨素材仅使用 `setpts` 时，MP4 封装时长可能多约 0.2 秒；已修复。

### video_trimmer.concat

- 支持 1–20 个输入，每段可指定 start/end，总时长不超过 300 秒。
- 拼接前统一分辨率、帧率和像素格式。
- 支持全部有音轨或全部无音轨；拒绝混合音轨存在状态。
- 未复制 OpenMontage 的 concat list 与 `safe=0`，改用受控 `filter_complex`，避免路径进入清单语法。

### color_grade.lut

- LUT 必须位于当前任务允许目录，扩展名必须为 `.cube`。
- 不接受远程 URL、任意本地路径、自定义 filter 或 codec。
- 当前不支持 LUT intensity 混合。

### subtitle_burn

- 复用 `subtitle_gen` 生成受控 SRT，再用 FFmpeg/libass 烧录。
- 临时字幕放在输出任务目录的独立临时目录，成功或失败都会清理。
- 当前对应 OpenMontage 的 FFmpeg fallback；没有迁移 Remotion 动画/逐词字幕，不宣称视觉等价。

### silence_cutter

- 支持静音阈值、最小时长和双侧 padding。
- 能处理文件末尾只有 `silence_start` 的静音段。
- 使用 trim/atrim/concat filter graph 一次生成同步音视频结果。
- 最多 50 个保留段；全静音时拒绝空输出；无静音时流复制。
- 没有实现 OpenMontage 的 `speed_up` 静音模式，因为既定第二批范围是检测/裁切。

### av_sync_qa

- 输出音视频 start/end offset 和容差结论。
- 能力范围明确标记为 `container_timestamps`。
- 可以发现容器/编码时间轴偏差，不能判断人物口型与语音内容的语义同步。

## 安全边界

- FFmpeg/FFprobe 使用参数数组和 `shell: false`。
- 输入、输出、LUT 和临时字幕必须位于同一任务目录。
- 不开放任意 filter graph、codec、concat list 或本地路径。
- 数量、时长、分辨率、帧率、倍速、CRF、静音阈值和同步容差均有边界。
- 进程有超时和有界输出，产物返回前校验为非空普通文件。
- 这些函数只能由 Worker 在隔离任务目录中执行，不应在 API 请求线程执行。

## 验证结果

执行：

```text
pnpm --filter @chat-to-video/media typecheck
pnpm --filter @chat-to-video/media lint
pnpm --filter @chat-to-video/media test
```

最终结果：

- TypeScript：通过。
- ESLint：通过。
- Vitest：4 个测试文件、17 个测试全部通过。
- 第二批测试真实执行 FFmpeg/FFprobe，没有跳过。

实际验证内容：

- 2 倍速后的实际封装时长；
- 带裁切区间的两段视频拼接；
- identity `.cube` LUT；
- FFmpeg/libass 字幕烧录；
- 中间静音检测、padding 和裁切后时长；
- 裁切后音视频起止时间偏差；
- 任务目录外 LUT 拒绝。

## 接入方案

1. 在 `packages/contracts` 定义 Zod 输入、结果和队列载荷，跨边界只传 ID、对象键与已验证参数。
2. Worker 从对象存储下载到 job 隔离目录，再调用本批函数并上传结果。
3. `subtitle_burn` 只消费已审批字幕资产，不能重新生成或改写文本。
4. `concat` 只消费 scene plan/edit decision 中的有序片段。
5. LUT 先作为项目资产完成 MIME、大小和内容校验，再进入任务目录。
6. 静音检测结果先形成可审计 edit proposal，裁切需由审批/Policy 决定。
7. `av_sync_qa` 仅作为 final review 证据，不能替代口型同步模型。

## 两批完成后的状态

原定两批媒体 Tool 均已实现。尚未覆盖但可以作为后续独立批次评估的能力：

- Remotion 动画/逐词字幕视觉等价；
- 静音段加速而非裁切；
- LUT 内容 Schema 校验和强度混合；
- 口型—语音语义同步检测；
- Worker 队列、对象存储、幂等、取消和进度事件接入；
- Linux CI 与多 FFmpeg 版本兼容矩阵。
