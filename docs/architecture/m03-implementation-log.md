# M03 implementation log

Date: 2026-11-09. Milestone: **Alpha16a M03-I (function-component frontend)**.
Status: **Complete** for the M03 exit definition; this log is the consolidated
evidence record. The [progress ledger](./alpha16-18-progress.md) keeps the
summary and links here; the design authority remains
[M03-A](./m03-scope-resolution.md), [M03-B](./m03-expression-identity.md) and
[M03-I-0](./m03-i0-sourcemap-prototype.md).

This is an **internal Alpha16a milestone record**: it is not a release, not a
version, not a tag, not a public API freeze and not an ABI. The class frontend
remains the Alpha16a default production path and the regression baseline until
the Alpha16b retirement; the function frontend is a compiler-private parallel
entry with no class adapter (approved P-5).

## Exit definition applied

Execution plan §1: *the function-component frontend with diagnostics / Source
Map / security parity with the Alpha15 class frontend baseline*. "Parity" is
recorded at the frontend boundary: expression-level source-map segments, not an
end-to-end generated-module map (M05), and admission/security diagnostics, not
browser behaviour (M05/M13).

## Slices and evidence

All counts are LOCAL runs; the exact PR-head CI state is recorded in each PR
body. Evidence is per head: the SHA below is where the counts were produced.

### A1 — M03-I-1 lexical scope resolver (PR #1730)

- Squash on main: `39cac9548`; evidence-tree head `a1cd53b7d`; original PR head
  `11163a7aa` (rebase-merge era, kept for traceability).
- `packages/compiler/src/internal/compiler/semantic-core/scope-resolution.ts`:
  BindingId/ScopeId split from classification, §3 merge table, §4 lexical
  semantics (hoisting, block functions, catch/for/switch, class outer+inner,
  named expressions, heritage in enclosing scope), §4.1 TDZ provable bound,
  §5 reads/captures/dependencies/mode, §6 host ImportClassifier chain.
- Tests: M03-A §10 matrix + capture/dependency invariants (70) + a differential
  resolver-vs-TypeScript oracle (9) over a virtual `noResolve`/`noLib` program.
- Evidence at `a1cd53b7d`: `npx vitest run --project compiler` → 24 files /
  411 tests passed (332 pre-existing + 79 new); CI green at the PR head.

### A2 — M03-I-2 expression lowering + ExpressionRegistry (PR #1731)

- Squash on main: `d59bc770f`; original PR heads `f99b538a4` (code) /
  `12adab13a` (final).
- `semantic-core/expression-lowering.ts`: Route 3 marked print, JSX→caller-
  supplied recipe-reference substitution at the authored position, node-start
  anchors, prefix-sum/binary-search marker stripping, boundary trimming,
  deepest-wins segments in the shared `EmissionSegment` convention, codegen
  rebase, dispose + synthetic-comment snapshot restore.
- `semantic-core/expression-registry.ts`: per-compilation sidecar keyed by
  deterministic ExprIds, plain-data records (lowered text, authored span, mode,
  A1 reads/captures/dependencies, unresolved reads, anchors, segments,
  typescriptVersion + transformerVersion), no global state/wire/AST retention.
- Tests: 56 over the M03-B §9 edges, disposal/data-only registry, Source Map v3
  round-trip, and A1 integration (JSX-interior reads move to the recipe record).
- Evidence at `f99b538a4`: `npx vitest run --project compiler` → 25 files /
  467 tests passed (411 pre-existing + 56 new); CI green at the final PR head.

### A3 — M03-I-3 erasure + differential oracle + context matrix (PR #1732)

- Squash on main: `1423ad18c`; original PR heads `318685399` / `1606d020b`.
- `semantic-core/type-erasure.ts`: admitted erasure set (`as`/`satisfies`/
  non-null/type assertions/instantiation expressions → inner expression; call/new
  type arguments; function-like annotations incl. `this` parameters and nested
  declarations; variable/catch annotations). Outside the set fails closed
  (`OEIR_ERASURE_UNSUPPORTED` for class authoring, type-only declarations and
  `declare`). Integrated into the A2 transform (one traversal/print).
- Differential oracle: Route 2 `ts.transpileModule` compared on normalized AST
  shape over 19 erasure-only entries; mechanism purity proven twice (runtime
  mock of the `typescript` default and a static source scan: production never
  calls `transpileModule`/`createProgram`; Route 1 not pre-authorized).
- Context matrix: `this`/`arguments`/`super`/`new.target`/`await`/`yield`/`eval`
  refused with design-named source-located codes.
- A1 follow-up: a type-parameter declaration name is not a value read (needed by
  generic-arrow erasure), regression-tested.
- Evidence at `318685399`: `npx vitest run --project compiler` → 28 files /
  535 tests passed (467 pre-existing + 68 new); CI green at the final PR head.

### A4a — M03-I-4a production function frontend + diagnostics parity (PR #1733)

