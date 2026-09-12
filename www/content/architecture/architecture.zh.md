---
title: '当前架构'
lede: 'openElement 是一个 Web Components 原生、static-first 的应用框架。Custom Elements 是持久的组件契约；JSX 与 Basic Element 是创作模式；Vite 与 Nitro 是官方构建与输出路径。'
order: 10
---

## 包依赖图

依赖方向——使用方指向其依赖。

| 包                          | 角色                | 依赖                        |
| --------------------------- | ------------------- | --------------------------- |
| `@openelement/element`      | 运行时 · 零框架依赖 | —                           |
| `@openelement/app`          | 页面 · 路由         | 使用 `@openelement/element` |
| `@openelement/adapter-vite` | 唯一的宿主侧        | 构建于 `@openelement/app`   |
| `@openelement/ui`           | 可选原语            | 可选                        |
| `@openelement/create`       | starter · 构建期    | —                           |

> 已退役：`core` · `signal` · `router` · `protocol` · `content` · `ssg`。

## 深模块隐藏实现复杂度。

作者使用产品接口。renderer、router、signal、content 与构建期细节保持内部化，直到真实的变体需求证明需要公开接缝。

| 层          | 包                                            | 职责                                                                        |
| ----------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| element     | `@openelement/element`                        | Custom Elements、JSX、DSD、hydration 与 signals 的统一创作界面。            |
| application | `@openelement/app`                            | 面向完整应用的页面、路由、islands 与渲染语义。                              |
| build       | `@openelement/adapter-vite`                   | Vite 集成、content、静态生成与可部署的 Nitro 输出，收敛在一个构建边界之内。 |
| adoption    | `@openelement/create`，可选 `@openelement/ui` | 以 starter 为先的采用路径与可选原语；两者都不暴露已退役的实现包。           |

## Web Components 就是应用架构。

路线图以兼容性证据、完整的应用闭环与可移植的运维能力赢得 WC 全栈领导地位——而不是靠不断增长的包数量。

### WC SSR

当前版本线会把已准入的标准、Lit、FAST 与 Stencil 元素分类为 DSD、light DOM 或仅客户端渲染，并提供可操作的诊断与语料证据——该契约最初随 0.43 线交付，并在编译型版本线上由 CI 持续验证。

### 应用闭环

路由、数据、渐进式表单、action、重定向与重新校验构成一个深的 App 接口，而不是一堆浅包。

### 可移植输出

Node 与 Workers 输出从打包后的公开产物验证。服务提供方自有的恢复路径由参考栈证明；框架自有 cache/recovery API 尚未分配版本，必须经过未来 ADR。

## 当前真相由机器校验。

包表面、文档真相、产物、关键路径与浏览器测试，共同拒绝退回已退役的产品图。

| 门禁         | 要求                                                             |
| ------------ | ---------------------------------------------------------------- |
| 5 个包       | 当前消费面、starter 与文档保持一致。                             |
| ADR-0122     | 0.42.0 已冻结（ACCEPTED）；0.41.x 静态冻结（ADR-0119）未被触动。 |
| 3 个浏览器   | 候选版本发布需要 Chromium、Firefox 与 WebKit 的验证。            |
| 打包产物验证 | 消费方从公开产物构建，而不是 workspace 别名。                    |
