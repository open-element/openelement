---
status: active
topic: M09-2a sidecar root source
summary: The island sidecar's documented `root` key is accepted by the static scan and re-read by the compiler lane (D-root-source), with a two-parser drift guard; a bounded slice record, not the M09 exit.
---

# M09-2a: the island sidecar root source

Date: 2026-11-13. Status: **bounded implemented — not the M09 exit.**
Baseline: `origin/main@48e81b9ca`.

This is the first half of the M09-2a record: where the root fact comes from.
The second half — what the fact is for (the authored shadow island end to end,
the host-level DSD producer and the R7 shadow-including ancestor walk) — is
[`m09-2a-shadow-authoring.md`](./m09-2a-shadow-authoring.md).

The owner ruling this slice implements is **D-root-source = the compiler lane
re-reads the authored sidecar** instead of receiving the root on the host site
fact. The bug it repairs and the ruling are one change: the sidecar accepted
`root` at runtime while the static scanner rejected it, and the fact's source
had to be decided at the same time.

## The defect

The same authored sidecar carried two disagreeing accepted-key sets:

| Reader | `root` behavior before this slice |
| --- | --- |
| `packages/router/src/authoring.ts` `ISLAND_CONFIG_FIELDS` and the runtime validation (`root` must be `'light' \| 'shadow'`) | **accepted** — the field is published `IslandConfig` surface |
| `packages/router/src/vite/internal/ssg/island-scanner.ts` static key list | **rejected** — `unsupported openElement metadata key "root"` |

The public JSDoc on `IslandConfig.root` told the author to declare the island's
root next to its delivery policy, so the documented contract and the build
disagreed: a source that passed module evaluation failed the island scan. No
in-tree fixture wrote `root` inside `defineIslandConfig`, so the disagreement
was latent, but it was documented authoring surface (P6: one truth, two
readers).

## The ruling and its cost

**D-root-source (2026-11-13): the compiler lane reads `root` from the authored
sidecar AST itself.** The host site fact keeps the tag only. The rationale is
freshness and ownership: the root is an authoring declaration, and a root that
rides a host fact is only as fresh as the host's scan (a dev/HMR rebuild can
hand the transform a fact the source no longer declares), while the compiler
already holds the authored AST.

The cost is accepted and recorded: **two implementations now read one sidecar**
— the router scanner validates it and names the author-facing error, the
compiler lane extracts the root. The earlier design recommendation
(`m09-2-design.md` §2.3) had chosen the opposite source, the host site fact; the
owner ruled for the compiler read and this slice records that cost instead of
hiding it. Design principle P8 makes the cost payable, and this slice pays it
explicitly:

1. **the scanner stays the authority** for the sidecar's accepted shape, its
   accepted key set and its error text (`ISLAND_METADATA_ERROR`, including the
   `Accepted shape:` line that now advertises `root?: "light" | "shadow"`);
2. **the compiler reads only the keys it needs and fails closed** on anything
   non-literal. `readIslandRoot` is deliberately narrower than the scanner: it
   understands `root` alone, and a value it cannot prove from the literal text
   is a coded, source-located refusal
   (`OEIR_GENERATED_ELEMENT_ROOT_INVALID`), never a guess. It refuses a dynamic
   value, another literal, a duplicate `root`, a shorthand, a spread and a
   computed key — the shapes whose root fact cannot be established statically;
3. **a consumer-form drift guard** compares the two readers over one fixture
   corpus (below).

## What changed

| Path | Role |
| --- | --- |
| [`island-scanner.ts`](../../packages/router/src/vite/internal/ssg/island-scanner.ts) | Accepts `root` in the static key list, validates it with the same static-literal rule as `ssr`/`dsd` (`'light' \| 'shadow'`), adds it to `LocalIslandMeta`/`StaticIslandConfig`, copies it into the scanned metadata with the `undefined`-omission style `media` uses, and advertises it in the accepted-shape message. |
| [`site.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/site.ts) | New `readIslandRoot(sourceFile)`: `{ kind: 'absent' }`, `{ kind: 'root', root }` or `{ kind: 'refused', diagnostic }`. The one locator for the sidecar statement is shared with `hasIslandPolicyStatement`, whose behavior is unchanged. The admission carries `root` beside `componentName`/`propsParameter`/`defaultExportSpan`. |
| [`contract.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/contract.ts) | `GeneratedElementSite` loses `root` (the host fact carries the tag only) and the new internal `OEIR_GENERATED_ELEMENT_ROOT_INVALID` code is declared. Neither enters the public `RuntimeErrorCode` catalogue or the interface snapshot. |
| [`emit.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/emit.ts) / [`compile.ts`](../../packages/compiler/src/internal/compiler/semantic-ir/generated-element/compile.ts) | The descriptor's `root` is the lane-read admission value; an absent root **omits the property** so the shell's own `descriptor.root ?? 'light'` stays the single default owner. |
| [`generated-element.root-source.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.root-source.test.ts) | The compiler-side reader and lane contract (Node). |
| [`island-metadata-drift-guard.test.ts`](../../packages/router/__tests__/island-metadata-drift-guard.test.ts) | The P8 consumer-form drift guard (below). |
| [`island-scanner.test.ts`](../../packages/router/__tests__/island-scanner.test.ts) | The scanner's own acceptance/refusal/error-text expectations for `root`. |

The author-facing vocabulary and the descriptor vocabulary differ by design:
`'light'` maps to `light`, and `'shadow'` — the DSD default — maps to
`shadow-open`. Nothing maps to `shadow-closed`: closed roots have no author
spelling in this slice (`D-closed`).

### The two-parser drift guard

