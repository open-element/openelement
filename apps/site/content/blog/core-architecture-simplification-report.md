---
title: '@openelement/core 架构简化审查报告'
date: '2026-05-11'
lang: 'zh'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
archived: true
---

> 审查范围：`packages/core/src/` — 入口代码生成管线（entry-descriptor.ts、entry-renderer.ts、hono-entry.ts）
> 核心原则：松耦合、高内聚、避免不必要的抽象、消除重复

---

## 发现 1: `CodeBuilder` 类是多余的抽象

**位置**: `entry-renderer.ts:29-42`

```ts
class CodeBuilder {
  private lines: string[] = [];
  push(line: string): void {
    this.lines.push(line);
  }
  blank(): void {
    this.lines.push('');
  }
  toString(): string {
    return this.lines.join('\n');
  }
}
```

**问题**: 这个类只是给 `string[]` 包了三层皮：`push` 是 `Array.push` 的透明代理，`blank` 是 `push('')` 的别名，`toString` 是 `join('\n')`。没有任何额外逻辑（没有缩进管理、没有换行跟踪、没有格式化能力）。

**影响**: 每一个 `render*` 函数都必须接受 `b: CodeBuilder` 作为参数，增加了参数耦合。因为 `CodeBuilder` 是私有的非导出类，所有渲染函数都无法独立于 `entry-renderer.ts` 测试。

**建议**: 直接使用 `string[]`。`renderEntry` 函数内部声明 `const lines: string[] = []`，所有内部渲染函数改为接受 `lines: string[]`。

```ts
// 改动量示例 — 删除 class CodeBuilder，然后：
export function renderEntry(desc: EntryDescriptor): string {
  const lines: string[] = [];
  for (const imp of desc.imports) {
    lines.push(renderImport(imp));
  }
  // ...
  return lines.join('\n');
}
```

**影响评估**: 纯机械替换，零行为变化，所有测试通过。减少 14 行代码 + 消除一个不必要的抽象。

---

## 发现 2: `hono-entry.ts` 是几乎为零的薄外观层

**位置**: `hono-entry.ts`

```ts
export function generateHonoEntryCode(
  routes: RouteEntry[],
  options: HonoEntryOptions = {},
): string {
  const descriptor = buildEntryDescriptor(routes, options);
  return renderEntry(descriptor);
}
```

**问题**: 整个函数只有 3 行有效逻辑。它唯一的存在理由是 "keep both pieces independently testable"（保持两者独立可测）。但实际上 `buildEntryDescriptor` 和 `renderEntry` 已经各自在 `entry-descriptor.ts` 和 `entry-renderer.ts` 中独立存在且独立可测。两个测试文件也都直接从 `hono-entry.ts` 导入。

**建议**: 选项 A — 将 `generateHonoEntryCode` 直接移到 `index.ts` 中（`index.ts` 已经在导入 `generateHonoEntryCode`），然后删除 `hono-entry.ts`。测试文件改为从 `entry-descriptor.ts` 和 `entry-renderer.ts` 直接导入。

或者选项 B — 保留文件但消除 HonoEntryOptions 接口的重复定义（它与 `buildEntryDescriptor` 的 options 参数几乎一样）。

**影响评估**: 减少 1 个文件（约 50 行），降低认知负担。测试导入路径需要更新。

---

## 发现 3: 内联错误转义与 `escapeHtml()` 重复

**位置**: `entry-renderer.ts:238-239`

```ts
// 生成的虚拟模块代码中的一行：
const safeErr = String(err.stack || err).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
```

**问题**: 这段 160+ 字符的内联 escaping 与 `html-escape.ts:33-38` 的 `escapeHtml()` 函数完全重复。后者是同一包中已经导出的工具函数。

**建议**: 将生成的代码改为引用 `escapeHtml`：

```ts
// 生成的代码：
import { escapeHtml } from '@openelement/core/html-escape';
// ...
const safeErr = escapeHtml(String(err.stack || err));
```

