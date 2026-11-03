# M03-B — Expression identity

Date: 2026-11-03. Milestone: **Alpha16a M03-B (design only)**. Base:
`017bd3e8775e8d74fc8778b6321bbbe5d74486c6` (M02 merged).

Status: **DESIGN PROPOSAL — NOT IMPLEMENTED.** No codegen, no runtime, no ABI, no
public API. Claims are marked *read from source*, *measured*, or *hypothesis*.

## 1. The problem

M02 stores an expression as a **source slice plus metadata**:

```ts
// M02 semantic-ir/types.ts
interface IrExpression {
  readonly kind: 'literal' | 'local' | 'computed' | 'tracked' | 'handler' | 'key';
  readonly source: string;   // authored slice, e.g. "props.items.filter(i => i.active)"
  readonly span: IrSpan;
  readonly reads: readonly IrRead[];
}
```

That was deliberate: it proved the IR does not need an AST copy. But it leaves
codegen with an impossible choice:

1. **Re-parse `source`** to emit JavaScript → violates "no reparse" and would
   recreate a JavaScript parser inside the backend.
2. **Embed `source` verbatim** → emits TypeScript-only syntax that will not run
   (`as`, `!`, generics, `satisfies`, type arguments), and JSX inside expressions
   would leak into output.
3. **Store an AST** → a second JS AST, forbidden.

So M03-B must answer: **what is an expression, such that a backend can generate
code for it without parsing and without owning an AST?**

## 2. What the compiler already has (read from source)

