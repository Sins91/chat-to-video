# 视频连通性一键测试

默认命令只检查 API、共享 contracts、APIMart 余额和实时价格，不调用模型：

```powershell
pnpm.cmd test:connectivity
```

文本规划测试需要总费用上限和显式确认，运行到 `assets` 规划审批点后停止：

```powershell
$env:CONNECTIVITY_MAX_TOTAL_COST_USD = "0.30"
$env:CONNECTIVITY_PLANNING_CONFIRM = "CALL_TEXT_MODELS"
$env:CONNECTIVITY_REPORT_PROMPTS = "true"
pnpm.cmd test:connectivity:planning
```

启用 `CONNECTIVITY_REPORT_PROMPTS=true` 时，脚本从编译后的 API 模板注册表输出初始提示词、实际命中的 Skill ID，以及 `assets` 审批点的全部最终素材提示词；仍不会发送素材生成审批。首次使用前需先运行 `pnpm --filter @chat-to-video/api build`。

`test:connectivity:prepaid` 保留为 `planning` 的兼容别名。

真实成片测试需要独立确认令牌：

```powershell
$env:CONNECTIVITY_MAX_TOTAL_COST_USD = "1.20"
$env:CONNECTIVITY_PAID_CONFIRM = "GENERATE_PAID_VIDEO"
pnpm.cmd test:connectivity:paid
```

图片输入支持上传探测、规划和真实成片三种模式：

```powershell
$env:CONNECTIVITY_REFERENCE_IMAGE_PATH = "D:\fixtures\product.png"
$env:CONNECTIVITY_REFERENCE_PURPOSE = "product"
$env:CONNECTIVITY_REFERENCE_LABEL = "连通性测试产品"

pnpm.cmd test:connectivity:image:upload

$env:CONNECTIVITY_MAX_TOTAL_COST_USD = "0.40"
$env:CONNECTIVITY_PLANNING_CONFIRM = "CALL_TEXT_MODELS"
pnpm.cmd test:connectivity:image:planning

$env:CONNECTIVITY_MAX_TOTAL_COST_USD = "2.00"
$env:CONNECTIVITY_PAID_CONFIRM = "GENERATE_PAID_VIDEO"
pnpm.cmd test:connectivity:image:paid
```

图片必须是与扩展名匹配的 JPEG、PNG 或 WebP，非空且不超过 10 MiB。付费图片测试拒绝真人和敏感内容。上传图片作为锚点不会调用 Seedream；若规划额外要求生成锚点图，脚本会因当前运行时 Seedream 估价低于实时价格而在付费队列前停止。

完整模式、费用和失败恢复说明见 [连通性测试方案](../docs/连通性测试方案.md)。
