# Web 设计令牌

Web 端在 `apps/web/app/globals.css` 维护一套 Codex 风格的中性色设计令牌。明色值定义在 `:root`，暗色值定义在根节点的 `.dark` 类中；Tailwind CSS 通过 `@theme inline` 暴露语义化工具类。

## 主题行为

- 首次访问跟随 `prefers-color-scheme`。
- Agent 工作区默认跟随系统明暗主题，并兼容读取历史保存的 `localStorage["filfil-theme"]` 选择。
- 根布局在页面内容渲染前应用主题，避免首屏主题闪烁。

## 使用约定

新组件只使用语义 token，不直接使用 `zinc`、`white`、`black` 或十六进制页面颜色。

| 用途 | Tailwind 示例 |
| --- | --- |
| 页面与画布 | `bg-background`、`bg-canvas` |
| 卡片与浮层 | `bg-card`、`bg-popover` |
| 主次文字 | `text-foreground`、`text-muted-foreground` |
| 交互操作 | `bg-primary text-primary-foreground`、`hover:bg-accent` |
| 边界与焦点 | `border-border`、`ring-ring` |
| 侧边栏 | `bg-sidebar`、`text-sidebar-foreground`、`border-sidebar-border` |
| 状态 | `text-success`、`bg-warning-muted`、`text-destructive` |

圆角、阴影、字体和动效时长同样由 token 管理。Agent 工作区仍有少量历史样式由 `studio-theme` 下的兼容映射适配两套主题；新代码不得继续扩展该兼容层，应直接使用语义工具类。
