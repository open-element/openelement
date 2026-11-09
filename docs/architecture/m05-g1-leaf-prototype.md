---
status: historical
topic: M05 leaf-codegen prototype
summary: Prototype record, NOT G1; superseded by the M05a slice that landed generated leaf mount/update/dispose.
---

# M05 leaf-codegen prototype — status: PROTOTYPE, NOT G1

Date: 2026-11-06. Milestone: **Alpha16a M05 direction (leaf-codegen spike), Class P
prototype**. Baseline: `origin/main@460b1ec96`. Branch:
`alpha16a/m05-g1-leaf-slice`; PR #1709. Audited head: `f56327c24`; the Track A fix
commits land **above** that SHA, so the final evidence SHA is the PR head — see
[Evidence](#6-evidence).

Status: **PROTOTYPE — NOT G1 — SUPERSEDED HISTORY.** Per
[the execution plan](./alpha16-18-execution-plan.md) §0, a prototype never counts
as feature completion; M05 is Class I and depends on M03 (function-component
frontend) and M04 (runtime ownership), neither of which is implemented. This
record makes the prototype reviewable and bounds its claims; it records no gate.

Plan authority: scope follows the repository
[Alpha16–18 execution plan](./alpha16-18-execution-plan.md) (2026-11-03 fourth
pass), which is the authoritative stage definition. It does **not** advance the
Alpha16 v7.1 gates G1a/G1b: C-0 (compile-semantics ADR, #1652, v7.1 G1a) and C-3
(base codegen, #1655) remain OPEN. No taskbook gate is claimed or closed here.

## 0. Supersession (2026-11-09)

**SUPERSEDED by M05 v2 at `0ffc89263` (PR #1736, M05a).** The production
direction is now `packages/compiler/src/internal/compiler/semantic-ir/generated-leaf/generate.ts`:
it consumes the merged M03 `FunctionModelModule` + `ExpressionRegistry` (no
host-value stub, no reparse), emits concrete mount/update/dispose code against
the merged M04 runtime primitives (`createRecipe`/`insertRecipe`,
`bindSignalWrites`, canonical values helpers), and is exercised in a real
engine by `packages/compiler/__tests__/semantic-ir/generated-leaf.browser.test.ts`
(S1 slice; G1 **draft** evidence only, pending Lead compilation and owner
sign-off). This prototype record is kept as **history and mechanism evidence**:
it is not G1 evidence, not an M05 completion record, and no longer the
contract for generated code. The old prototype files/tests remain in the tree
until a later slice removes them with this supersession on record.

Why this slice supersedes it: the prototype stood in host-supplied `values` for
the missing expression frontend, had no ownership/projection model, no source
maps and only a DOM-stub consumer contract; M03 and M04 now provide the real
frontend and insertion surface, so the generated artifact uses them directly.

## 1. What this is — and what it is not

### 1.1 What this is

A **compiler-private spike**: `generateLeafRecipe` consumes one M02 `IrComponent`
and emits concrete DOM mount/update/dispose instructions, not a serialized program
for a generic interpreter. The generated artifact contains no `__partProgram`, no
JSON program and no walker that switches on node kind in the runtime.

| Property | Value |
| --- | --- |
| Location | `packages/compiler/src/internal/compiler/semantic-ir/leaf-codegen/` |
| Public surface | none — `semantic-ir` is excluded from the published compiler package (`packages/compiler/package.json` `files` negation `!src/internal/compiler/semantic-ir`) |
| Production use | none — no build or runtime path imports the generator; it is off by default |
| Entry point | `generateLeafRecipe(component)` → `{ recipe, diagnostics }`; `recipe` is `null` when any diagnostic is emitted |
| Artifact | `recipe.body` (executable in a `new Function` scope) and `recipe.module` (same declarations as an ESM module), plus `recipe.requiredValues` |
| Runtime | real browser DOM only: the generated code calls `document.createElement` / `createTextNode` / `appendChild` / `insertBefore` / `removeChild` / `nodeValue` |

### 1.2 What this is not

- **Not G1 evidence.** G1 is M05's exit evidence (execution plan §1, §8a Q1); this
  prototype cannot record it (see §7).
- **Not M05 completion.** M05 is Class I; its prerequisites (M03, M04) are
  unimplemented. This is a Class P prototype in the M05 direction.
- **Not a codegen contract.** It defines no ABI, no wire format and no frozen
  semantics; it consumes the M02 IR and is expected to be replaced by M05 v2.
- **Not the M03 expression frontend.** Expressions stay authored source slices and
  are evaluated in the generated scope; there is no lowering/erasure/identity
  pipeline, no resolver and no source maps.
- **Not a production path.** It is not wired into any compiler entry point and its
  output is not published.
- **Not a security-runtime implementation.** The protections here are compile-time
  name/tag denials; there is no value-level runtime sink guard, no trusted-HTML
  capability gate and no event wiring (§5).
- **Not M10a/M12/M13 qualification**, not claim/SSR, and not a performance claim.

## 2. Supported shapes

Everything in this table is generated. Any other **IR node, attribute or
expression shape** fails closed with a coded diagnostic (§3) — the admitted shape
is the whole of the prototype. The "not generated" items after the table are
outside the artifact entirely and are **not** diagnosed; they are explicitly not
claimed (§7).

| Shape | Generated behaviour |
| --- | --- |
| intrinsic host element (lowercase tag) | `document.createElement(tag)` and append; tag admitted only if it is a plain intrinsic name and is not in the canonical forbidden-tag list |
| fragment / multi-root component | children flattened and appended to the host in authored order |
| static text | `document.createTextNode(literal)` |
| dynamic text | text node written through the inline `__oe_display` coercion (`null`/`undefined` → empty string, otherwise `String(value)`); tracked reads are refreshed on `update`, snapshot reads are written when the node is created |
| static attribute | literal `setAttribute` after the canonical safe-attribute-name admission; a static URL-carrying name is additionally screened by the canonical stream-frame value predicate |
| dynamic `attribute` channel | e.g. `data-*`, `aria-*`, `for`, `tabindex`, `title`, `label` and other names the canonical classifier does not assign to another channel: `setAttribute(name, String(value))`; `null`/`undefined` removes the attribute |
| dynamic `boolean` channel | canonical boolean-attribute names (`readonly`, `disabled`, `checked`, `required`, …): presence semantics — truthy → `setAttribute(name, "")`, falsy → `removeAttribute(name)` |
| dynamic `property` channel | canonical DOM IDL property names (`value`, `readOnly`, `files`, …): `element[name] = value` |
| condition (one level) | anchor + branch rebuild when the test result changes; each branch carries its own refresh closure, so tracked text/attributes inside the active branch are refreshed by `update`; the test must be a tracked/computed/literal expression |
| dispose | removes the mounted nodes and condition anchors; idempotent; `update` after `dispose` is a no-op |

Notes:

- Attribute classification is shared with the production compiler: the canonical
  `BOOLEAN_ATTRIBUTES` / `DOM_PROPERTY_NAMES` tables and the classifier live in
  `packages/compiler/src/internal/compiler/semantic-core/attribute-classification.ts`,
  consumed by both `semantic-ir/build.ts` and `lower-program.ts`. The extraction
  keeps `lower-program.ts` output unchanged; the existing compiler tests are the
  regression gate.
- Only names in the canonical property table are treated as IDL properties. An
  authoring camelCase name outside that table (for example `className`) is treated
  as an attribute name, not silently as a DOM property.
- Static `class="…"` and static `style="…"` attributes are generated as literal
  `setAttribute` writes; only **dynamic** class/style values are refused (§3).
- The generated code expects a browser environment (`document`); the host supplies
  the parent node passed to `mount`.

## 3. Refused shapes (compile-time fail closed)

Every row returns `recipe === null` with a coded, spanned diagnostic. A forged IR
that bypasses the builder is refused by the same checks.

| Shape | Diagnostic |
| --- | --- |
| component reference, list, recipe/insertion, children projection, unknown node kind | `OEIR_LEAF_UNSUPPORTED_NODE` |
| nested condition inside a condition branch | `OEIR_LEAF_NESTED_CONDITION` |
| `event` / `ref` / `key` attribute channels | `OEIR_LEAF_UNSUPPORTED_ATTRIBUTE` |
| dynamic `class` / `style` values | `OEIR_LEAF_UNSUPPORTED_VALUE_SHAPE` |
| dynamic `innerHTML` (also static) | `OEIR_LEAF_UNSAFE_ATTRIBUTE` — the canonical forbidden name is checked before the value-shape rule |
| dynamic value for a canonical URL-carrying attribute (`href`, `src`, `action`, `formaction`, `xlink:href`) | `OEIR_LEAF_URL_SINK_UNSUPPORTED` — the value cannot be screened at compile time |
| unsafe attribute name — `on*` (case-insensitive), `innerHTML`, `srcdoc` — static or dynamic | `OEIR_LEAF_UNSAFE_ATTRIBUTE` |
| unsafe property name — `__proto__`, `constructor`, `prototype` | `OEIR_LEAF_UNSAFE_PROPERTY` |
| dangerous tag — `script`, `style`, `template`, `iframe`, `object`, `embed`, `base`, `meta`, `link` | `OEIR_LEAF_UNSAFE_TAG` |
| duplicate attribute name (case-insensitive) | `OEIR_LEAF_DUPLICATE_ATTRIBUTE` |
| unsafe static URL value (`javascript:`, `vbscript:`, `data:`, including entity/control-character obfuscation) | `OEIR_LEAF_UNSAFE_ATTRIBUTE` |
| malformed attribute name / non-intrinsic tag | `OEIR_LEAF_INVALID_ATTRIBUTE` / `OEIR_LEAF_INVALID_TAG` |
| TypeScript-only expression syntax: `as`, `satisfies`, `!`, type arguments/parameters, angle-bracket assertions, parameter/return type annotations, JSX in an expression | `OEIR_LEAF_TS_SYNTAX` |
| expression source that does not parse as exactly one expression, or statement injection | `OEIR_LEAF_INVALID_EXPRESSION` |
| empty expression; assignment, `++`/`--`, `await`, `yield` | `OEIR_LEAF_UNSAFE_EXPRESSION` |
| host binding name beginning with the generated `__oe_` prefix | `OEIR_LEAF_RESERVED_BINDING` |
| host binding name that is not a legal strict-mode JS binding | `OEIR_LEAF_INVALID_BINDING` |
| condition test read from a plain local (snapshot semantics) | `OEIR_LEAF_SNAPSHOT_CONDITION` |
| generated artifact fails the `new Function(body)` parse self-check | `OEIR_LEAF_INVALID_ARTIFACT` |
| component with no roots (empty output) | `OEIR_LEAF_EMPTY_OUTPUT` |

Not generated, and therefore not covered anywhere in this prototype:

- `IrResource` evaluation (signals, computed values, locals) — the producer's
  resources are not lowered; the host supplies every read value;
- event wiring and cleanup accounting; refs; list/recipe/ownership identity;
- claim markers, SSR/DSD, hydration and source maps;
- throwing cleanup / error containment: an exception thrown inside `mount` or
  `update` is neither contained nor paired with cleanup accounting;
- value-level runtime sink screening, trusted-HTML capability checks and
  runtime attribute coercion/mirror parity with the Alpha15 path.

## 4. Host values contract

The artifact is **not self-contained**. All expression values are supplied by the
host, because M03's expression frontend does not exist yet.

- `recipe.requiredValues: readonly string[]` lists every top-level binding the
  generated mount/update paths read (mount reads, render reads, condition tests and
  branch reads), deduplicated and sorted. `values` must be an object carrying every
  one of them.
- `mount(host, values)` and `update(nextValues)` validate at call time:
  - `values` that is not an object (or is `null`) throws
    `Error("OEIR_LEAF_INVALID_VALUES: …")`;
  - a missing required binding throws
    `Error("OEIR_LEAF_MISSING_VALUE: <name>")`.
  These are **runtime** errors raised by the generated code; they are not
  generation-time diagnostics, and `generateLeafRecipe` still returns a recipe.
- `mount` evaluates snapshot reads (including snapshot reads inside a condition
  branch, which are re-evaluated when that branch is rebuilt); `update`
  re-evaluates tracked reads. Nothing else is evaluated by the artifact.
- Signals, computed values and locals must be computed by the host before the
  call. There is no dependency tracking, no computed engine and no reactivity
  driver in the generated code or in the compiler.
- Example shape: `mount(host, { props: { ok: true }, label: 'ready' })` — the
  generated code destructures those top-level names from `values`.

M03 replaces this host-supplied contract with a real evaluation frontend; until
then the contract above is the whole of the prototype's data flow.

## 5. Security boundary

The prototype does not invent a second policy: it reuses the canonical deny lists
from `@openelement/protocol`.

| Canonical source | Used for |
| --- | --- |
| `forbidden-sinks.ts` — `FORBIDDEN_ATTRIBUTE_NAMES`, `FORBIDDEN_PROPERTY_NAMES`, `RAW_TEXT_TAGS`, `forbiddenSinkReason`, `isSafeAttributeName` | attribute-name admission, forbidden sink names, raw-text tags |
| `stream-frame-policy.ts` — `STREAM_FRAME_FORBIDDEN_TAGS`, `STREAM_FRAME_URL_ATTRIBUTES`, `unsafeStreamFrameAttribute` | static attribute/tag admission; static URL-value screening; the dynamic URL-carrying name denial |

What the boundary is:

- dangerous names/tags are refused **at compile time**; the recipe cannot be
  produced, so there is no generated code to execute;
- dynamic URL-carrying names from the canonical set are refused because their
  values cannot be screened ahead of time;
- static URL values are screened with the canonical stream-frame predicate
  (entity and control-character decoding included);
- the generated artifact imports nothing and does not depend on element runtime
  guards.

What the boundary is **not**:

- it is not a value-level runtime sink guard: the production
  `assertSafeUrlAttribute` path, the trusted-HTML capability gate for `innerHTML`
  and the event-handler wiring are not implemented or reused here;
- it does not cover URL-semantics attributes outside the canonical
  `STREAM_FRAME_URL_ATTRIBUTES` set (`poster`, `cite`, `data`, `background`, …):
  no value screening runs there, so this prototype must not be read as URL-scheme
  protection for those names;
- the expression parse check is a prototype guard for generated-code validity, not
  M03 erasure/parity; M03 and M04 remain prerequisites for a real security-parity
  claim.

## 6. Evidence

### 6.1 2026-11-06 audit at `f56327c24` (baseline prototype)

The first full audit of the branch ran on macOS with Node `v24.18.0` and the
pinned Playwright `1.59.1`. Commands and results:

| Evidence | Result |
| --- | --- |
| `env -u NODE_OPTIONS CI=1 node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir` | 88 tests: 84 passed + 4 browser skipped (pinned Chromium executable missing in the audit environment); slice unit file 19/19 |
| consumer smoke — `leaf-codegen.consumer.test.ts` | 1/1: `recipe.module` → npm tarball → clean directory `npm install --offline` → independent Node process imports the package and runs mount/update/dispose; tarball is exactly `package.json` + `dist/recipe.mjs`; no alias, no symlink |
| `env -u NODE_OPTIONS CI=1 OE_BROWSER_MATRIX=firefox node_modules/.bin/vitest run --project compiler packages/compiler/__tests__/semantic-ir/leaf-codegen.browser.test.ts` | Firefox-only 4/4 passed (7.18 s, exit 0) |
| browser cases replicated 1:1 against system Google Chrome `156.0.8078.80` | 23/23 assertions passed, exit 0 — the alternative evidence because the pinned Chromium build could not be downloaded in the audit window |
| `env -u NODE_OPTIONS node_modules/.bin/vp run --no-cache check` | 5/5 PASS: `fmt:check`, `lint`, `typecheck`, `@openelement/tools-repo#lint:markdown`, `@openelement/www#check:public-docs` |
| `--filter @openelement/www check:doc-claims` | pass (68 files, 46 known versions, 37 gates, 10 CI jobs) |
| `--filter @openelement/tools-repo shims:check` | pass (17 shims / 3 retired) |
| `--filter @openelement/tools-repo seams:check` | pass (49/49 rows) |
| `git diff --check` | clean |

Environment limits, stated so the record cannot be read as qualified:

- the **pinned Chromium** browser test was not independently re-run (browser cache
  mismatch during the audit); the system-Chrome replica above is the substitute,
  not an engine qualification;
- **WebKit 4/4** is the author's local claim; the pinned Playwright WebKit build
  was unavailable during the audit and the claim is unreproduced here;
- three engines are not a G1 requirement anyway — three-engine qualification is
  M13 (execution plan §1, ADR-0174), so neither the Firefox result nor the
  missing WebKit reproduction is a G1 gap.

These numbers describe the **audited baseline** `f56327c24`. The Track A fix
commits (claim correction, compile-time sink denial, shared attribute
classification, artifact hygiene / expression validation / host-values checks)
land above it, change the test counts, and are evidenced by the PR-head run; the
final SHA and counts are recorded in PR #1709.

### 6.2 What the evidence supports

- mechanism: on the supported shapes, generated mount/update/dispose code really
  executes in a real DOM; conditions switch, branch-local refreshes survive a
  swap, and dispose empties the host;
- packaging: the generated module can be packed and consumed from an independent
  Node process without aliases (M10a-shaped early smoke of a smaller artifact only
  — not M10a/M12 qualification);
- claims: the audit explicitly did **not** find evidence for G1, M05, security
  parity, M03/M04 or S1 coverage, and this record claims none of them.

## 7. Not claimed

This prototype does not claim, and must not be cited for:

- **G1** — M05 exit evidence (browser execution recorded at a qualifying SHA) or
  G1a/G1b from the Alpha16 v7.1 taskbook;
- **M05 completion** — Class I delivery, or that M03/M04 prerequisites are met;
- **S1 coverage** — single/multi root, fragment and dispose exist, but empty
  output, signal+computed and throwing cleanup do not; S1's evidence bar is not
  met;
- **M03** — expression frontend, lowering, erasure, identity, scope resolution,
  source maps;
- **M04 / G2** — runtime ownership, recipe primitives, insertion identity;
- **security parity / R6** — canonical runtime sink guard, trusted-HTML capability,
  event wiring/cleanup, and sink fixtures for every future expression position
  (only compile-time name/tag denials exist);
- **R7 / G1a contract freeze** — #1652 and #1655 remain OPEN; no contract is
  frozen;
- **M10a qualification** — the consumer test is an early smoke of a small
  standalone artifact under Node with a stub DOM, not M10a or M12;
- **M12 / S3** — packed stateful list, claim/SSR, mismatch recovery;
- **M13** — three-engine browser + server qualification at an exact SHA;
- **claim/SSR**, source maps, hydration, packed-consumer browser execution, a
  published artifact, and any byte-budget or performance claim.

## 8. Next steps

The M05 dependency spine is unchanged (execution plan §1, §3):

1. **M03** — function-component frontend (lowering/erasure/identity/scope,
   source maps), then **M04** — runtime ownership and recipe primitives;
2. **M05 v2** — generated leaf mount/update/dispose on top of M03/M04, with the
   canonical coercion single source and generated expression evaluation replacing
   the host-supplied `values` contract;
3. **claim/SSR** — M07 leaf claim, then M08 claim + SSR for the stateful list;
4. **G1/G2 evidence ledger** — phase-specific rows at a recorded SHA, including
   browser and packed-consumer runs (execution plan §11), plus S1's remaining
   items;
5. **R6** — sink fixtures per new expression position and one sink source of truth
   before any G1 counting.

Work is tracked under #1655 (C-3 base codegen); the related contract decision is
#1652 (C-0 compile-semantics ADR, v7.1 G1a). Both stay OPEN; this PR closes
neither.

Remaining prototype debt recorded by the audit and not fixed in this slice:
runtime value-level URL/sink screening, runtime attribute coercion/mirror parity,
cleanup accounting, event wiring, and `</script>` escaping for a future
SSR/claim inline path (the current consumption paths do not inline into script
tags).

## 9. Decision

Record the slice as a **compiler-private Class P prototype in the M05 direction**
and keep it off every production path. It is useful as mechanism evidence
(mount/update/dispose + condition + attribute channels on real DOM) and as a
packageability smoke; it is not a gate record. The next M05 record supersedes it
once M03/M04 land.
