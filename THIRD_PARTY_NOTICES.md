# Third-Party Notices

## OpenMontage

本项目的首批 Cinematic Agent Skills 由 OpenMontage 中的工作流提示与审核规则改编而来。

- 上游项目：https://github.com/calesthio/OpenMontage
- 固定来源提交：`f55180874718faaf40e81efcef0eebefab7ce38b`
- 上游许可：GNU Affero General Public License v3.0（AGPL-3.0）
- 候选来源：`AGENT_GUIDE.md`、`skills/meta/checkpoint-protocol.md`、`skills/pipelines/cinematic/{research,proposal,script,scene,asset,edit}-director.md`、`skills/meta/reviewer.md`
- 本项目目标：`apps/api/src/agent-extensions/skills/*/SKILL.md`

改动包括：转换为 Mastra 原生 Skill 目录、将全局生产治理适配到本项目 Pipeline 注册表与 Mastra/MySQL/BullMQ 边界、对齐本项目 `scene_plan` 与 `cinematic-production` 术语、移除 Shell/任意下载/Agent 直调付费模型等能力，并加入只读 Tool、RequestContext 和审计边界。

仓库根目录的 `LICENSE` 保留并适用 AGPL-3.0 完整文本。

The APIMart Seedream and FlowMusic adapter request/response handling also adapts behavior from OpenMontage `tools/graphics/apimart_seedream.py`, `tools/audio/apimart_flow_music.py`, and `tools/apimart_client.py` at the pinned upstream commit above. The implementation was rewritten in TypeScript behind this project's Worker, validation, storage, and queue boundaries.
