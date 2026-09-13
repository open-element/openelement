---
title: '设计体系'
lede: 'www 站点当前生效的 dogfood 契约：经过审计的 Open Props token、沿用的 UI 原语、产品化图示，以及完整的暗色模式对等。它不是框架的强制要求。'
order: 15
---

- 只使用严格的 Open Props 与语义化 token。
- 只有可复用的原语才进入 `@openelement/ui`；站点视觉留在 `www`。
- 动效尊重 reduced-motion 偏好。
- 不做 Linear 翻版、装饰性色块或局部色彩体系。
- Letter spacing 保持为 `0`。

## 语义角色映射到 Open Props

原始的 Open Props 值止步于经过审计的 token 边界；页面与原语只消费语义角色。

| 角色     | Token                                            | 用途                             |
| -------- | ------------------------------------------------ | -------------------------------- |
| Canvas   | `--bg-base`                                      | 页面背景与网格底场。             |
| Surface  | `--bg-card` / `--bg-elevated`                    | 阅读表面与浮层面板。             |
| Artifact | `--bg-code` / `--code-border`                    | 代码、devtools、路由与包结构图。 |
| Text     | `--text-primary` / `--text-secondary`            | 明暗两套主题下都可读的文本层级。 |
| Action   | `--brand` / `--on-brand`                         | 主要命令与链接强调。             |
| State    | `--success` / `--warning` / `--info` / `--error` | 路线图、标准、参考与失败状态。   |

## 本站 dogfood 可选的 UI 原语

按钮、输入框、徽章与卡片的行为保持可复用；品牌与电影感对象仍是本站私有。

### 所有权链

- **Token** — surface、text、brand、focus、motion 与 elevation 角色。
- **Recipe** — 交互状态、排版与材质组合。
- **Primitive** — 十个语义经过测试的可复用 Web Components。

### 按钮

命令使用稳定的尺寸、token 颜色与 focus-visible 状态。

```html
<open-button variant="primary">Primary</open-button>
<open-button>Secondary</open-button>
<open-button variant="ghost">Ghost</open-button>
```

### 输入框

输入框保持实用，继承同一套 Open Props token 体系。

```html
<open-input value="app/routes/index.tsx" readonly></open-input>
```

### 状态与动效

状态标签与动效状态以可读文本为先，颜色其次。

```html
<open-badge tone="brand">current</open-badge>
<open-badge tone="success">done</open-badge>
<open-badge tone="warning">planned</open-badge>
```

## 代码与图示就是视觉资产

真实的标准对象承载视觉识别，无需素材插画，也无需框架味的装饰。

## 组合原则

每个页面都从一个产品对象开始，保持明暗对等，并让动效从属于理解。

1. **以产品对象开场。** 在第一个视口展示路由、包图、代码、浏览器契约或文档结构。
2. **把组件当作站点体系。** 本站 dogfood 沿用的 `@openelement/ui` 原语；对应用作者而言 UI 始终是可选的。
3. **把暗色模式当作对等。** 每个页面与每个 shadow 组件都必须经由同一套语义 token 解析。
