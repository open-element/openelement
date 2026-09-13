---
title: '.less Compiler — 可选零框架运行时组件'
date: '2026-04-30'
lang: 'zh'
excerpt: '一个可选编译器将声明式 .less 文件编译为原生 Custom Elements，让 Lit 从必选路线变成 adapter。'
tags: ['architecture', 'compiler']
---

一个可选编译器将声明式 .less 文件编译为原生 Custom Elements，让 Lit 从必选路线变成 adapter。

LessJS 框架从第一天起就选择了 Lit 作为组件基础。这个选择是对的——Lit 是 Web Components 生态中最成熟的库，让我们快速验证了架构的可行性。但经过后续架构审查，我们也更清楚地看到：core 的长期合同不能绑定到某个组件库。Lit 应该保留为 adapter，而不是成为用户必须接受的唯一组件模型。

## 今天的代价

依赖 Lit 编写的 island 会携带 Lit 运行时；SSR/style extraction 需要 adapter 维护；旧 Lit SSR 路线留下的 hydration 术语又容易和现在的 DSD + Custom Element upgrade 模型混淆。结论不是"消灭 Lit"，而是把 Lit 放回正确的位置：一个好 adapter，而不是 LessJS 的定义本身。

## .less 文件格式

一个组件一个文件。没有 class 声明，没有 decorator，没有 import：

```html
<!-- my-counter.less -->
<template>
  <button @click="decrement">−</button>
  <span>{count}</span>
  <button @click="increment">+</button>
</template>
<script>
  count = 0
  increment() { this.count++ }
  decrement() { this.count-- }
</script>
<style>
  :host { display: inline-flex; gap: 0.5rem; align-items: center; }
</style>
```

## 编译器产出

零依赖的原生 Custom Element：

```javascript
class MyCounter extends HTMLElement {
  #count = 0;
  #root = this.attachShadow({ mode: 'open' });
  get count() {
    return this.#count;
  }
  set count(v) {
    this.#count = v;
    this.#update();
  }
  connectedCallback() {
    this.#root.append(tpl.content.cloneNode(true));
    this.#root.querySelector('button:first-child').onclick = () => this.count--;
    this.#root.querySelector('button:last-child').onclick = () => this.count++;
  }
}
```

## 消除清单

- Lit-authored islands 的框架运行时代价 → 编译产物 0 KB framework runtime
- adapter-mediated SSR → LessJS DSD renderer / template strings
- hydration 术语漂移 → 明确的 Custom Element upgrade
- decorator / tagged template 生态复杂度 → 标准 JS 输出
- 复杂的类型层次 → 简单的 getter/setter

## 路线

这项工作不应该阻塞 v0.7–v0.10。当前路线是：先修可信度、安全、DSD renderer、Island Upgrade、Serverless Fullstack 与 SSG/ISR，再在 v0.11.0 引入 `.less` compiler alpha。Lit 兼容模式在 v0.x 生命周期中保留。版本策略详见 [ADR 0006](/blog/0006-version-strategy)。

详细技术设计见 [ADR 0002](/blog/0002-less-compiler-eliminate-lit)。
