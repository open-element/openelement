---
title: '用 token 换主题'
lede: '经 `:root` 自定义属性给站点换品牌色——含深色变体，不动任何组件样式。'
navLabel: '主题定制'
order: 121
section: 'Recipes'
---

## token 先行

页面读语义角色（`--brand`、`--text-primary`、`--bg-base`）；组件从不硬编码调色板。所以主题就是一份 `:root` 覆盖表，而不是每个组件 fork 一份。这是[样式](/zh/guide/styling)中的契约：自定义属性穿透 shadow 边界继承。

## 覆盖表

```css
:root {
  --brand: #0f766e;
  --brand-hover: #115e59;
  --brand-subtle: rgb(15 118 110 / 0.12);
}

:root[data-theme='dark'] {
  --brand: #2dd4bf;
  --brand-hover: #5eead4;
  --bg-base: #0b0f0e;
  --text-primary: #e7efed;
}
```

把它作为文档级样式表引入（或内联进 app shell head）。下一次绘制时每棵 shadow 树继承新墨色——无需重编组件。

## 检查单

- 只覆盖**角色**，不碰原始色阶：`--brand` 与 `--bg-*`/`--text-*`，而不是 `--violet-7`。原始色阶按主题调过；角色已经编码了配对关系。
- 浅深两主题一起发货。只换浅色会让深色模式穿着半套品牌。
- 守住 AA 配对：正文在两个主题下都要与其表面达到 4.5:1。只验主题最常碰的两块表面（页面基底、卡片），验完收工。
- 状态色（`--success`、`--warning`、`--error`、`--info`）也是语义的——除非品牌要求，否则别重染；真要染，subtle 洗色保持半透明。

## 另见

- [样式](/zh/guide/styling)——页面样式住哪，什么穿过 shadow 边界。
- [Design System](/zh/architecture/design-system)——本配方覆盖的 token 角色。
- [术语表](/zh/guide/glossary)——Custom Element、shadow root、DSD 一处速查。
