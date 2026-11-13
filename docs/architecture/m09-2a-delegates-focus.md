---
status: active
topic: M09-2a generated-element delegatesFocus authoring
summary: The island sidecar's `delegatesFocus` key is accepted by the static scan and re-read by the compiler lane, reaches the descriptor and the DSD template's typed option set, and is guarded by the shared two-parser drift guard; a bounded slice record, not the M09 exit.
---

# M09-2a: authoring `delegatesFocus` on a generated element

Date: 2026-11-14. Status: **bounded implemented — not the M09 exit.**
Baseline: canonical `main@7632ab36c` (worktree
`.artifacts/canonical-20261113/worktree`).

This slice closes `D-delegatesFocus`: the generated native Custom Element had
full runtime support for the native focus-delegation fact (the shell passes it
to `attachShadow`, compares it against an adopted DSD root, and fails closed on
a mismatch), but an island author had **no spelling** for it. The class lane
had `@element(tag, { delegatesFocus })`; the function island sidecar did not
publish the field, the static island scan rejected it, and the descriptor
always omitted it. The parity table in
`m09-2-design.md` (the outer proposal, not authority) recorded that hole as
D-delegatesFocus.

## The decision

**Expose the existing `@element` vocabulary on the sidecar, and read it from
the same authored statement as `root`.** The field is one optional boolean:
`delegatesFocus?: boolean`, meaningful only with `root: 'shadow'`. There is no
second helper, no per-element root syntax and no new descriptor vocabulary: the
shell's `delegatesFocus` descriptor fact, the DSD option set and the
`@element` option name were already landed and unchanged.

The fact source is the sidecar statement, not the host site fact. That is the
D-root-source ruling (2026-11-13) applied to the second platform fact: the
compiler lane re-reads the authored AST, so a stale host scan cannot pin a
focus fact the source no longer declares, and the host site fact keeps carrying
the tag only. The cost is the same recorded cost as `root` — two readers of
one sidecar — paid by one shared drift guard rather than a second mechanism.

