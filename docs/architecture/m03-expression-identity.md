# M03-B — Expression identity

Date: 2026-11-03. Milestone: **Alpha16a M03-D (design)**. Base:
`017bd3e8775e8d74fc8778b6321bbbe5d74486c6` (M02 merged). Revised after owner
review (see [the corrections register](./m03-review-corrections.md)).

Status: **DESIGN PROPOSAL — NOT IMPLEMENTED.** No codegen, no runtime, no ABI.

## 1. The problem

M02 stores an expression as authored text plus metadata:

```ts
// M02 semantic-ir/types.ts
interface IrExpression {
  readonly kind: 'literal' | 'local' | 'computed' | 'tracked' | 'handler' | 'key';
  readonly source: string;
  readonly span: IrSpan;
  readonly reads: readonly IrRead[];
}
```

Codegen cannot use that: re-parsing `source` is forbidden, emitting it verbatim
leaks TypeScript-only syntax and JSX, and storing an AST is a second JavaScript
AST. M03-B defines **what an expression is** such that a backend can generate code
for it without parsing and without owning an AST.

## 2. Source-verified facts (installed `typescript@6.0.3`)

| API | Declaration | What it gives us |
| --- | --- | --- |
| `ts.transform(source, transformers, options)` | `typescript.d.ts:11446` | apply a custom transformer to the **existing** AST |
| `TransformationResult.dispose()` | `typescript.d.ts:8056` | release transformed nodes deterministically |
| `ts.createPrinter(opts?)` | `typescript.d.ts:9513` | print a node/file to text (public API) |
| `printer.printNode(hint, node, sourceFile)` | `typescript.d.ts:8117` | print a single expression |
| `ts.setTextRange(node, original)` | `typescript.d.ts:9185` | give a synthesized node the original position range |
| `ts.factory.*` | `typescript.d.ts:8895` | build replacement nodes |
| `ts.transpileModule(text, opts)` | `typescript.d.ts:11408` | one-shot erasure + print, **parses text first** |
| `ts.createProgram(...)` / `program.emit(...)` | `typescript.d.ts:9614,9629` | full-program emit with source maps |

The compiler already depends on `typescript` and already uses `transpileModule`
(`semantic-core/parse-module.ts:43`). Nothing here adds a dependency.

## 3. Correction A — the actual lowering route, compared

### Route 1 — existing `SourceFile` + `Program.emit`

Sequence: `createProgram({ rootNames, options, host })` → `program.emit(sourceFile,
writeFile, undefined, false, { before: [openElementJsxTransform] })`.

- Reuses the existing `SourceFile`? Yes — it is the program's source file.
- Erasure: done by TypeScript's own emitter.
- Source maps: `sourceMap: true` produces a map from generated JS to the authored
  file, including positions from the custom transformer if it uses `setTextRange`.
- Cost: a **program** (whole-module-graph resolution) per compilation. The
  semantic core is deliberately host-independent and today runs on a single
  source string; building a program would make the compiler own module
  resolution.

### Route 2 — `transpileModule` on authored text

Sequence: `transpileModule(authoredSource, { jsx: …, compilerOptions })`.

