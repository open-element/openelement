---
status: historical
topic: M03-I-0 source-map prototype
summary: Prototype and decision record; marker-based anchors adopted, the end-to-end map stayed open for M05.
---

# M03-I-0 — source-map prototype: decision record

Date: 2026-11-03. Milestone: **Alpha16a M03-I-0** (prototype only). Base:
`463e6cb07` (M03-D merged). Revised after owner review of PR #1707.

Status: **PROTOTYPE + DECISION.** No resolver, registry, erasure visitor or
codegen. The prototype lives under
`packages/compiler/src/internal/compiler/semantic-ir/sourcemap-prototype/` and is
excluded from the published package (`package.json.files` negation).

## 1. The question

With **public TypeScript APIs only**, can we obtain the mapping position of every
sub-expression we print — without a `ts.Program`, without a second AST, and
without a hand-written printer?

## 2. Answer, in one sentence

**Yes — and positions are anchors, not interpolations.**

A JSX node replaced by `__oe_recipe_ref("r0")` is 22 characters where
`<Fallback />` was 11. Any "authored + delta" arithmetic therefore produces
nonsense inside that node. Source Map v3 itself maps **discrete** positions, so the
prototype records one anchor per node start and resolves a generated offset to the
nearest preceding anchor.

## 3. Mechanism (M1)

1. transform JSX nodes into recipe-reference calls (`setTextRange` keeps the
   authored range);
2. attach a namespaced synthetic **comment** before and after every node that
   needs an anchor;
3. print **once** with `ts.createPrinter().printNode(...)`;
4. scan the printed text, strip markers through a **prefix-sum + binary-search**
   offset index, and require every expected marker to appear exactly once;
5. emit anchors: authored node start ↔ generated offset;
6. `TransformationResult.dispose()` runs in a `finally` block, so no transformed
   tree outlives the record.

## 4. Corrections made after review

| Review finding | Correction |
| --- | --- |
| `resolveAuthoredOffset` interpolated inside a node | removed; `resolveAnchor` returns the nearest preceding anchor (innermost on ties). No authored-offset arithmetic. |
| Fixed marker prefix could collide with an author comment | namespace is derived from the source hash, extended while it occurs in the authored text; every marker is asserted to appear exactly once; negative test keeps an author comment that mimics a marker. |
| Tests were circular (computed the offset from the same segment) | rewritten: node text is obtained **independently** from a separate `printer.printNode` call, or from an independent string search for the recipe call; JSX replacement is verified by locating the call in the output. |
| `TransformationResult` never disposed | `try/finally` disposal. |
| `toStripped` was O(n²) | prefix sums + binary search (O(log n) per query). |
| M1 definition in M03-B was stale | M03-B now records the old "print sub-nodes and concatenate" M1 as **SUPERSEDED** and defines the marker-based M1, linking here. |
| "Segments proven" overstated | the record distinguishes **node anchors proven** from **full production Source Map v3 proven end-to-end**. |

## 5a. Revision note (2026-11-03, second qualification round)

The first revision of this record described the six checks slightly more strongly
than the tests proved. This revision states what each check actually asserts:

| Change | Why |
| --- | --- |
| marker **index** built in one pass over the printed text (O(L)); offsets resolved by prefix sums + binary search (O(log n)) | the earlier code rescanned `markedText` per marker |
| missing / duplicate / unknown / unpaired markers **fail closed** and return the text untouched | a marker the prototype does not understand must never be silently deleted |
| anchors **merged** by generated line/column (deepest wins) before `SourceMapSegmentBuilder` | two segments at one generated position is ambiguous to consumers |
| Source Map v3 decoded with **all five VLQ fields** (generated column, source index/line/column, name) and compared per segment | the earlier check compared only generated line and source line |
| Check 2 selects the arrow by its **full authored span** and compares with an independently located generated position | the narrowest-at-start rule could pick an identifier instead |
| Check 3 covers **both** `<Row />` and `<Fallback />` (recipe ids `r0`/`r1`) | previously only the alternate branch |
| Check 5 asserts the **deepest-wins** rule with the candidate set and the resolved span | the earlier assertion contained identical operands and proved nothing |
| unary / ASI corpus (`a + +b`, `a - -b`, `a++`, `++b`, `a + ++b`, `??`, newline before `+`) | marker insertion must not change parsing or meaning |

