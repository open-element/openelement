# Historical decision index

Current architectural decisions live in [docs/adr](../adr/README.md). This compact index makes retired decisions discoverable without keeping their full text in current HEAD. The original documents remain available through Git history and representative tags.

| Decision                                                                                            | Status     | Approximate era | Current owner                                      |
| --------------------------------------------------------------------------------------------------- | ---------- | --------------- | -------------------------------------------------- |
| ADR-0025: Renderer Protocol                                                                         | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0026: Structured Render Pipeline (v0.16)                                                        | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0027: Roadmap Reorder — Universal Engine Before Hub                                             | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0028: Conservative Third-Party WC SSR Admission                                                 | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0029: Happy DOM for v0.18.3 DOM Simulation                                                      | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0030: Registry Hub Architecture — Static Index + CLI Submission Pipeline                        | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0031: Registry Hub v2 — Component Browser + Full-Stack Usage Workflow                           | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0032: Real Browser Snapshot Rendering (Replace happy-dom)                                       | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0033: Architecture Positioning — Three-Pillar Model                                             | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0034: Hermetic Hub Snapshots                                                                    | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0035: SSG Resilient Rendering + Visual Overhaul (Phase 6)                                       | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0036: Ocean-Island Architecture for v0.20.0                                                     | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0037: DSD-First Strategic Boundary and v0.21 Roadmap Realignment                                | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0038: ISR + Edge KV Architecture                                                                | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0039: DsdElement + Signals Reactive Architecture                                                | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0040: Streaming DSD                                                                             | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0041: ESM Module Graph First for JSR Consumer Builds                                            | Historical | pre-v0.22       | current architecture docs                          |
| ADR-0057: JSX + Signal 新组件模型，替换 html tagged template                                        | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0058: Signal→DOM 直接绑定，消灭全量 re-render                                                   | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0059: VNode 层控制流组件 — `<Show>` 与 `<For>`                                                  | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0070: 三层桥接可信化 — 从字符串拼接到 AST 契约                                                  | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0042: Import Map 作为 Universal Resolution Layer                                                | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0043: SSG Phase 3 依赖策略 — external + noExternal 两层模型                                     | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0044: SSR 浏览器 API Polyfill 策略                                                              | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0045: DSD + CSS Parts + Signals 原生 API 一等公民策略                                           | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0046: Phase 2 Client Build Import Map Resolution                                                | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0047: Deno 预解析 External 依赖 — 消除 ESM 子路径泄露                                           | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0048: CI and Release Gate Separation                                                            | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0049: Architecture Debt First Roadmap Reset                                                     | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0050: Layered Package Architecture                                                              | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0051: Self-Built `html` Template System Strengthening                                           | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0052: Signal-DOM Deep Integration — Reactive Property Binding                                   | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0053: Unified Error Handling Architecture                                                       | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0054: AST-Based External Specifier Resolution                                                   | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0055: SSR Bundle Self-Containment                                                               | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0056: External Dependencies — Consumer Import Map + AST Resolution                              | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0058: BuildPipeline 声明式 API                                                                  | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0058: 移除 TemplateResult 渲染路径，仅保留 VNode + string                                       | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0059: Route Params Reactive + `static head` + `static client` + `data-keep-alive`               | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0060: DOM-Tree-Based SignalContext                                                              | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0061: 框架层与 Vite 虚拟模块解耦                                                                | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0062: DSD-First Real DOM Signal Architecture                                                    | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0063: Unified Router — Hono + URLPattern + Content-Driven SSG                                   | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0064: Static Content Injection Model                                                            | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0065: Unified VNode Rendering Pipeline — SSR+CSR Signal-Aware Architecture                      | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0067: DSD-Native SSR/SSG Architecture — Ocean + Island Model with Signal-Native Hydration       | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0068: Show/For Activation + data-signal-attr + data-signal-html — www Zero-Effect Cleanup       | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0069: Wipe Workaround Chains — Systematic Elimination of 23 Architectural Debt Items            | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0070: Generated Data Namespace and App Shell Boundary                                           | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0071: Same Input, Same Semantics, Backend Renderers                                             | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0072: MDX in LessJS                                                                             | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0072: Unified Render API Surface — One `renderDsd`, One Entry Point                             | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0073: AppShell Protocol                                                                         | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0074: @openelement/ui Dual-Track Ocean and Island Architecture                                  | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0075: Fork daisyUI 5 Compiled CSS for DSD Shell Components                                      | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0076: Open Props and daisyUI Token Merge                                                        | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0077: Structured Render IR and Single Renderer Pipeline                                         | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0078: Core Package Simplification and Module Merge                                              | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0079: v0.29.6 Architecture Debt Closure                                                         | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0080: Architecture Contract Freeze                                                              | Historical | v0.22-v0.30     | current architecture docs                          |
| ADR-0081: VNode-Only Dynamic UI and Trusted HTML Boundary                                           | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0082: JSX-first Application API                                                                 | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0083: Deferred Public Surface Reset                                                             | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0084: Product Closure Version Line                                                              | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0085: App Lifecycle Contract                                                                    | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0086: AI-Readable Architecture and AutoFlow2 Roadmap                                            | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0087: TDD + AI Cross-Review as Cell Execution Subphases                                         | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0088: AutoFlow-First Strategy — v0.35-0.37 Precede Product Features                             | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0089: Agent Code Generator — File-System Protocol for L2 Cell Execution                         | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0090: SSG Package Extraction — @openelement/ssg                                                 | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0091: Four-Product Platform Roadmap                                                             | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0092: DsdElement Render Mode Contract                                                           | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0093: SSR / ISR Runtime Contract                                                                | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0094: Core Type Consolidation — Eliminate `types.ts`                                            | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0095: Data / Database Boundary                                                                  | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0096: Protocol-First Vite + Nitro Runtime Architecture                                          | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0097: JSR Best-Effort Release Gate                                                              | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0098: EntryDescriptor Route Manifest Contract                                                   | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0099: Four-Product Matrix and Elements Reset                                                    | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0100: JSR Publish Exit Gate Restored                                                            | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0101: Product-Line Reset and AutoFlow3 Governance Boundary                                      | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0102: Elements Package Product Surface                                                          | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0103: Archive-Candidate Package Reduction                                                       | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0104: Signal Engine Default Policy                                                              | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0105: v0.40.x Cleanup Train Exception                                                           | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0106: Audit-Driven Quality Cleanup for v0.40.6                                                  | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0107: npm-Only Distribution                                                                     | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0109: Unified Signal-DOM Activation Layer                                                       | Historical | v0.31-v0.40     | current architecture docs                          |
| ADR-0113: Beta Four Product Boundary                                                                | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0114: Continue alpha after five-package convergence                                             | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0115: Single Element Authoring Helper                                                           | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0116: Audit-Driven Alpha.16 Correctness Reset                                                   | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0117: Second Audit Round and Alpha.18 Sweep                                                     | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0118: Third Audit Round and Alpha.19 Cleanup Sweep                                              | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0119: Stable 0.41.0 With Scoped Interface Freeze and Recorded Pilot Exception                   | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0120: 0.42.0 WC Application Loop Scope and Action Protocol                                      | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0121: 0.42 Action Protocol Hardening Amendment (Audit Round 1)                                  | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0122: 0.42.0 Stable Scope Freeze — WC Light Fullstack                                           | Historical | v0.41-v0.42     | current architecture docs                          |
| ADR-0124: Keyed List Reconciliation for `<For>`                                                     | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0126: Built-in Allow-List HTML Sanitizer (`sanitizeHtml`)                                       | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0127: Unify Island Hydration Option Name (`strategy` → `hydrate`)                               | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0130: Retire the Duplicate `/_data` Loader Endpoint                                             | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0131: 2026-08-19 P3 Batch Touches to Frozen Paths Preserve ADR-0122 Contracts                   | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0132: Defer Real Scan-Engine Evidence to v0.44 — Attachment Scanning Is Optional Hardening      | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0134: Manual workflow_dispatch Greens Count as Release Evidence — Freshness Gate Evaluation Fix | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0135: 0.43.0 Stable Scope Freeze — Universal WC SSR + Supabase × Cloudflare Delivery Path       | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0136: Content Collections — Generalize the Blog Content Pipeline                                | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0138: Require Real Scanner Evidence for v0.43.1                                                 | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0139: Provider-neutral attachment scanning and v0.44 qualification                              | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0140: 0.43.x Maintenance Mode and CRM-Driven Evolution                                          | Historical | v0.42-v0.43     | current architecture docs                          |
| ADR-0144: Offload Generic Repository Governance                                                     | Historical | v0.44 Beta      | current architecture docs / active v0.44 decisions |
| ADR-0145: Content Collections Become the Unified Content Graph                                      | Historical | v0.44 Beta      | current architecture docs / active v0.44 decisions |
| ADR-0146: Three-Role Agent Execution Control Plane for v0.44                                        | Historical | v0.44 Beta      | current architecture docs / active v0.44 decisions |
| ADR-0147: Internal Alpha workspace train                                                            | Historical | v0.44 Beta      | current architecture docs / active v0.44 decisions |
| ADR-0149: v0.44 prerelease qualification and branch convergence ladder                              | Historical | v0.44 Beta      | current architecture docs / active v0.44 decisions |
| ADR-0150: Insert internal Alpha.9 semantic convergence before Beta.1                                | Historical | v0.44 Beta      | current architecture docs / active v0.44 decisions |
| ADR-0151: v0.44 release train retopology                                                            | Historical | v0.44 Beta      | current architecture docs / active v0.44 decisions |