需要给生成代码添加 `escapeHtml` 的 import 声明到 `EntryDescriptor.imports` 中。

**影响评估**: 减少生成的代码体积（每页少 ~160 字符），消除逻辑重复。如果将来需要修改转义规则，只需改一处。

---

## 发现 4: 内联 SSR 辅助函数每次构建重复生成

**位置**: `entry-renderer.ts:386-401`

生成的虚拟模块代码中每次都包含完整的 `__ssr` 函数定义：

```ts
async function __ssr(tag, props = {}, sourceInfo = {}) {
  if (!tag || !tag.includes("-")) { ... }
  const Cls = customElements.get(tag)
  if (!Cls) { log.warn(...); return ... }
  return renderDSD(tag, Cls, props, sourceInfo)
}
```

此外还有 `__less_get_default_export` 辅助函数（如果有 islands 时生成）：

```ts
const __less_get_default_export = (module) => module && module.default;
```

**问题**:

- 每个页面入口复制粘贴相同逻辑，增加生成的代码体积
- `__ssr` 依赖于 `renderDSD` 和 `log`（都已从 `@openelement/core/less-runtime` 导入），所以完全可以放在共享模块中
- `__less_get_default_export` 是一个非常简单的箭头函数，可以内联到使用处

**建议**: 将 `__ssr` 放在 `less-runtime.ts` 中导出，然后生成的代码只需 `import { ..., __ssr }`。`__less_get_default_export` 可以消除，直接写 `module?.default ?? module`。

**影响评估**: 每个入口模块减少 ~200 字节。但是需要注意的是，`__ssr` 作为运行时依赖会增加 `less-runtime.ts` 的导入链——需要评估是否影响 tree-shaking。

---

## 发现 5: `renderPageRoute` 的 wrapInDocument 调用存在重复

**位置**: `entry-renderer.ts:209-228`

```ts
if (matchingRenderers.length > 0) {
  b.push(`    // Renderer wrapping (outer → inner)`);
  b.push(`    let wrapped = html`);
  for (const renderer of matchingRenderers) {
    b.push(`    wrapped = ${renderer.varName}.default.wrap(wrapped, c)`);
  }
  b.push(`    return c.html(wrapInDocument(wrapped, {`); // ← wrapped
  b.push(`      title: ${JSON.stringify(docConfig.title)},`);
  b.push(`      lang: ${JSON.stringify(docConfig.lang)},`);
  b.push(`      headExtras: ${headExtrasExpr},`);
  b.push(`      cspNonce: c.get('cspNonce'),`);
  b.push(`    }))`);
} else {
  b.push(`    return c.html(wrapInDocument(html, {`); // ← html
  b.push(`      title: ${JSON.stringify(docConfig.title)},`);
  b.push(`      lang: ${JSON.stringify(docConfig.lang)},`);
  b.push(`      headExtras: ${headExtrasExpr},`);
  b.push(`      cspNonce: c.get('cspNonce'),`);
  b.push(`    }))`);
}
```

**问题**: `wrapInDocument` 的 5 行参数在两个分支中完全相同，只有第一个参数从 `wrapped` 变成 `html`。这是典型的 "提取差值" 模式。

**建议**: 将渲染器包装后的内容赋值给一个变量，然后统一调用 `wrapInDocument`：

```ts
b.push(`    // Renderer wrapping (outer → inner)`);
b.push(`    let final = html`);
for (const renderer of matchingRenderers) {
  b.push(`    final = ${renderer.varName}.default.wrap(final, c)`);
}
b.push(`    return c.html(wrapInDocument(final, {`);
b.push(`      title: ${JSON.stringify(docConfig.title)},`);
b.push(`      lang: ${JSON.stringify(docConfig.lang)},`);
b.push(`      headExtras: ${headExtrasExpr},`);
b.push(`      cspNonce: c.get('cspNonce'),`);
b.push(`    }))`);
```

注意：即使 `matchingRenderers.length === 0`，`let final = html; ... final = renderer.wrap(...)` 循环也不会执行，`final` 就等于 `html` —— 所以不需要 `if/else`。当然，要确认零渲染器的循环体不会产生额外的空行注释。

**影响评估**: 消除分支重复，减少6行代码，生成的代码行为完全相同。

---

## 发现 6: `renderCorsOrigin` 中 `string` 和 `Array` 分支做同样的事

**位置**: `entry-renderer.ts:53-62`

```ts
function renderCorsOrigin(origin: CorsOriginConfig): string {
  if (typeof origin === 'string') return JSON.stringify(origin);
  if (Array.isArray(origin)) return JSON.stringify(origin);
  return origin.body;
}
```

**问题**: `string` 和 `Array` 两个分支都调用 `JSON.stringify(origin)`。`JSON.stringify` 对 string 和 array 都正确处理。只需检查是否是函数类型即可。

**建议**:

```ts
function renderCorsOrigin(origin: CorsOriginConfig): string {
  if (origin && typeof origin === 'object' && !Array.isArray(origin)) {
    return origin.body; // Function type
  }
  return JSON.stringify(origin);
}
```

或者更简洁：

```ts
function renderCorsOrigin(origin: CorsOriginConfig): string {
  if (typeof origin === 'object' && !Array.isArray(origin)) return origin.body;
  return JSON.stringify(origin);
}
```

**影响评估**: 减少 4 行，逻辑不变，测试不需要修改。

---

## 发现 7: `ssr-handler.ts` 的内联转义也引入了重复

**位置**: `ssr-handler.ts:31`

```ts
const message = error.message.replace(/</g, '&lt;').replace(/>/g, '&gt;');
// ...
const stack = error.stack ? error.stack.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
```

**问题**: 虽然没有 `escapeHtml` 那么长的 escape chain，但 `<` 和 `>` 的转义逻辑也与 `html-escape.ts` 重复。`ssr-handler.ts` 已经导入了 `wrapInDocument` 来自 `html-escape.ts`，但没有导入 `escapeHtml`。

**建议**: 导入并使用 `escapeHtml()`：

```ts
import { escapeHtml, wrapInDocument } from './html-escape.js';