- Squash on main: `fa752e79c`; original PR head `6be9979d5`.
- `semantic-core/function-frontend.ts`: compiler-private **parallel entry**
  (not exported; no class-frontend wrapping; no Part Program/`__partProgram`/
  ABI/generated module). Discovers multiple function components, builds the
  M05/M06 model (props incl. destructured snapshots, A1-classified resources,
  recipes, JSX node tree with ExprId+mode dynamic slots), lowers every dynamic
  slot through A2/A3 (`setup`/`derived`/`inline`/`per-entry`/`handler`/`key`),
  returns the expression sidecar. Security admission reuses the canonical
  predicates (`forbiddenSinkReason` with the class core's screening order,
  `isSafeAttributeName`, `classifyIntrinsicAttribute`) — no second sink table.
  Diagnostics in the OEC dialect: new `OEC9040` shape, `OEC9041` statement,
  `OEC9042` form, `OEC9043` (wraps the private `OEIR_*` refusal, code kept in
  the message), `OEC9044` dynamic-innerHTML refusal; `OEC9010`/`OEC9011` reused
  verbatim for parity.
- Alpha15 diagnostics parity harness: shared security constructs compared
  class-vs-function on OEC code + offending authored token (different module
  shapes make absolute offsets incomparable; field dialect is compared), C+
  parity, T+/T− recorded from the TypeScript authority (the frontend is not a
  checker — approved), asserted/NOT-asserted list in the test file.
- Evidence at `6be9979d5`: `npx vitest run --project compiler` → 29 files /
  562 tests passed (535 pre-existing + 27 new); CI green at the final PR head.

### A4b — M03-I-4b exit evidence: source-map/security parity + matrix (PR #1734)

- Code/evidence head: `5cfd2fc80` (squash SHA pinned by the next slice).
- Expression-level source-map parity (`@jridgewell/trace-mapping@0.3.31`, the
  repository's established consumer, added as a pinned compiler devDependency):
  plain expressions (every segment round-trips to its authored line/column),
  erasure shrink, JSX→recipe-ref substitution (an offset inside the longer
  replacement resolves to the authored JSX start — anchors, never
  interpolation), multi-line generated positions, and the Alpha15 class map
  convention (same consumer, one authored source, 1-based line / 0-based
  column; the class Part-level map resolves the authored render region while the
  function frontend adds expression-level anchors — documented difference). The
  end-to-end generated-module map remains M05.
- Full per-position security parity matrix: negative fixtures for every newly
  admitted expression position (direct element attribute, condition branch,
  list template, JSX-in-expression recipe target) reusing the canonical deny
  lists; class-vs-function parity on OEC code + offending token where an
  equivalent class construct exists, `n/a (no equivalent construct)` + predicate
  denial recorded where it does not. Positive positions (events, component
  props) are not sinks. Static proof that the frontend holds no second sink
  table.
- Dynamic `innerHTML` decision: the class baseline requires its class-authoring
  trusted-HTML contract (Object-typed `TrustedHtml` property + literal
  capability marker); the function model has no equivalent capability channel,
  so the conservative `OEC9044` refusal stays. Proposed rule for owner
  sign-off: function components refuse dynamic `innerHTML` until a trusted-HTML
  contract with a named consumer ships and a negative fixture exists; no sink
  widening before that.
- Semantic-test-matrix rows: T+/T− recorded from the TypeScript authority and
  C+/C− from the frontend for the M03-scope cases (TSX-01/02/03/05/06/08/09/10/
  12/16/22); no browser/claim/codegen cell is filled (M05+).
- Fail-closed correction found by the matrix: a condition branch that is
  neither JSX nor null now fails (`OEC9042`) instead of being silently dropped.
- Evidence at `5cfd2fc80`: `npx vitest run --project compiler` → 32 files /
  590 tests passed (562 pre-existing + 28 new); `pnpm check` PASS;
  `pnpm install --frozen-lockfile --lockfile-only --ignore-scripts` PASS.
  PR-head CI is recorded in the PR body.

## M03 exit record

**Met**, on the evidence above: diagnostics parity (A4a), expression-level
Source Map parity (A4b), security parity (A4b), and the semantic-test-matrix
M03-scope T+/T−/C+/C− rows. Prototypes (M02 spike, M03-I-0, M05 leaf prototype)
are not counted as this evidence.

## Explicitly not claimed

- No G1/G2 record; no browser matrix or M13 qualification.
- No codegen, runtime execution, SSR/claim or generated-module behaviour.
- No end-to-end generated-module Source Map (M05 owns it).
- No Alpha16a exit (M04–M08 + G1/G2 remain); no class retirement (Alpha16b).
- No public API freeze, no ABI, no Part Program v2 and no `__partProgram` in the
  target path; the class frontend remains the default production path.
- The private `OEIR_*` diagnostics remain compiler-internal; `OEC9040`–`OEC9044`
  are provisional/internal. A later consolidation/rename pass is required before
  any public error-reference claim (named follow-up for A4 wiring).