`packages/router/__tests__/island-metadata-drift-guard.test.ts` runs the router
scanner's static parse (`readIslandConfig`) and the compiler's `readIslandRoot`
over one corpus with the four classes the ruling names — light, shadow, absent,
invalid — and asserts they agree on every entry:

- an admissible sidecar reads the same root on both sides
  (`'light' | 'shadow'` ↔ `'light' | 'shadow-open'`);
- an undeclared root is undeclared on both sides, whether the sidecar is empty,
  root-less or absent entirely;
- a sidecar one reader rejects is rejected by both — never read by one and
  refused by the other, which is the drift direction that would otherwise ship
  a descriptor the scanner never validated.

The corpus is also asserted to keep covering all four classes, so a shrinking
fixture list cannot turn the guard into a vacuous pass. (The
`delegatesFocus` commit extended the same guard to that fact rather than
standing up a second guard; see
[`m09-2a-delegates-focus.md`](./m09-2a-delegates-focus.md).) A partial agreement is
the failure the guard exists to catch.

Negative proofs (run in this slice, then reverted): flipping the compiler's
`'shadow'` mapping to `shadow-closed` reds the guard; making the compiler
accept a dynamic value as `light` reds it too. Only a guard that can fail is
evidence.

Two limits are stated rather than hidden: the corpus uses the canonical
`defineIslandConfig({...})` form, because a non-canonical callee is rejected by
the scanner before any root exists and such a file is never admitted to the
lane; and the compiler reader checks the root key only — every other key keeps
the scanner as its single validator.

## Fact flow

```
author: export const openElement = defineIslandConfig({ root: 'shadow', ... })
   │
   ├─ build-time authority: island-scanner.ts readIslandConfig → LocalIslandMeta.root
   │     ('light' | 'shadow'; ISLAND_METADATA_ERROR on anything else)
   │
   └─ compiler lane (D-root-source): site.ts readIslandRoot over the authored AST
         'light' → descriptor root 'light'
         'shadow' → descriptor root 'shadow-open'   (the DSD default)
         absent  → descriptor root omitted → shell applies 'light'
         unreadable → OEIR_GENERATED_ELEMENT_ROOT_INVALID, no module emitted
   │
   ▼
descriptor { tag, root?, properties: [], createRecipe } → shell normalizeDescriptor
   → root.ts resolves the root once per element
```

## What this slice does NOT do

- **No `delegatesFocus`.** The sidecar does not gain the field, the scanner does
  not accept it, and the descriptor does not carry it. It is a separate owner
  decision (`D-delegatesFocus`) with its own public-surface cost.
- **No `properties` and no `formValue`.** At this slice's baseline the
  descriptor always emitted `properties: []`; the property declaration landed
  in the later [`m09-2b-primitive-properties.md`](./m09-2b-primitive-properties.md)
  commit, and the form-value convention stays a separate slice (`D-forms`).
- **Closed roots stay unopened.** No `shadow-closed` mapping, no author
  spelling, no discovery channel work (`D-closed` unchanged).
- **Not an M09 exit, not M09-1b.** No registration, packaging, export subpath,
  public-interface snapshot move or version claim. `GeneratedElementSite` is
  internal ABI and loses a field rather than gaining public surface. The router
  still passes no production site fact, so the lane stays inert in a real build.
- **No manifest, SSG or style change.** The client entry never needed the root
  (the descriptor carries it) and the SSG already reads `LocalIslandMeta`; the
  request-time manifest question stays M11.
- **No progress-ledger row.** This slice records itself here only; the M09
  ledger row is not touched by this change.

## Evidence (LOCAL)

Focused (all green):

- `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.root-source.test.ts packages/compiler/__tests__/semantic-ir/generated-element.emitter.test.ts`
  — 2 files, 30 tests.
- `./node_modules/.bin/vitest run --project router packages/router/__tests__/island-root-drift-guard.test.ts packages/router/__tests__/island-scanner.test.ts`
  — 2 files, 14 tests.
- `./node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/generated-element.class.browser.test.ts`
  — 7 tests (the converted shadow-sidecar Chromium evidence).

Full projects (all green):

- `./node_modules/.bin/vitest run --project compiler` — 65 files, 1025 tests.
- `./node_modules/.bin/vitest run --project router` — 143 files, 1627 tests.
- `./node_modules/.bin/vitest run --project element` — 118 files, 883 tests.

Static gates (all green):

- `./node_modules/.bin/tsc --noEmit -p packages/compiler/tsconfig.json` and
  `-p packages/router/tsconfig.json` — no diagnostics.
- `./node_modules/.bin/oxfmt --check` and `./node_modules/.bin/oxlint` on every
  changed file — formatted, 0 warnings / 0 errors.
- `pnpm run check` — `gate ok: 5 step(s)` (fmt:check, lint over 1332 files,
  the 6-package typecheck, markdownlint over 185 files, public docs).
- `pnpm run --filter @openelement/tools-repo seams:check` — 55 rows / 55
  explicit, this row included.
- `pnpm run --filter @openelement/tools-repo docs-index:check` — 28 active
  documents; `README.md` was regenerated by `docs-index:write`, never hand-edited.
- `pnpm run --filter @openelement/tools-repo interface:snapshot` — public
  interface snapshot matches (6 packages); it does not move, as required.

One existing M09-1a expectation was **converted, not weakened**: the emitter
test that asserted the descriptor root came from the site fact now passes the
lane-read root through the emitter's option, and the browser shadow evidence
declares `root: 'shadow'` in its sidecar where an author would. Both changes
are the new contract, and the old assertions were replaced by stronger ones
(the omitted-root default and the shadow mapping are asserted separately).

Evidence is one Chromium engine (the compiler project's browser suites are in
the full run) plus the focused Node suites; this is a bounded slice record, not
M09 qualification and not the M13 browser matrix.
