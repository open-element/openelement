---
title: '选 island 策略'
lede: '四个策略，每个组件做一次决策：它的 JavaScript 何时可以加载，在此之前读者得到什么。'
navLabel: 'Island 策略选型'
order: 122
section: 'Recipes'
---

## 默认是不做 island

渲染内容、布局或文档的组件保持 `dsd-static`：序列化为 DSD，永远没有客户端模块。只有需要运行时状态或框架互操作的组件才晋升为 island。下面的决策假设晋升已经物有所值。

## 四个选项

```tsx
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({ hydrate: 'visible', ssr: true, dsd: true });
```

- `load`——首屏控件：导航、搜索、主题。解析后立即导入；阻塞绘制就是它的工作。
- `idle`——交互但非关键：计数器、表单、选项卡。浏览器空闲时升级，永不阻塞绘制。
- `visible`——首屏之下的分量：评论、图表、嵌入。IntersectionObserver 到视口附近才放行拉取。
- `only`——无法产出可靠 DSD 的纯浏览器组件（canvas、媒体、WebGL）。服务端只输出宿主标签与序列化 props；跳过 SSR。

## 实例决策

- **主题切换** → `load`。它必须响应第一次点击；来晚了会闪错主题。
- **文档搜索** → `load`。同理：头部控件是首屏 chrome。
- **代码块复制按钮** → `idle`。有用，但没人会在前 50ms 复制代码。
- **文章下的评论区** → `visible`。重、在页面深处、经常到不了。
- **hero 上的实时光标跟随** → `only`。它无法有意义地 SSR，也绝不能拖慢文档。

## 在此之前

chunk 到达之前，元素保留服务端标记与样式——DSD 内容，或 `only` 的声明宿主标签。页面从不依赖任何 island 已经加载，正因如此，上面的选择只关乎时机，从不关乎正确性。

## 另见

- [Islands 与 SSR](/zh/guide/islands-and-ssr)——在应用中声明策略。
- [Island Hydration](/zh/architecture/islands)——分层、manifest 与 claim。
- [术语表](/zh/guide/glossary)——island、策略、manifest 一处速查。
