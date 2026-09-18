---
title: '当前架构'
lede: 'openElement 是一个 Web Components 原生、static-first 的应用框架。Custom Elements 是持久的组件契约；JSX 与 Basic Element 是创作模式；Vite 与 Nitro 是官方构建与输出路径。'
order: 10
---

> 适用于 {{OPENELEMENT_VERSION}}。

## 包依赖图

依赖方向——使用方指向其依赖。

<figure class="diagram" aria-hidden="true"><svg viewBox="0 0 144 88" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="22" cy="20" r="9"/><circle cx="122" cy="20" r="9"/><circle cx="72" cy="74" r="9"/><path d="M31 26l29 9"/><path d="M113 26l-29 9"/><path d="M72 52v13"/><g style="color:var(--brand)"><circle cx="72" cy="40" r="12"/><circle cx="72" cy="40" r="3.5" fill="currentColor" stroke="none"/></g></svg></figure>

| 包                     | 角色                | 依赖                        |
| ---------------------- | ------------------- | --------------------------- |
| `@openelement/element` | 运行时 · 零框架依赖 | —                           |
| `@openelement/router`  | 页面 · 路由 · 构建  | 使用 `@openelement/element` |
| `@openelement/ui`      | 可选原语            | 可选                        |
| `@openelement/create`  | starter · 构建期    | —                           |

> 已退役：`core` · `signal` · `protocol` · `content` · `ssg` · `app` ·
> `adapter-vite` · `app/preact` · `app/spa`。

## 深模块隐藏实现复杂度。

作者使用产品接口。renderer、router、signal、content
与构建期细节保持内部化，直到真实的变体需求证明需要公开接缝。

| 层          | 包                                            | 职责                                                               |
| ----------- | --------------------------------------------- | ------------------------------------------------------------------ |
| element     | `@openelement/element`                        | Custom Elements、JSX、DSD、hydration 与 signals 的统一创作界面。   |
| application | `@openelement/router`                         | 面向完整应用的页面、路由、islands 与渲染语义。                     |
| build       | `@openelement/router`                         | Vite 集成、静态生成与可部署的 Nitro 输出，收敛在一个构建边界之内。 |
| adoption    | `@openelement/create`，可选 `@openelement/ui` | 以 starter 为先的采用路径与可选原语；两者都不暴露已退役的实现包。  |

## Web Components 就是应用架构。

路线图以兼容性证据、完整的应用闭环与可移植的运维能力赢得 WC
全栈领导地位——而不是靠不断增长的包数量。

### WC SSR

当前版本线会把已准入的标准、Lit、FAST 与 Stencil 元素分类为 DSD、light DOM
或仅客户端渲染，并提供可操作的诊断与语料证据——该契约最初随 0.43
线交付，并在编译型版本线上由 CI 持续验证。

### 应用闭环

路由、数据、渐进式表单、action、重定向与重新校验构成一个深的 App
接口，而不是一堆浅包。

### 可移植输出

Node 与 Workers
输出从打包后的公开产物验证。服务提供方自有的恢复路径由参考栈证明；框架自有
cache/recovery API 尚未分配版本，必须经过未来的决策记录。

## 当前真相由机器校验。

包表面、文档真相、产物、关键路径与浏览器测试，共同拒绝退回已退役的产品图。

| 门禁         | 要求                                                               |
| ------------ | ------------------------------------------------------------------ |
| 4 个包       | 当前消费面、starter 与文档保持一致。                               |
| 输出切分     | static 与 request-time 的输出切分已冻结；0.41.x 静态冻结未被触动。 |
| 3 个浏览器   | 候选版本发布需要 Chromium、Firefox 与 WebKit 的验证。              |
| 打包产物验证 | 消费方从公开产物构建，而不是 workspace 别名。                      |

## Package 兼容性

openElement 把第三方 Custom Elements 视为基于标准的依赖。当前构建通过显式的 package island 配置与可用的 Custom Elements Manifest metadata 完成 SSR 准入。

### 当前契约

`@openelement/element` 负责编写体验；`router` 包把应用行为与构建行为收敛在一个边界之内。

### 显式准入

已知包可配置为 package island，并利用可用的 CEM metadata，无需引入已退役的包接口。

### 当前诊断

当前版本线交付通用 DSD/light/client-only 分类、hydration 不匹配诊断与已跟踪的第三方 WC SSR 语料库——最初随 0.43 线交付，并在编译型版本线上由 CI 持续验证。准入仍依赖显式 package-island 配置与已观测 metadata，并不意味着对所有第三方组件作笼统认证。

## 另见

- [openElement 对比主流框架](/zh/architecture/comparison)——这套架构的定位。
- [核心概念](/zh/guide/core-concepts)——同一套模型在作者视角下的表述。