## 5. Coverage and the six checks

Corpus: original nested-JSX expression · source comments · operator precedence ·
parentheses · nested conditionals · template strings.

| Check | Result | How it was verified |
| --- | --- | --- |
| 1. both conditional branches | **pass** | each branch anchor's generated slice (whitespace-normalised) equals the branch's own printed text / recipe call |
| 2. nested arrow | **pass** | anchor slice matches the independently printed arrow prefix |
| 3. JSX replacement | **pass** | recipe call located by independent string search; anchor resolves to the JSX start; `fromJsx` flag set |
| 4. operators / parentheses | **pass** | `(a + b)` anchor slice equals the independently printed parenthesised text |
| 5. multiple positions | **pass** | every identifier anchor matches its independently printed name; several positions in a nested conditional/template expression |
| 6. codegen rebasing | **pass** | multi-line prefix shifts generated line/column; authored position unchanged |
| extra: differing-length replacement | **pass** | every offset inside the recipe call resolves to the JSX start (no drift) |
| extra: Source Map v3 | **pass, full coordinates** | merged points feed `SourceMapSegmentBuilder`; the `mappings` string is decoded with all five VLQ fields and compared coordinate by coordinate, including name index |
| extra: marker pairing | **pass** | missing / duplicate / unknown / unpaired markers are unit-tested to fail closed |
| extra: unary / ASI | **pass** | seven adjacency/newline forms parse and evaluate identically after stripping |
| extra: determinism | **pass** | two runs produce identical text, namespace and anchors |

## 6. Discovered properties (these become M03-I-2 rules)

1. **Markers change printer spacing.** The marked print inserts spaces around
   comment markers (`props .items .map`), so the emitted text **must be the
   stripped marked print** — printing once cleanly and measuring on another print
   would be inconsistent.
2. **Anchors, not ranges.** Any offset inside a node maps to that node's start;
   interpolation is invalid wherever a replacement changes length.
3. **Innermost is ambiguous at equal starts.** A parent and its first child share a
   generated start; the mapping must pick one deterministically (deepest), and
   consumers must not assume a unique anchor object.
4. **Whitespace trimming is required** at anchor boundaries after marker removal.

## 7. Explicitly not proven

- The erasure visitor (M03-I-3): the corpus contains no TypeScript-only syntax, so
  "output is valid JS after erasure" is untested.
- Large or very deep expressions; JSX fragments as branch values.
- A production Source Map v3 **end-to-end**: the prototype proves anchors can be
  expressed in `SourceMapSegmentBuilder` terms and decoded, not that the final
  generated module's map is correct after full codegen (M05).
- Performance at scale (only the offset lookup complexity is addressed).
- Marker safety inside template literals or ASI-sensitive positions: the prototype
  only wraps whole nodes, never characters inside a literal.

## 8. Routes compared (final)

| Route | Evidence | Verdict |
| --- | --- | --- |
| **M1 marker-based anchors** | implemented, 16 tests | **ADOPTED** |
| M2 TypeScript emit source maps | works, requires `ts.createProgram` | fallback only |
| M3 printer-handler offsets | **not possible publicly**: `Printer` exposes only `printNode` / `printList` / `printFile` / `printBundle` (`typescript.d.ts:8104-8124`); no writer, so `onEmitNode` cannot observe offsets | **closed on API grounds** |

## 9. Impact

- **M03-I-2** may rely on anchors and must implement the four rules in §6.
- **M03-I-3** (erasure) is unblocked but unproven.
- **M04/M05** unaffected at this stage; no Alpha15 path was touched.

## 10. Decision

**Adopt M1 (marker-based anchor printing)** with the §6 rules, M2 kept as a
fallback, M3 closed. This settles *node position acquisition*. It does **not**
settle end-to-end Source Map correctness, which stays OPEN for M05.
