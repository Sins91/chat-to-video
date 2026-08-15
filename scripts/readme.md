已设置两套可执行测试方案。

### 方案一：素材付费生成前

```
pnpm.cmd test:connectivity:prepaid
```

自动验证：

* REST、SSE、MySQL、Redis/Mastra 连通性
* `proposal → script → scene_plan → assets` 暂停恢复
* 素材费用估算
* 强制确认 `assetBatch=null`、`videoJob=null`
* 不发送素材生成批准，不进入图片、视频、音乐付费队列

注意：规划阶段仍会产生少量文本模型费用。

### 方案二：预算门禁后生成真实视频

```
$env:CONNECTIVITY_MAX_COST_USD = "0.50"
$env:CONNECTIVITY_PAID_CONFIRM = "GENERATE_PAID_VIDEO"
$env:CONNECTIVITY_PROMPT = "制作一个6秒的单镜头测试视频……"

pnpm.cmd test:connectivity:paid
```

脚本会先输出逐项及总费用。只有费用不超过预算且确认令牌正确，才会：

1. 批准素材生成
2. 等待图片、视频、音乐任务完成
3. 批准生成素材
4. 创建 continuation run
5. 执行 FFmpeg 合成
6. 验证 `succeeded`、`job.completed` 和播放地址

相关文件：

* \[执行脚本]\(/D:/projects/company/chat-to-video/scripts/video-connectivity-test.cjs)
* \[门禁测试]\(/D:/projects/company/chat-to-video/scripts/video-connectivity-test.test.cjs)
* \[完整测试说明]\(/D:/projects/company/chat-to-video/docs/连通性测试方案.md)
* \[根命令配置 (line 23)]\(/D:/projects/company/chat-to-video/package.json:23)

已通过 Node 语法检查、ESLint 和 `git diff --check`。未启动服务、未运行测试套件、未调用模型，因此本次没有产生费用。
