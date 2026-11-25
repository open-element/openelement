---
title: '当前架构'
lede: 'Web Components 原生、static-first 的框架：Custom Elements 是持久的契约，编译型 JSX 是创作模型，Vite 与 Nitro 是构建路径。'
order: 10
---

> 适用于 {{OPENELEMENT_VERSION}}。

## 包依赖图

依赖方向——使用方指向其依赖。

<figure class="diagram" aria-hidden="true"><svg viewBox="0 0 144 88" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="22" cy="20" r="9"/><circle cx="122" cy="20" r="9"/><circle cx="72" cy="74" r="9"/><path d="M31 26l29 9"/><path d="M113 26l-29 9"/><path d="M72 52v13"/><g style="color:var(--color-primary)"><circle cx="72" cy="40" r="12"/><circle cx="72" cy="40" r="3.5" fill="currentColor" stroke="none"/></g></svg></figure>

| 包                       | 角色                | 依赖                                                    |
| ------------------------ | ------------------- | ------------------------------------------------------- |
| `@openelement/protocol`  | 契约 · 零依赖       | —                                                       |
| `@openelement/element`   | 运行时              | 使用 `@openelement/protocol`                           |
| `@openelement/compiler`  | 构建期编译器        | 使用 `@openelement/protocol`；TypeScript 是唯一宿主依赖 |
| `@openelement/router`    | 页面 · 路由 · 构建  | 使用 `@openelement/element`、`@openelement/compiler`   |
| `@openelement/ui`        | 可选原语            | 可选 `@openelement/element`                             |
| `@openelement/create`    | starter · 构建期    | —                                                       |

## 深模块隐藏实现复杂度。

作者使用产品接口。renderer、router、signal、content
与构建期细节保持内部化，直到真实的变体需求证明需要公开接缝。

| 层          | 包                                            | 职责                                                                 |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------- |
| contracts   | `@openelement/protocol`                       | 渲染、路由与诊断的共享契约。     |
| element     | `@openelement/element`                        | Custom Elements、JSX、DSD、hydration 与 signals 的统一创作界面。     |
| build       | `@openelement/compiler`                       | 将 TSX 编译为服务端渲染器和 Custom Element 生命周期函数。 |
| application | `@openelement/router`                         | 面向完整应用的页面、路由、islands、渲染语义与构建编排。               |
| output      | `@openelement/router`                         | Vite 集成、静态生成与可部署的 Nitro 输出，收敛在一个构建边界之内。   |
| adoption    | `@openelement/create`，可选 `@openelement/ui` | 脚手架和可选的基础组件。    |

## Web Components 就是应用架构。

路线图以兼容性证据、完整的应用闭环与可移植的运维能力扩展 WC
全栈范围——而不是靠不断增长的包数量。

### WC SSR

构建将已准入的组件分类为 DSD、light DOM 或仅客户端渲染。浏览器测试验证标准、Lit、FAST 与 Stencil 元素的升级行为。

### 应用闭环

路由、数据、渐进式表单、action、重定向与重新校验构成一个深的 App
接口，而不是一堆浅包。

### 可移植输出

Node 与 Workers
输出从打包后的公开产物验证。服务提供方自有的恢复路径由参考栈证明；框架自有
cache/recovery API 尚未分配版本，必须经过未来的决策记录。

## 当前真相由机器校验。

发布验证覆盖包导出、文档、可部署产物和浏览器中的应用行为。

| 门禁         | 要求                                                                                    |
| ------------ | --------------------------------------------------------------------------------------- |
| {{PACKAGE_COUNT}} 个包 | 当前消费面（protocol/element/compiler/router/create/ui）、starter 与文档保持一致。       |
| 输出切分     | 静态 HTML 与浏览器资源公开交付，请求时模块留在服务器。                      |
| 3 个浏览器   | 候选版本发布需要 Chromium、Firefox 与 WebKit 的验证。                                   |
| 打包产物验证 | 消费方从公开产物构建，而不是 workspace 别名。                                           |

## Package 兼容性

openElement 把第三方 Custom Elements 视为基于标准的依赖。当前构建通过显式的 package island 配置与可用的 Custom Elements Manifest metadata 完成 SSR 准入。

### 当前契约

Compiler 生成渲染器和生命周期函数，Element 提供 Custom Element 运行时，Router 负责应用行为与构建。

### 显式准入

已知包可配置为 package island，并利用可用的 CEM metadata。

### 当前诊断

构建报告 DSD、light DOM、仅客户端渲染的分类和 hydration 不匹配诊断。组件准入取决于 package-island 配置及该包可用的 metadata。

## 另见

- [openElement 对比主流框架](/zh/architecture/comparison)——这套架构的定位。
- [DSD 渲染](/zh/architecture/dsd)——这张图所依赖的平台标准契约。
- [核心概念](/zh/guide/core-concepts)——同一套模型在作者视角下的表述。