export function renderSsrError(...): string {
  const message = escapeHtml(error.message);
  const stack = error.stack ? escapeHtml(error.stack) : '';
}
```

**影响评估**: 消除另一处逻辑重复，但这是 `ssr-handler.ts` 的重复，不是入口管线的问题——属于边界发现的额外简化点。

---

## 汇总

| # | 发现                        | 位置                       | 简化收益                   | 风险                       | 工作量   |
| - | --------------------------- | -------------------------- | -------------------------- | -------------------------- | -------- |
| 1 | `CodeBuilder` 多余抽象      | entry-renderer.ts          | 消除不必要的类抽象         | 低（纯机械替换）           | ~10 分钟 |
| 2 | `hono-entry.ts` 薄外观      | hono-entry.ts              | 减少 1 个文件 + 50 行      | 中（测试导入路径需要更新） | ~15 分钟 |
| 3 | 内联转义重复                | entry-renderer.ts L239     | 消除逻辑重复，缩小生成代码 | 低（需加 import）          | ~5 分钟  |
| 4 | `__ssr` 每次重构生成        | entry-renderer.ts L386-401 | 每入口减 ~200 字节         | 中（改动运行时依赖链）     | ~20 分钟 |
| 5 | `wrapInDocument` 分支重复   | entry-renderer.ts L209-228 | 消除 6 行重复代码          | 低                         | ~5 分钟  |
| 6 | `renderCorsOrigin` 分支合并 | entry-renderer.ts L53-62   | 减少 4 行                  | 低                         | ~3 分钟  |
| 7 | `ssr-handler.ts` 内联转义   | ssr-handler.ts             | 消除额外重复               | 低                         | ~3 分钟  |

**推荐优先级**: 1 → 6 → 3 → 5 → 2 → 7 → 4（从低风险高收益到中风险）

前四项（#1、#6、#3、#5）可以在 30 分钟内完成，零行为变化，测试全部通过。
