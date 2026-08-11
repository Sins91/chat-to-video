# Web Agent Rules

本文件补充仓库根规则，适用于 `apps/web`。

## Agent 界面样式

- Agent 工作区及其聊天、工作流、预览组件，新增或修改样式时优先直接使用 Tailwind CSS 工具类；布局、间距、尺寸、排版、颜色、状态、响应式和简单选择器不得为方便而新增页面级自定义 CSS 类。
- 颜色优先使用 Tailwind 暴露的语义设计 token（如 `bg-background`、`text-foreground`、`border-border`），避免新增硬编码色值；确需动态值时优先使用 Tailwind 任意值或 CSS 变量。
- 仅当样式属于跨组件主题 token、全局基础规则、复杂且重复使用的多层背景或动画，或第三方组件无法通过 `className` 覆盖时保留 CSS；保留时使用语义化类名，并简短说明 Tailwind 不适合表达的原因。
- 修改 Agent 界面时，应迁移所触及范围内可等价表达的旧自定义 CSS 类；不得借机重写无关页面或删除仍被其他页面依赖的兼容规则。