- Reuses the existing `SourceFile`? **No** — it parses the text again.
- Erasure: complete (TypeScript's own).
- JSX: TypeScript lowers JSX to its own factory calls, not to OpenElement
  recipes; our JSX lowering would have to run afterwards on the emitted JS.
- Cost: one extra **full parse of the module**, and it cannot see our custom
  recipes. Already used today only for syntax diagnostics.

### Route 3 — direct transform + public printer (recommended)

Sequence:

```text
1. ts.transform(sourceFile, [openElementExpressionTransform], options)
2. walk the transformed tree; for each expression:
     a. apply a small erasure visitor (as / satisfies / non-null / type args /
        type assertions / return-type annotations inside arrow bodies)
     b. replace embedded JSX with a recipe reference call
     c. ts.setTextRange(newNode, original) on every synthesized node
3. ts.createPrinter().printNode(ts.EmitHint.Expression, node, sourceFile)
4. record segments while printing (see §5)
5. transformationResult.dispose()
```

- Reuses the existing `SourceFile`? **Yes** — the same AST that was parsed once.
- Erasure: performed by **our visitor** over a narrow syntax set, not by a
  parser. This is the one place where the design takes on work TypeScript would
  otherwise do, and it is why §7 defines a differential oracle.
- JSX: our own lowering, applied on the same tree, so recipe identity and spans
  survive.
- Source maps: our own segment recording (§5), reusing
  `semantic-core/source-map.ts` (`SourceMapSegmentBuilder`).
- Cost: one transform pass + one print per expression; no reparse.
- Risk: the erasure visitor must be complete for admitted syntax, verified by
  the oracle.

| Criterion | Route 1 program.emit | Route 2 transpileModule | **Route 3 transform+print** |
| --- | --- | --- | --- |
| Reparse of authored source | no | **yes** | **no** |
| Reuses the existing `SourceFile` | yes | no | **yes** |
| Erasure by TypeScript itself | yes | yes | **no — our visitor** |
| Custom JSX lowering fits | yes (before-transform) | poorly (after emit) | **yes (same tree)** |
| Requires a `ts.Program` | **yes** | no | **no** |
| Host independence preserved | no | yes | **yes** |
| Source maps | from TS emit | from TS emit (map of synthetic text) | **our segments** |
| Cost per module | high | one extra parse | **transform + print** |

**Recommendation: Route 3**, with Route 2 retained as a **differential oracle** in
tests (compile the same expression through both and compare evaluated behaviour),
and Route 1 documented as the fallback if the erasure visitor proves
underspecified. Choosing Route 3 is what keeps the compiler host-independent; the
oracle is what keeps it honest.

**Why not Route 1 despite better source maps:** a mandatory program contradicts
the "no mandatory full TypeScript Program" constraint the owner set for M03, and
it would move module resolution into the semantic core.

## 4. Correction C — ExpressionRegistry is separate from the IR

| Layer | Holds | Lifetime |
| --- | --- | --- |
| **Semantic IR** | `ExprId` references, binding references, tracking semantics (`mode`, dependencies), recipe relationships, authored spans | the component graph |
| **Expression Registry** (sidecar) | `ExprId` → lowered JS text, lexical captures, source-map segments, lowering provenance (TypeScript version, transformer version) | one compilation; released after codegen |

Separation rule: the IR says *which* expression and *how it is tracked*; the
registry says *what code* it becomes. Neither is serialized; neither is public.

A sidecar keyed by `ExprId` is chosen over embedding the record in the IR node so
that a component graph can be inspected without dragging lowered code along, and
so the registry can be dropped as soon as codegen is done.

## 5. Correction B — source maps (mechanism UNVERIFIED, experiment required)

Three coordinate spaces exist and must not be confused:

```text
authored TSX  ──(transform)──►  lowered JS  ──(codegen placement)──►  generated module
   span                            offsets                                line/col
```

**What is settled:**

- Segments must be expressed in the existing `SourceMapSegmentBuilder` convention
  (`EmissionSegment`: 1-based generated line, 0-based generated column, 1-based
  source line, 0-based source column), because that is what the Alpha15 path
  already produces and what codegen already composes.
- Codegen rebases segment offsets by the placement offset; segments are never
  recomputed downstream.
- Nested JSX: the replacement node keeps the original JSX range
  (`setTextRange`), so its provenance points at the JSX, not at the recipe's
  interior. M02 already records the recipe's own span.

**What is NOT settled, and must not be presented as designed:**

`printer.printNode(hint, node, sourceFile)` returns a **string**. It does not hand
back per-child output offsets. `setTextRange` preserves *authored* positions; it
produces no generated offsets. So the sentence "walk the tree and record
(generatedOffset, authoredSpan)" describes an intention, not a mechanism. How the
generated offset of each nested sub-expression is obtained is **open**.

Candidate mechanisms, all requiring prototype evidence in M03-I:

| Mechanism | How offsets arise | Cost / risk |
| --- | --- | --- |
| **M1 — segmented printer** | print each sub-node separately and concatenate, accumulating offsets as you go; syntax glue (operators, parens, commas) is emitted by the caller | deterministic and public-API only; the caller becomes responsible for correct glue, which is where bugs hide |
| **M2 — TypeScript emit source maps** | let `program.emit` (or a transform-then-emit route) produce the map from the same `SourceFile` | accurate and battle-tested; requires a program, which is the constraint Route 3 exists to avoid |
| **M3 — position-recording printer wrapper** | wrap/replace printer handlers (`PrintHandlers`) to observe each node's emitted range | relies on printer handler behaviour that TypeScript documents thinly; acceptable only if M1 fails and the wrapper is proven stable across the pinned version |

**Required experiment before M03-I implementation claims anything.** Compile this
exact expression through the chosen mechanism and verify six things:

```tsx
const result =
  props.enabled
    ? props.items.map(item => <Row value={item.value} />)
    : <Fallback />;
```

| # | Check |
| --- | --- |
| 1 | both branches of the conditional map back to their authored ranges |
| 2 | the nested arrow function body maps correctly |
| 3 | the JSX replacement (recipe reference) maps to the JSX start, not to emitted glue |
| 4 | operators and parentheses do not shift or swallow neighbouring segments |
| 5 | an error thrown at each of several positions inside the lowered text maps to the right authored line/column |
| 6 | after codegen rebasing, the final generated module's map still points at the authored TSX |

If M1 cannot produce reliable segments, the design must switch to M2 (accept a
program for emit) or justify M3 with evidence. **Route 3 is still preferred, but
its source-map half is a hypothesis, not a result.**

## 6. Correction E — nested JSX and evaluation order

| Aspect | Decision |
| --- | --- |
| JSX inside an expression (e.g. `cond ? <A/> : <B/>`) | replaced by a **recipe reference**, never inlined construction |
| Recipe identity | the recipe created during the same walk (M02 `IrRecipe.id`); the expression holds a reference, not a copy |
| Evaluation order | JSX lowering must not reorder evaluation: the replacement call is evaluated exactly where the JSX node was |
| Owner assignment | happens at the **insertion site**, not inside the expression; the expression only produces a recipe value |
| Generated substitution | codegen emits the recipe reference expression it was given; it never sees JSX |
| Source mapping | the replacement node keeps the JSX's original range (`setTextRange`) |

Context-sensitive expressions fail closed:

| Construct | Behaviour |
| --- | --- |
| `this` | diagnostic `OEIR_UNSUPPORTED_THIS` (function components have no `this`; class authoring retires) |
| `arguments` | diagnostic `OEIR_UNSUPPORTED_ARGUMENTS` |
| `super` | diagnostic `OEIR_UNSUPPORTED_SUPER` |
| `new.target` | diagnostic `OEIR_UNSUPPORTED_NEW_TARGET` |
| `await` inside an expression | only inside an async server component (M14); otherwise diagnostic `OEIR_AWAIT_OUTSIDE_ASYNC` |
| `yield` / generators | diagnostic `OEIR_UNSUPPORTED_GENERATOR` |
| `eval` / `with` | diagnostic `OEIR_DYNAMIC_SCOPE` |

## 7. Correction D — identity stability, stated correctly

- `ExprId` is **unique within one compilation**. That is the only guarantee the
  compiler needs: the registry and the IR are consumed in the same build.
- `ExprId` is **not** claimed to be stable across builds. Inserting an expression
  earlier in a component shifts ordinals; the first draft implied otherwise and
  that claim is withdrawn.
- Cross-build stability (for caching, incremental rebuilds, or persistent
  analysis) is **not required** unless a concrete consumer demonstrates the need.
  If such a consumer appears, the fix is content-addressed identity, which is a
  later decision with its own evidence.
- The registry is per compilation and per module; nothing persists.

## 8. Lowering rules (the contract the implementation must satisfy)

1. The expression is transformed on the **existing** AST; no text reparse.
2. TypeScript-only syntax is erased by the erasure visitor: `as`, `satisfies`,
   non-null `!`, type assertions, type arguments on calls/new, and annotations
   inside nested arrow/function bodies.
3. Embedded JSX is lowered to recipe references before printing.
4. Every synthesized node carries its original range (`setTextRange`), so the
   segmented print can produce accurate segments.
5. Printing uses the public `createPrinter().printNode(..., EmitHint.Expression)`.
6. The transformed tree is disposed after the record is built; no `ts.Node` is
   retained.
7. Anything the erasure visitor cannot lower deterministically fails closed with a
   coded diagnostic — never a best-effort emission.

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Erasure visitor incomplete for admitted syntax | invalid JS emitted | differential oracle vs `transpileModule` **on erasure-only expressions**; JSX and source maps verified independently (§10) |
| Printer output churn across TypeScript versions | generated diffs churn | record `typescriptVersion` in the registry; treat a bump as a visible invalidation and re-run the oracle |
| Capture list incomplete | generated closure references an unknown name | captures come from M03-A's resolver, not text scanning; a missing capture fails resolution |
| Segmented print drifts from printed text | wrong source maps | segments are recorded from the same walk that produces the text, never recomputed |
| Registry grows into a wire format | IR shipped to browser | hard rule: registry is compiler-private, per compilation |
| Nested JSX ordering bug | wrong evaluation order | replacement is a 1:1 node substitution at the same position; tests assert order |

## 10. Acceptance matrix

### M03-I (frontend, no codegen)

| Case | Expected |
| --- | --- |
| `value as number` | lowered text is `value`; output parses as valid JavaScript |
| `value!` / `fn<string>(x)` / `x satisfies T` | erasures applied |
| nested arrow with annotations | erasures applied inside the body |
| `props.items.filter(i => i.active)` | text preserved; captures = `props` |
| two expressions, same text | two `ExprId`s, two records (site identity) |
| registry output | parses as JavaScript (syntax check), no `ts.Node` retained, no JSX in text |
| determinism | two compilations produce byte-identical lowered text |
| source map (mechanism experiment, §5) | the six checks above pass |
| unsupported context (`this`, `arguments`, …) | coded diagnostic, no emission |

**Moved out of M03-I:** "codegen performs zero parsing" is an **M05** acceptance
criterion. M03-I can only prove the registry contains valid JS and no AST; the
codegen that consumes it does not exist yet.

### Differential oracle scope (Route 2 is not the semantic reference)

Route 2 and Route 3 do not process JSX the same way, so comparing their final
output would be meaningless. The oracle is split:

| Aspect | How it is verified |
| --- | --- |
| TypeScript syntax erasure | Route 2 vs Route 3 on **erasure-only** expressions (no JSX, no recipes) — text or evaluation parity |
| ordinary JavaScript expressions | evaluate both routes and compare results |
| nested JSX / recipes | **independent** verification of recipe substitution and evaluation order (no Route 2 comparison) |
| source maps | independent verification of authored-position mapping |
| context-sensitive syntax | independent verification of the diagnostic code and fail-closed behaviour |

Route 2 is an oracle for **TypeScript's erasure**, not for OpenElement's
semantics.

## 11. Milestone alignment

| Milestone | Scope |
| --- | --- |
| **M03-D** | this design (scope model + expression identity + contracts) |
| **M03-I** | frontend implementation: resolver, registry, erasure visitor, differential oracle; still no codegen |
| **M04** | runtime primitives, recipes, ownership |
| **M05** | first generated execution |

Approving the documentation does not complete M03; M03 completes when M03-I's
matrix is green.

## 12. Impact on M04 / M05

- M04 consumes capture lists and recipe references; both are defined here.
- M05 is the first real consumer: it emits `() => <lowered>` with captures bound
  by name and segments rebased. If M05 needs to parse anything, this design
  failed.
- M06+ (claim) is unaffected: claim consumes HTML/markers, not expressions.