| Fact | Evidence |
| --- | --- |
| The authored `ts.SourceFile` exists during compilation only | `semantic-core/parse-module.ts:35`; `compile.ts:114-186` |
| Expressions currently carry authored text and reads | `semantic-ir/types.ts` `IrExpression`; `build.ts` `buildExpression` |
| Reads are already resolved to binding kinds | `build.ts` `collectReads` (to be replaced by M03-A's resolver) |
| The compiler already invokes TypeScript's printer/transform ecosystem | `typescript@6.0.3` is a direct dependency (`packages/compiler/package.json`), and `transpileModule` is already used for syntax diagnostics |
| The IR is required to be plain data (no functions) | `validate.ts` `OEIR_DATA_FUNCTION` / `OEIR_DATA_INSTANCE` |
| Type checking of emitted output is a separate boundary | `type-check.ts:143` |

The last two rows are the hard constraints: **no functions inside the IR**, and
**no AST nodes retained**.

## 3. Candidates

### B1 — Authored source slice (status quo)

- Identity: the span.
- Codegen: must parse, or must emit TS syntax that browsers cannot run.
- Verdict: **fails** the no-reparse rule as soon as it reaches codegen.

### B2 — Compiled closure created at compile time

The compiler produces a real JavaScript function and stores it in the IR.

- Codegen: trivially references it.
- Verdict: **fails** the IR data-only invariant (`OEIR_DATA_FUNCTION`), and makes
  the IR non-inspectable and non-reproducible across processes. It also makes the
  server backend execute a client-shaped artefact, which is exactly the shared
  executable model the architecture forbids.

### B3 — Generated reference table (ExprId → generated slot)

The compiler assigns each expression an id and records the slot it will occupy in
the generated module; codegen emits a reference.

- Strength: no reparse, no AST, deterministic.
- Weakness alone: it says *where* the code goes, not *what* the code is. It needs
  a content model — which is B5.

### B4 — Sidecar AST reference (ExprId → `ts.Node`)

Keep the authored nodes alive and print on demand.

- Strength: zero text duplication; printer handles TS→JS.
- Weaknesses: the node is only valid while the `SourceFile` lives (memory grows
  with the module graph), it couples the IR to a TypeScript program identity, and
  printer output is a TypeScript-version behaviour. It also invites "the backend
  asks the compiler AST a question at codegen time", which is the coupling M03 is
  trying to remove.
- Verdict: acceptable only as an **implementation detail inside one compile**, not
  as the persisted identity.

### B5 — Compiler-owned Expression Registry (recommended)

One registry record per expression, created at compile time, holding **everything
a backend needs and nothing it must interpret**:

```ts
interface ExpressionRecord {
  readonly id: ExprId;              // stable within the module build
  readonly origin: IrSpan;          // authored span (for diagnostics/source maps)
  readonly kind: IrExpressionKind;  // snapshot | computed | tracked | handler | key | literal
  /** Lowered JavaScript text. No TS-only syntax, no JSX. */
  readonly js: string;
  /** Bindings the text reads, resolved by M03-A. */
  readonly captures: readonly BindingRef[];
  /** Where the lowered text came from, for source maps. */
  readonly mapSegments: readonly MapSegment[];
}
```

Key property: `js` is produced **once, at compile time**, by TypeScript's own
transform/printer (the dependency the compiler already has), not by a parser the
project writes. That is not a second JavaScript AST: it is the same TypeScript
AST, transformed and printed, then dropped.

After the record is built, the `ts.SourceFile` is released. No `ts.Node` survives
into the IR or into codegen.

## 4. Comparison

| Criterion | B1 slice | B2 closure | B3 ref table | B4 sidecar AST | **B5 registry** |
| --- | --- | --- | --- | --- | --- |
| Codegen can avoid parsing | no | yes | yes | yes | **yes** |
| No second JS AST | yes | yes | yes | borderline | **yes** |
| IR stays plain data | yes | **no** | yes | no | **yes** |
| Exact authored span preserved | yes | weak | weak | yes | **yes** (`origin` + segments) |
| TS-only syntax erased | no | yes | no | yes | **yes** |
| JSX inside expressions handled | no | yes | no | yes | **yes** (lowered before printing) |
| Server/client consume independently | yes (but useless) | no (shared artefact) | yes | no | **yes** (each backend reads the record) |
| Memory during build | O(1) | O(1) | O(1) | O(nodes), must stay alive | **O(expressions)** |
| Deterministic across builds | yes | no | yes | printer-version bound | **yes, version-bound and recorded** |
| Incremental friendly | yes | no | yes | no | **yes, per module** |

## 5. Recommended model

**B5 registry as the identity, B3 reference as the consumption mechanism.**

- Identity: `ExprId = <moduleId>#<scopePath>:<ordinal>` — stable under edits that
  do not change scope structure (same reasoning as M03-A's `BindingId`).
- Content: lowered JS text + capture list + origin span + map segments.
- Consumption: each backend emits *its own* code that uses the record. The client
  backend wraps it in a tracked closure; the server backend wraps it in a render
  call. **They share the record, not an executable artifact.**
- The IR keeps `js` and `captures`; it never keeps a function or a node.

This satisfies both architecture rules at once:

1. *Shared semantic meaning, independent execution* — one record, two consumers.
2. *No generic interpreter* — the record is a string plus names; nothing walks it.

## 6. The lowering step (the risky part)

The registry's `js` field requires a compile-time lowering pass:

| Input | Output | How |
| --- | --- | --- |
| `props.items.filter(i => i.active)` | same text | no TS-only syntax, printed as-is |
| `value as number` | `value` | TS transform erases the assertion |
| `value!` | `value` | non-null assertion erased |
| `fn<string>(x)` | `fn(x)` | type arguments erased |
| `satisfies T` | erased | TS transform |
| `<Row item={x} />` inside an expression | a recipe/insertion call | **the compiler's own JSX lowering**, not the printer |
| `props.children` | a projection call | same |

Rules:

1. The transformation is done with TypeScript's transform API on the authored
   AST, then printed once. The project does not write a JavaScript printer.
2. JSX inside expressions is lowered **before** printing, so no JSX reaches the
   registry.
3. The printer output must be deterministic for the pinned TypeScript version
   (`6.0.3`); the record stores the version it was produced with, so a version
   bump is a visible invalidation rather than a silent drift.
4. Anything that cannot be lowered deterministically (e.g. an expression whose
   evaluation order depends on TypeScript-only semantics) fails closed with a
   coded diagnostic instead of being guessed.

**Hypothesis to verify in the M03 implementation:** TypeScript's printer produces
stable, minimal output for the expression forms the TSX contract admits. If it
does not (e.g. it preserves unnecessary parentheses or rewrites arrow forms), the
fallback is a narrowly scoped re-print of already-transformed nodes — still not a
hand-written parser, but it must be measured before being relied on.

## 7. Source maps

`mapSegments` records, for each lowered chunk, the authored span it came from.
Codegen places `js` into generated output at a known offset and rebases the
segments. This keeps the Alpha15 guarantee that a runtime error maps to authored
TSX, without codegen knowing anything about the expression's internal structure.

The registry must be the **only** place where "authored text" and "generated
text" are related; if codegen also guesses offsets, the map drifts.

## 8. AST lifetime, memory and incrementality

| Concern | Design |
| --- | --- |
| AST lifetime | `ts.SourceFile` lives for one module compile; registry holds no nodes |
| Memory | O(expressions) records per module, released with the module result |
| Incremental | registry rebuilt per module; `ExprId` stable under body-only edits |
| Cross-module | expressions never cross modules; a component reference crosses by *name*, resolved by M03-A |
| Determinism | records are pure functions of `(source, typeScriptVersion, hostFacts)` |

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Printer output drifts across TS versions | generated diffs and source maps churn | pin version, record it in the artifact, treat bump as a migration |
| Lowering silently changes evaluation order | wrong semantics in generated code | transform only erasure/JSX; never reorder; conformance tests compare evaluated results for the admitted corpus |
| Capture list incomplete | generated closure references an undeclared name | capture list comes from M03-A's resolver, not from text scanning; a missing capture is a failing test |
| Two backends diverge in how they wrap the record | semantic drift | both wrap mechanically (one closure, one render call); behaviour tests assert identical evaluation |
| Registry becomes a de-facto wire format | the IR gets shipped | hard rule: registry is compiler-private; nothing serializes it to the browser |
| JSX-in-expression lowering couples expression identity to recipes | ordering/identity bugs | lower to a recipe **reference** (id), not to inline construction; recipes already carry their own ids (M02) |

## 10. Acceptance matrix (for the M03 implementation)

| Case | Expected |
| --- | --- |
| `value as number` in a JSX slot | registry `js` is `value`; no `as` in output |
| `value!` and `fn<string>(x)` | erasures applied |
| `props.items.filter(i => i.active)` | text preserved; captures = `props` |
| `<Row item={x} />` in an expression slot | lowered to a recipe reference; no JSX in `js` |
| two expressions in one component | two distinct `ExprId`s; no id reuse |
| same text twice at different sites | two records (site identity, not text identity) |
| codegen | assert it performs **zero** parsing: it only concatenates `js` and rebases segments |
| source map | a JS error thrown inside the expression maps to the authored span |
| memory | after compile, no `ts.Node` is reachable from the IR (assert by walk) |
| determinism | compiling twice yields byte-identical `js` |

## 11. Impact on M04 / M05

- **M04** needs capture lists to build recipe closures and owner boundaries; the
  registry supplies them per expression.
- **M05** is the first real consumer: emit `() => <js>` closures with names bound
  from `captures`. If this design holds, M05 never parses — that is the concrete
  test of the whole M03 thesis.
- **M06+** (claim) are unaffected: the claim path consumes HTML/markers, not
  expressions.

## 12. Explicitly not decided here

- The exact `ExprId` string format (only its stability properties are defined).
- Whether records are interned across modules (no evidence of need yet).
- Whether the lowering uses transform-then-print or transpile-with-wrapper; both
  are acceptable if deterministic and measured.
- Anything about ABI serialization: the registry is compiler-private.
