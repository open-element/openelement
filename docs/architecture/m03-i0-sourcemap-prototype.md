# M03-I-0 — source-map prototype: decision record

Date: 2026-11-03. Milestone: **Alpha16a M03-I-0** (prototype only). Base:
`463e6cb07` (M03-D merged).

Status: **PROTOTYPE + DECISION.** No resolver, no registry, no erasure visitor, no
codegen. The prototype lives under
`packages/compiler/src/internal/compiler/semantic-ir/sourcemap-prototype/` and is
excluded from the published package (`package.json.files` negation).

## 1. The question

With **public TypeScript APIs only**, can we obtain the generated-output offset of
every sub-expression we print — without a `ts.Program`, without a second AST, and
without a hand-written printer?

## 2. Answer

**Yes — M1 works.** The mechanism is marker-based segmented printing:

1. transform JSX nodes into recipe-reference calls (`setTextRange` keeps the
   authored range);
2. attach a unique synthetic **comment** marker immediately before and after every
   node that needs a segment;
3. print once with `ts.createPrinter().printNode(...)`;
4. scan the text for markers, strip them, and build a linear
   marked-offset → stripped-offset map;
5. emit segments as authored range ↔ generated range.

Evidence: 14 prototype tests, including the six required checks, all green
(compiler project: **256 passed**).

## 3. Route comparison (with evidence)

| Route | Evidence | Verdict |
| --- | --- | --- |
| **M1 marker segmentation** | implemented and tested here | **ADOPTED** |
| M2 TypeScript emit source maps | would work, but requires `ts.createProgram` (whole module graph) | fallback only — conflicts with the no-Program constraint |
| M3 printer-handler offset capture | **not possible via public API**: `Printer` exposes only `printNode` / `printList` / `printFile` / `printBundle` (`typescript.d.ts:8104-8124`); no writer parameter, so `onEmitNode` cannot observe output offsets | rejected on API grounds, not preference |

M3 was the original "handler wrapper" idea. The public `PrintHandlers.onEmitNode`
gives ordering but no position, and `ts.createTextWriter` / `EmitTextWriter` are
not in the public declarations. That is why M1 prints **once** and measures through
markers instead.

## 4. Coverage (required corpus)

| # | Coverage | Where |
| --- | --- | --- |
| 0 | original nested-JSX expression | `M1 — segmented print` suite |
| 0 | source comments (`a /* keep */ ? b : c`) | check 4 suite |
| 0 | operator precedence (`a + b * c - (d - e)`) | check 4 suite |
| 0 | parentheses (`(a + b) * 2`) | check 4 suite |
| 0 | nested conditionals (`a ? b ? c : d : e`) | check 5 suite |
| 0 | template strings (`` `x=${b}` ``) | check 5 suite |

## 5. The six checks — results

| Check | Result |
| --- | --- |
| 1. both conditional branches map to authored positions | **pass** |
| 2. nested arrow function maps (segment covers the authored arrow) | **pass** |
| 3. JSX replacement maps to the original JSX text (`<Fallback />`), segment flagged `fromJsx` | **pass** |
| 4. operators and parentheses do not drift (`(a + b)` maps to exactly its authored slice) | **pass** |
| 5. multiple distinct positions resolve exactly (condition, template, inner conditional, inner alternate) | **pass** |
| 6. codegen-placement rebasing (prefix shift) still resolves to the authored text | **pass** |

Plus a determinism check: two runs produce byte-identical text and segments.

## 6. Failures encountered (kept as evidence)

| Failure | Cause | Fix |
| --- | --- | --- |
| `Debug Failure: Node must have a real position` | the transformer-created recipe call nodes are synthesized (`pos < 0`) and were being marked | mark only nodes with a real authored range |
| Segment boundaries off by one | printer emits separating whitespace around stripped markers; authored ranges never include trivia | trim whitespace at both segment ends after stripping |
| Offset arithmetic drift inside a parent span | the printer re-spaces text between two child nodes, so a **parent** authored range is not a linear map of its generated text | a probe must use the **innermost** covering segment; documented as an implementation rule |
| `getFirstDescendant` misuse in tests | test-only API confusion | local descendant helper |

The third item is the important one: it is not a test artefact but a property of
segmented mapping that M03-I-2 must respect — **always map with the innermost
segment**.

## 7. Constraints this puts on M03-I

1. Segment boundaries must be whitespace-trimmed (the printer separates markers).
2. Mapping must use the innermost covering segment, never a parent.
3. The marker text must remain unique and must be stripped in a single pass with a
   linear offset map.
4. Comment markers are safe for expressions; they must not be inserted where a
   comment would change ASI behaviour (a marker before a statement is fine; inside
   a template literal it is not — the prototype only ever wraps whole nodes).
5. Determinism depends on the pinned TypeScript version; the record must carry the
   version, as designed in M03-B.

## 8. Explicitly not proven

- The prototype does not test the **erasure visitor** (M03-I-3), so "printed text
  is valid JS" is proven only for expressions that contain no TypeScript-only
  syntax beyond the erasure already absent here.
- It does not test very large expressions, deeply nested (>30) trees, or JSX
  fragments as branch values.
- It does not attempt to produce a real Source Map v3 through the Alpha15
  `SourceMapSegmentBuilder`; it proves the **segments** are obtainable and correct,
  which is the prerequisite.
- It makes no claim about codegen (M05).

## 9. Impact

- **M03-I-2** can now assume segments are obtainable; it must implement the four
  constraints in §7.
- **M03-I-3** (erasure) is unblocked but still unproven.
- **M04/M05** are unaffected at this stage.
- No Alpha15 path was touched; the prototype is a new isolated module with its own
  tests.

## 10. Decision

**Adopt M1 (marker-based segmented printing) as the source-map mechanism**, subject
to the §7 constraints, with M2 retained as fallback if a future admitted syntax
breaks the marker approach. M3 is closed on public-API grounds.