`delegatesFocus: true` **requires `root: 'shadow'`**, and is refused rather
than silently ignored. The default root of the generated path is `light` (the
shell's `descriptor.root ?? 'light'`), and a light root has no shadow boundary
to delegate focus through; the shell already refuses the descriptor pair at
class creation time. The authoring surface, the static scan and the compiler
lane all enforce the same invariant, so an admitted module can never reach the
shell with the pair.

## What changed

| Path | Role |
| --- | --- |
| [`authoring.ts`](../../packages/router/src/authoring.ts) | `IslandConfig.delegatesFocus?: boolean`, the accepted-field set, runtime validation (boolean; `true` requires `root: 'shadow'`) and the authoring error text. |
| [`island-scanner.ts`](../../packages/router/src/vite/internal/ssg/island-scanner.ts) | Accepts the key in `parseStaticIslandConfig` with the same boolean-literal rule as `ssr`/`dsd`, carries it on `LocalIslandMeta` and copies it into the scanned metadata; advertises it in the accepted-shape message; refuses `true` without `root: 'shadow'`. The scanner stays the build-time authority for the accepted shape and error text. |
| [`contract.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/contract.ts) | The internal diagnostic codes `OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_INVALID` and `OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_WITHOUT_SHADOW`; the descriptor-ABI note. Neither enters the public `RuntimeErrorCode` catalogue or the interface snapshot. |
| [`site.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/site.ts) | `readIslandMetadata` reads `root` and `delegatesFocus` in ONE walk and fails closed on anything it cannot prove from literal text; `readIslandRoot` stays as the one-fact projection for root-only callers (no second parse). The admission carries `delegatesFocus`. |
| [`emit.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/emit.ts) | The descriptor gains `delegatesFocus: true` only for a true fact, and the appended `<Name>__ssrHost` passes `dsd: { delegatesFocus: true }` so the parser-adopted DSD root carries `shadowrootdelegatesfocus`. The light tail and a focus-free shadow tail keep their previous bytes. |
| [`compile.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/compile.ts) | Passes the lane-read fact to the emitter (omitted when false). |
| [`generated-element.delegates-focus.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.delegates-focus.test.ts) | The compiler-side reader, refusal, admission, descriptor and host-wrapper contract (Node). |
| [`generated-element.delegates-focus.browser.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.delegates-focus.browser.test.ts) | The authored vertical in real Chromium (below). |
| [`island-metadata-drift-guard.test.ts`](../../packages/router/__tests__/island-metadata-drift-guard.test.ts) | The shared P8 consumer-form drift guard, renamed and extended from the root-only one; `delegatesFocus` cases joined the same corpus. |
| [`island-scanner.test.ts`](../../packages/router/__tests__/island-scanner.test.ts) / [`authoring.test.ts`](../../packages/router/__tests__/authoring.test.ts) | The scan acceptance/refusal/error-text expectations and the runtime-validation classification. |

## The DSD threading is load-bearing

A shadow island's `delegatesFocus` reaches the browser through two different
writers, and they must agree or the shell fails closed (by design):

- the **client-created** root passes the descriptor fact to
  `attachShadow({ delegatesFocus })`;
- the **parser-adopted** declarative root takes the fact from the template
  attribute `shadowrootdelegatesfocus`, which only exists when the emitted
  `<Name>__ssrHost` threads the typed `dsd` option into
  `serializeShadowTemplate`.

The browser vertical pins the positive chain (template attribute → adopted
root reports `delegatesFocus: true` → claim works → `host.focus()` reaches the
shadow input) **and** the negative control that proves the threading is not
cosmetic: a host template built WITHOUT the option, claimed by a descriptor
that pins `delegatesFocus: true`, is refused with
`OEIR_SHELL_ROOT_OPTION_MISMATCH` ("delegatesFocus mismatch") instead of
silently losing delegation.

## Fact flow

```
author: defineIslandConfig({ root: 'shadow', delegatesFocus: true })
   │
   ├─ runtime validation (authoring.ts): boolean; true needs root 'shadow'
   ├─ build-time authority: island-scanner.ts readIslandConfig → LocalIslandMeta
   │     (ISLAND_METADATA_ERROR on a non-literal value or a light/absent root)
   └─ compiler lane (D-delegatesFocus): site.ts readIslandMetadata over the AST
         root 'shadow' → descriptor 'shadow-open'; delegatesFocus true
         absent/false → descriptor property omitted (shell default false)
         unreadable → OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_INVALID
         true + non-shadow → OEIR_GENERATED_ELEMENT_DELEGATES_FOCUS_WITHOUT_SHADOW
   │
   ▼
descriptor { tag, root?, delegatesFocus?, properties: [], createRecipe }
   + emitted <Name>__ssrHost → serializeGeneratedElementHtml({ dsd: { delegatesFocus: true } })
   ▼
shell: normalizeDescriptor → resolveGeneratedElementRoot / DSD adoption → claim
```

## Evidence (LOCAL)

Focused (all green):

- `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.delegates-focus.test.ts`
  — 1 file, 16 tests.
- `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.delegates-focus.browser.test.ts`
  — 1 file, 4 tests, real Chromium (the vertical and the mismatch control).
- `./node_modules/.bin/vitest run --project router packages/router/__tests__/island-scanner.test.ts packages/router/__tests__/island-metadata-drift-guard.test.ts packages/router/__tests__/authoring.test.ts`
  — 3 files, 44 tests.
- `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.root-source.test.ts packages/compiler/__tests__/semantic-ir/generated-element.emitter.test.ts`
  — 2 files, 30 tests (the converted root guard and the append-only emitter guard).

Red→green: the focused Node suites were run against `HEAD`'s lane source (the
new tests present, the implementation reverted byte-for-byte in the same
worktree) and failed on the missing field/keys; the same files are green with
the implementation restored. The exact commands and failure summaries are in
the slice report; a guard that cannot fail is not evidence.

Static gates: see the report for the full list (`tsc` projects, `vp run check`,
`interface:snapshot`, `seams:check`, `docs-index:check`). The interface snapshot
moves on `IslandConfig` / `defineIslandConfig` and is regenerated by
`interface:snapshot:write`, never hand-edited; `docs/architecture/README.md` is
regenerated by `docs-index:write`.

## What this slice does NOT do

- **No production wiring.** The router still passes no production site fact and
  M11 owns request-time DSD/SSR wiring; this slice proves the authoring-to-claim
  chain locally.
- **No properties in this commit.** Property metadata is the second, separate
  commit: [`m09-2b-primitive-properties.md`](./m09-2b-primitive-properties.md)
  (`D-props`).
- **No forms, events, styles, CEM.** Unchanged by this slice.
- **No class-lane change.** `@element(tag, { delegatesFocus })` keeps its
  existing path and vocabulary; the new sidecar field mirrors it.
- **No closed roots.** `root: 'shadow'` maps to `shadow-open`; `shadow-closed`
  has no author spelling (`D-closed`).
- **No new public runtime error code.** The refusal codes are internal
  `OEIR_GENERATED_ELEMENT_*` values, absent from the public catalogue.
- **One Chromium engine, LOCAL.** Not M09 exit, not the M13 matrix.
