# M03 review corrections register

Date: 2026-11-03. Scope: corrections applied to
[M03-A](./m03-scope-resolution.md) and [M03-B](./m03-expression-identity.md)
after owner review of PR #1706. Documentation only; no implementation.

## Resolved in this revision

| ID | Sev | Previous claim / gap | Correction | Where |
| --- | --- | --- | --- | --- |
| M03R-01 | P1 | `BindingId` carried `kind`, mixing identity with mutable classification | Split into `BindingId`, `ScopeId`, `DeclarationKind`, `ValueKind`, `BindingOrigin`; identity never contains classification | M03-A §3 |
| M03R-02 | P1 | Declaration merging / redeclaration undefined | Merge table: `var`/`function` merge, `let`/`const` duplicates diagnostic, import-vs-local conflict diagnostic, class self-name, namespace/enum unsupported | M03-A §3 |
| M03R-03 | P1 | Scope semantics incomplete (hoisting, catch, for, switch, class, NFE, parameter order, `this`/`arguments`/`super`/`new.target`) | Each construct specified with required behaviour **and** the diagnostic used when unsupported | M03-A §4 |
| M03R-04 | P1 | "Captured" conflated with "reactive dependency" | Four independent axes: reads, captures, dependencies, evaluation mode; worked examples include a handler that captures a signal without subscribing | M03-A §5 |
| M03R-05 | P1 | Intrinsic resolver described as if it were a general classifier | Explicit host classifier contract; aliases, namespace, default, type-only, shadowing, re-export, unresolved all specified | M03-A §6 |
| M03R-06 | P1 | Lowering route asserted without evidence | Three routes compared with source-verified API declarations; Route 3 (transform + public printer) recommended; Route 2 kept as differential oracle; Route 1 documented as fallback | M03-B §3 |
| M03R-07 | P1 | Source map strategy unspecified | Segmented print; reuse of `SourceMapSegmentBuilder` conventions; rebasing rule; Alpha15 parity requirement; no printer internals relied on | M03-B §5 |
| M03R-08 | P1 | Registry and IR conflated | Separate layers with different lifetimes; sidecar keyed by `ExprId`; neither serialized | M03-B §4 |
| M03R-09 | P1 | `ExprId` implied cross-build stability | Withdrawn: unique **within one compilation** only; incremental identity not required absent a consumer | M03-B §7 |
| M03R-10 | P1 | Nested JSX inside expressions undefined | Replacement by recipe reference, 1:1 at the same evaluation position, owner assigned at insertion, `setTextRange` for provenance; context-sensitive constructs fail closed with codes | M03-B §6 |
| M03R-11 | P2 | Milestones blurred (design vs implementation vs runtime vs codegen) | M03-D / M03-I / M04 / M05 separated; documentation approval does not complete M03 | M03-A §11, M03-B §11 |

## Deliberately still OPEN

| ID | Open question | Owner milestone | Why it is open |
| --- | --- | --- | --- |
| OPEN-1 | Erasure visitor completeness for the admitted corpus | M03-I | must be proven by the differential oracle, not asserted |
| OPEN-2 | Printer output stability across TypeScript versions | M03-I | version recorded; a bump is an invalidation event |
| OPEN-3 | Whether scope-path identity suffices for M03-I caches | M03-I | only one compilation matters now; content-addressing is a later decision |
| OPEN-4 | Route 3 vs Route 1 fallback if the erasure visitor proves underspecified | M03-I | decided by oracle results, not preference |
| OPEN-5 | Claim marker protocol | M06–M08 | explicitly out of M03 scope |

## What this register does not claim

- It does not claim either design is implemented.
- It does not claim the erasure visitor is correct; it claims the contract and
  the test that will decide it.
- It does not claim M03 is complete: M03 completes when M03-I's acceptance matrix
  is green.
