# M02 Semantic IR feasibility spike — report

Date: 2026-11-03. Milestone: **Alpha16a M02 (initial slice)**. Base:
`554a54a338e58b63b38887f2e5e7e6145e1c5626`.

Status: **spike implemented, then corrected in M02.1 (owner review); M02 exit
evidence completed 2026-11-08 (PR-1); design questions listed as OPEN under
their owning milestones.** No codegen, no interpreter, no ABI, no SSR/claim
change.

Revision 2026-11-05: the condition/children coverage record is corrected. The
M02.1/M02.2 corrections added worked examples and positive assertions for both
nodes; `children-projection` also has a missing-owner negative case. `condition`
has **no** negative case, so only its expressiveness is evidenced. The earlier
"not exercised by a worked example" wording in §3, §8 and §9 was stale and is
marked SUPERSEDED HISTORY there.

Revision 2026-11-06: the M02 IR is now consumed by the compiler-private
leaf-codegen prototype (PR #1709, M05 direction). That prototype is a Class P
spike: it is **not** a codegen contract and it does not record M05/G1 evidence —
see [m05-g1-leaf-prototype](./m05-g1-leaf-prototype.md). Two corrections follow
from that consumption: (1) the IR's attribute channel is a **simplified
classification**, not a contract (the spike defaulted dynamic attributes to a DOM
property); the production classification now lives in
`packages/compiler/src/internal/compiler/semantic-core/attribute-classification.ts`
and is shared by both consumers; (2) the IR is still not public API and not a wire
format, but the "not a codegen input" sentence in §2 is amended accordingly.

Revision 2026-11-08 (M02 exit closeout, PR #1729): the execution-plan §1a
criterion-4 gap is closed. The admitted `condition` node now has its negative
case in `packages/compiler/__tests__/semantic-ir/invariants.test.ts` — "a
conditional branch that is neither JSX nor null" — asserting
`OEIR_CONDITION_BRANCH_UNSUPPORTED` with `origin: 'source'` and a span that
slices exactly the authored branch expression. Evidence was produced at head
`3103952a7` with `npx vitest run --project compiler` (LOCAL run; counts in the
[progress ledger](./alpha16-18-progress.md) §3/§4). This is a test/doc slice: it
changes no production code, runtime, ABI or browser behaviour, and claims no
M03+ work and no G1/G2 record.

## 1. What this slice proves — and what it does not

It proves that a **small IR can express the semantics** of the five approved
worked examples, including the distinction between an ordinary local, an explicit
`computed` value and an inline tracked read.

It does **not** prove: that generated code runs (G1), that identity/ownership work
at runtime (G2), that SSR→DSD→claim preserves fidelity, or that any ABI is right.
Those are M05–M08.

## 2. What was built

| File | Role |
| --- | --- |
| `packages/compiler/src/internal/compiler/semantic-ir/types.ts` | the IR node set (compiler-private) |
| `packages/compiler/src/internal/compiler/semantic-ir/build.ts` | TSX → IR for the spike grammar, failing closed on everything else |
| `packages/compiler/src/internal/compiler/semantic-ir/validate.ts` | IR invariants: spans, tracking claims, ids, owners, insertions, data-only |
| `packages/compiler/src/internal/compiler/semantic-ir/index.ts` | internal entry (not exported from the package) |
| `packages/compiler/__tests__/semantic-ir/examples.test.ts` | the five worked examples (positive) |
| `packages/compiler/__tests__/semantic-ir/invariants.test.ts` | unsupported grammar + malformed IR (negative) |

Nothing is exported from `packages/compiler/src/compiler.ts` or any package
subpath: the IR is not public API and not a wire format. Since 2026-11-06 it is
consumed by the compiler-private leaf-codegen prototype (see the revision note
above and [m05-g1-leaf-prototype](./m05-g1-leaf-prototype.md)); that consumption
is a Class P spike, so the IR still has no codegen contract.

## 3. The IR node set (and which nodes the examples actually exercise)

| Node | Used by |
| --- | --- |
| `component` | all five |
| `fragment` | ex. 1 (multi-root), ex. 4 |
| `element` | ex. 1, 2, 3, 5 |
| `text` | ex. 1, 2 |
| `dynamic-text` | ex. 2, 3, 5 |
| `static-attribute` / `dynamic-attribute` | ex. 2 (event), 3 (key, draft), 5 (value, handler) |
| `component-ref` | ex. 1 (Header/Footer), ex. 4 (recipe target) |
| `condition` | supported by the grammar and validator; exercised by the M02.1 worked example and by the branch-shape negative case added at the 2026-11-08 exit closeout (see §6) |
| `list` | ex. 3, 5 |
| `recipe` + `insertion-site` | ex. 4 |
| `children-projection` | supported by the grammar; exercised by the M02.1 worked example and the missing-owner negative case (see §11) |
| `expression` / `read` | every dynamic slot |
| `owner` / `resource` | every example |

Two nodes the M01 design listed are **not** in the spike as first-class nodes:
`Fragment` and `Children` are represented as `fragment` and
`children-projection`; no additional node was invented without a consumer.

## 4. The distinction the owner asked for

An ordinary local, an explicit computed value and an inline JSX expression are
three different representation tiers, and the tests pin each one:

| Tier | Representation | Evidence |
| --- | --- | --- |
| ordinary local | `IrResource{kind:'local'}` with `expression.kind:'local'` | `resources` assertion in ex. 2; snapshot semantics elsewhere |
| explicit computed | `IrResource{kind:'computed'}` with `expression.kind:'computed'` | `['d','computed']` in ex. 2 |
| inline JSX read | `IrDynamicText{expression.kind:'tracked', tracked:true}` | `n.value` / `d.value` in ex. 2, `draft.value` in ex. 5 |
| event handler | `IrDynamicAttribute{channel:'event'}`, `expression.kind:'handler'`, `tracked:false` | `onClick` / `onInput` assertions |

The validator enforces the invariant behind it: **a slot claiming tracking must
actually read a signal, computed value or prop**; a slot that reads one without
claiming tracking is reported. Handlers, keys and refs are exempt because they are
not update-driven slots.

## 5. Identity, ownership and spans

- **Identity** — every node has a stable, path-shaped id; duplicates are a
  diagnostic (`OEIR_DUPLICATE_ID`). A list's `key` is a first-class expression with
  `kind:'key'`; an unkeyed list is represented explicitly as positional
  (`key: null`) with a warning, never silently keyed.
- **Ownership** — `owners` is a tree of `{id, parent, reason}` records. A
  component owns one root owner; **each insertion site creates its own owner**;
  a recipe that is never inserted is reported. Two sites sharing one owner is a
  diagnostic (`OEIR_INSERTION_SHARED_OWNER`), which is the IR-level statement of
  "repeated insertion means repeated creation".
- **Spans** — every node, resource, recipe and expression carries file, byte
  range, 1-based line and column. The validator bounds-checks them against the
  authored source (`OEIR_SPAN_OUT_OF_RANGE`).

## 6. What fails closed (negative evidence)

| Case | Diagnostic |
| --- | --- |
| spread attributes | `OEIR_SPREAD_UNSUPPORTED` |
| unsupported statement (`if`, …) | `OEIR_STATEMENT_UNSUPPORTED` |
| no component in module | `OEIR_COMPONENT_MISSING` |
| syntax error | `OEIR_SYNTAX` |
| a conditional branch that is neither JSX nor null | `OEIR_CONDITION_BRANCH_UNSUPPORTED` |
| children on a component reference | `OEIR_COMPONENT_CHILDREN_UNSUPPORTED` |
| multiple returns | `OEIR_MULTIPLE_RETURNS` |
| tracking claim without a reactive read | `OEIR_TRACKED_WITHOUT_SOURCE` |
| reactive read not marked tracked | `OEIR_REACTIVE_UNTRACKED` (warning) |
| duplicate node id | `OEIR_DUPLICATE_ID` |
| owner cycle / missing parent | `OEIR_OWNER_CYCLE` / `OEIR_OWNER_PARENT_MISSING` |
| insertion into an unknown recipe | `OEIR_INSERTION_UNKNOWN_RECIPE` |
| two insertions sharing an owner | `OEIR_INSERTION_SHARED_OWNER` |
| span outside the source | `OEIR_SPAN_OUT_OF_RANGE` |
| a function or class instance inside the IR | `OEIR_DATA_FUNCTION` / `OEIR_DATA_INSTANCE` |
| unkeyed list | `OEIR_UNKEYED_LIST` (warning) |

The data-only check matters: it is what prevents "a second runtime object tree"
from quietly appearing inside the compiler.

## 7. Results

| Check | Result |
| --- | --- |
| `@openelement/compiler` tests | **227 passed / 227**, including **24 new spike tests** |
| `@openelement/element` tests (Alpha15 regression) | **712 passed / 712** |
| `vp run check` (fmt / lint / typecheck / markdown / public-docs) | **PASS** |
| No VNode, no interpreter, no second JS AST | by construction and by the data-only check |
| No public export added | verified: package entry untouched |

## 8. Feasibility findings

1. **The five examples fit in a small node set.** No example required a new node
   type, and no node is present "for the future": `condition` and
   `children-projection` also have M02.1 worked examples, and both now have
   negative cases — `children-projection` a missing-owner case, `condition` the
   branch-shape case added at the 2026-11-08 exit closeout (§6). (SUPERSEDED
   HISTORY: an earlier revision said both were unexercised, and a later one said
   `condition` had no negative case; §11 records the corrections.)
2. **The three evaluation tiers are representable without a JavaScript AST.**
   Expressions stay authored source slices plus resolved reads; nothing re-parses
   them, so the IR does not become a second parser.
3. **Repeated insertion is expressible as data.** Recipe + per-site owner is
   enough to state "two insertions, two instances" without any mount-time
   concept.
4. **Keyed vs positional identity is expressible and distinguishable**, which was
   the riskiest part of example 3.
5. **Costs appeared where expected**: scope resolution (which identifiers are
   signals/computeds/props) is the only analysis the builder really needs, and it
   is currently a thin name table, not real scope analysis. That is fine for a
   spike and insufficient for M03.

## 9. OPEN questions

| # | Question | Why it matters |
| --- | --- | --- |
| OPEN-1 | Scope resolution must become real (shadowing, destructuring, closures, cross-module imports). The spike uses a flat name table. | Otherwise "tracked" claims are guesses |
| OPEN-2 | Expression `source` slices are fine for a spike; a real backend needs either a re-derivable expression id or a compiled closure. Choosing wrong makes codegen re-parse source. | Determines the IR→client codegen seam |
| OPEN-4 | Claim marker protocol for ordered repeated insertion remains OPEN (as agreed). | Blocks example 5 end-to-end; the marker/key/seed/recovery chain is owned by M07 (leaf) and M08 (stateful SSR→claim) |
| OPEN-5 | Ownership lineage (which owner may project into which) has no mechanism yet; the IR only records owner ids. | Needed for TSX-26 |
| OPEN-6 | The builder is a prototype frontend, not the production one; the class-shaped frontend is untouched and still the Alpha15 path. | M03 must decide how the function frontend replaces, not wraps, the class path |

**OPEN-3 is CLOSED.** The M02.1/M02.2 corrections added worked examples and
positive assertions for `condition` and `children-projection`, plus the
`children-projection` missing-owner negative case; the 2026-11-08 exit closeout
adds the `condition` branch-shape negative case (§6). The earlier "implemented
but not covered" record and the later "no negative case for `condition`" note are
SUPERSEDED HISTORY. The OPEN items above remain OPEN under their owning
milestones: OPEN-1/2/6 are M03 work, OPEN-5 is M04 work, and OPEN-4 (claim
marker) is M07/M08 work and is explicitly allowed to stay OPEN in M02 by
execution-plan §1a criterion 3.

## 10. Relationship to the Alpha15 chain

`compile.ts` → `lower-program.ts` → `emit-program.ts` → `emit-module.ts` is
**untouched**. The spike sits beside it as an isolated compiler-private module
with its own tests; element and router suites pass unchanged. Nothing in this
slice can break Alpha15 because nothing in Alpha15 imports it.

## 11. M02.1 corrections (owner review)

| # | Defect found in review | Correction |
| --- | --- | --- |
| 1 | Ex3/Ex5 did not cover *one* stateful list: the list owned the draft and the row was tested separately | Ex3 and Ex5 are now **one shared fixture**: `List` maps `props.items` to `<Row key={item.id} item={item} />`, and `Row` owns its private `draft`. Both modules are asserted together, including identity-in-key + reference and per-entry ownership. |
| 2 | `list.items` forced to `kind:'local'` | The data source keeps its semantics: `props.items` is now `tracked` with a prop read; a plain local stays a snapshot. |
| 3 | Validator checked only root-level spans | Every span-bearing object is checked: attributes, dynamic-attribute expressions, component-ref props, list items/key, condition test, recipe target and its props, resource expressions. |
| 4 | Several diagnostics were not source-located | `IrDiagnostic` now carries `origin: 'source' \| 'ir-object' \| 'module'`. Authored-grammar findings point at source; IR-object findings at the IR object; module-level findings (syntax, missing component) say so instead of pretending to be a source location. |
| 5 | `value={1}` was marked tracked and then rejected | Tracking is derived from the expression kind, not from "not local": literals and plain locals are untracked. Added positive tests for literal, local and prop attributes. |
| 6 | Ownership checks were per-recipe | Owners must be unique, resolvable and acyclic; every insertion/projection owner must exist; **no two insertion sites may share an owner globally**; lists declare per-entry ownership and their region owner. |
| 7 | Pack failed: publish-scoped source module unreachable | The spike is excluded from the published surface. Note: this repository's packer derives include/exclude from `package.json.files` (`!` prefix), **not** from `publish.exclude`, so the exclusion is `"!src/internal/compiler/semantic-ir"`. The Alpha15 publish graph is otherwise untouched. |

P2 items also closed: an ordinary-local snapshot test, worked examples for
`condition` and `children-projection` (positive only for `condition` at this
point; `children-projection` also had the missing-owner negative), and the span
documentation now says **UTF-16 code units** (TypeScript positions), not bytes.
The `condition` negative case was added later, at the 2026-11-08 exit closeout
(§6/§8.1); this paragraph is kept as history and does not claim it.

### M02.2 — final validator completeness (owner review)

| # | Gap | Correction |
| --- | --- | --- |
| 1 | `dynamicSlots()` only collected element attributes, so **component-ref props** and **recipe target attributes/props** never had their tracking claim checked | `dynamicSlots(component)` is now the single definition of "dynamic slot": dynamic text, element attributes, component-ref props, and recipe target attributes/props |
| 2 | A list's region owner was checked for existence but not added to the global owner-use set, so two lists could share one owner | List owners now participate in global uniqueness; a shared list owner is `OEIR_LIST_SHARED_OWNER` |

Both are covered by a positive case (reactive component prop is tracked, literal
prop is not) and negatives (tracked claim on a component-ref prop, on a recipe
target prop, and two lists sharing a region owner).

## 12. Verdict

The IR is **feasible as a shape** and the five examples are expressible. The next
risk is not "can we describe a component" but "can we resolve expressions
correctly and then generate code from this description" — OPEN-1 and OPEN-2.
Those are M03's job.

**Exit status (2026-11-08):** with the `condition` negative case in place, all
six execution-plan §1a criteria are met, so the M02 exit is recorded as met for
the feasibility scope only (see the [progress ledger](./alpha16-18-progress.md)
§3/§4). This record does not claim M03+, G1/G2 or any runtime/browser evidence.
