---
title: '架构指南'
lede: '导读：OpenElement 的组织方式，以及完整架构页的位置。'
order: 20
---

## 分层

消费包图为五包：`element`（统一编写表面）、`app`（pages、routes、islands）、`adapter-vite`（唯一宿主侧）、`create`（starter）与可选 `ui`。Deep modules 隐藏实现复杂度。

## 战略方向

Web Components 即应用架构：WC SSR、完整的 application loop 与可移植输出——而不是包数量的增长。

## 发布门禁

当前事实由机械化检查保障：package surface、docs truth、artifacts 与浏览器测试拒绝退回已退役的包图。

含 package graph 与 layer map 的完整页见架构栏：[Current Architecture](/zh/architecture/architecture)
