# M03-A — Lexical scope resolution

Date: 2026-11-03. Milestone: **Alpha16a M03-D (design)**. Base:
`017bd3e8775e8d74fc8778b6321bbbe5d74486c6` (M02 merged). Revised after owner
review (see [the corrections register](./m03-review-corrections.md)).

Status: **DESIGN PROPOSAL — NOT IMPLEMENTED.** No codegen, no runtime, no public
API, no ABI. Claims are marked *source-verified* (read from the repository or the
installed TypeScript declarations), *measured*, or *hypothesis*.

## 1. Why this exists

M02's spike resolves bindings with a flat name table
(`packages/compiler/src/internal/compiler/semantic-ir/build.ts`):

```ts
interface Scope { readonly bindings: Map<string, IrBindingKind>; }
```

It proves the IR shape and is wrong for a real compiler: shadowing overwrites
instead of nesting, destructuring declares nothing, closures capture whatever the
table holds at walk time, imports are not modelled, and a read cannot say *which*
declaration it refers to — the one fact M05 codegen needs.

## 2. What the repository does today (source-verified)

| Fact | Evidence |
| --- | --- |
| Parses with `ts.createSourceFile`, and separately runs `ts.transpileModule` for syntax diagnostics | `semantic-core/parse-module.ts:35,43` |
| No semantic checker in the compile path: `ts.createProgram` appears only in the emitted-module verification boundary, and there is no `getTypeChecker` in `packages/compiler/src` | `semantic-core/type-check.ts:143` |
| Intrinsic bindings resolve by **import provenance** (specifier + imported name + alias) | `semantic-core/module-analysis.ts:74-158` |
| The semantic core may not touch ambient state or the filesystem; hosts hand it sources | ADR-0148; `server-component.ts` `resolveModule` |
| The class grammar never needed scope (only `this.<field>` sinks) | `lower-program.ts` sink rules |

The compiler is syntax-only today. Any design needing a `ts.Program` for
correctness must justify the cost and preserve host independence.

## 3. Binding identity, split from classification (correction A)

The first draft put `kind` inside `BindingId`. That is wrong: classification is
**mutable** (a host may learn later that an import is a signal) while identity is
not. Five separate things:

```ts
/** Stable within one compilation. Not serialized. */
interface ScopeId {
  readonly moduleId: string;
  /** Scope-chain path: "0.2.1" = module → component → block 1. */
  readonly path: string;
}

interface BindingId {
  readonly scope: ScopeId;
  readonly name: string;
  /** Ordinal among declarations of this name in the scope (declaration merging). */
  readonly declarationOrder: number;
}

/** Syntactic form of the declaration. Immutable once built. */
type DeclarationKind =
  | 'var' | 'let' | 'const' | 'function' | 'class' | 'class-name'
  | 'param' | 'import' | 'catch';

/** Classification. Mutable; may be filled or refined by the host. */
type ValueKind = 'signal' | 'computed' | 'prop' | 'plain' | 'unknown';

/** Where the binding came from. */
type BindingOrigin =
  | { readonly form: 'local' }
  /**
   * ONLY the component's original props parameter. A variable obtained by
   * destructuring props is 'local' (a snapshot) and must not reuse this form.
   */
  | { readonly form: 'prop-param' }
  | { readonly form: 'import'; readonly specifier: string; readonly importedName: string | null }
  | { readonly form: 'builtin'; readonly name: string };

/** One syntactic declaration contributing to a binding. */
interface DeclarationRecord {
  readonly kind: DeclarationKind;
  readonly span: IrSpan;
  /** True when this record is the one that carries the initializer/value. */
  readonly initializing: boolean;
}

interface ResolvedBinding {
  readonly id: BindingId;
  /** Every declaration that merged into this binding — never a single kind. */
  readonly declarations: readonly DeclarationRecord[];
  readonly value: ValueKind;
  readonly origin: BindingOrigin;
  /** Authored declaration sites, for diagnostics (first is the canonical one). */
  readonly declarationSpan: IrSpan;
  /** Classification provenance: syntax-derived or host-supplied. */
  readonly classifiedBy: 'syntax' | 'host-classifier' | 'unresolved';
}
```

Rules:

- `BindingId` never contains `ValueKind`; reclassifying a binding must not change
  its identity (otherwise every cache and every emitted variable name churns).
- No serialized `BindingId` format is frozen. The IR stores resolved bindings
  inline; nothing is written to disk or to the browser.
- Scope paths are internal numbering; they are not a public contract either.

### Declaration merging and redeclaration

| Situation | Resolution |
| --- | --- |
| `var x` twice in one function scope | one binding, `declarationOrder` 0; second declaration is the same identity |
| `function f` twice (overloads) | one binding; signatures merge, implementations must be one |
| `var` + `function` same name in one scope | one binding; two `DeclarationRecord`s |
| `parameter` + `var` same name | one binding; parameter and var records both retained |
| `let`/`const` + `var` same name in one scope | **diagnostic** `OEIR_DECLARATION_CONFLICT` |
| `function` + `const`/`let` same name | **diagnostic** `OEIR_DECLARATION_CONFLICT` |
| `class` + `var` same name | **diagnostic** `OEIR_DECLARATION_CONFLICT` |
| two `function` declarations (overloads) | one binding, multiple `DeclarationRecord`s |
| `let`/`const` shadowing an outer name | new binding in the inner scope; outer untouched |
| duplicate `let`/`const` in the same scope | **diagnostic** `OEIR_DUPLICATE_DECLARATION` |
| `import x` + local `const x` in module scope | **diagnostic** `OEIR_IMPORT_CONFLICT` |
| parameter + `var` of the same name in the body | one binding (function-scoped var merges into the parameter scope) |
| class **declaration** | two bindings: an outer `class` binding in the enclosing scope, plus an inner `class-name` binding visible only inside the class body — so `static create() { return new Counter(); }` resolves to the inner one, and `new Counter()` outside resolves to the outer one |
| named **class expression** `const Factory = class Internal {}` | `Internal` is a `class-name` binding visible **only** inside the class body; `Factory` is an ordinary `const` |
| anonymous class expression `const F = class {}` | only the outer `const` binding |
| class field initializers / static blocks | may reference the inner `class-name` binding; not the outer one if not yet initialized |
| `extends` clause | evaluated in the **enclosing** scope (the inner name is not in scope for the heritage expression) |
| namespace / enum merging | **unsupported**, fail closed |

## 4. Lexical scope semantics (correction B)

Every construct below must either be implemented exactly or fail closed with a
coded diagnostic — silent divergence is the failure mode this section prevents.

| Construct | Required behaviour | If unsupported |
| --- | --- | --- |
| `var` | hoisted to the nearest function/module scope; visible before the declaration; no TDZ | — |
| `let` / `const` | block-scoped; TDZ from block entry to declaration | see §4.1 — TDZ is a **runtime** state, not a source-order rule |
| `catch (e)` | its own scope containing `e` | — |
| block function declaration (`if (b) { function f(){} }`) | **strict/module semantics: block-scoped**; it does not leak into the enclosing scope. Annex B script hoisting is **not** adopted | — |
| `for (let i …)` | fresh lexical environment per iteration; closures capture the per-iteration binding | — |
| `for (const x of …)` / `for…in` | same per-iteration rule | — |
| `switch` | one block scope shared by all cases | — |
| `class` | class name binding inside the class body; members do not leak | — |
| named function expression `(function f(){…})` | `f` bound inside the function's own scope only | — |
| parameters | initializers evaluate left-to-right; a default may reference **earlier** parameters, not body declarations | — |
| `this` | only meaningful inside a class member (class authoring is retiring) or a captured outer `this`; in a function component there is no `this` | **diagnostic** `OEIR_UNSUPPORTED_THIS` |
| `arguments` | not part of the component model | **diagnostic** `OEIR_UNSUPPORTED_ARGUMENTS` |
| `super` | no class inheritance in function components | **diagnostic** `OEIR_UNSUPPORTED_SUPER` |
| `new.target` | not part of the model | **diagnostic** `OEIR_UNSUPPORTED_NEW_TARGET` |
| `eval` / `with` | forbidden (dynamic scope defeats static resolution) | **diagnostic** `OEIR_DYNAMIC_SCOPE` |
| labels / `with`-like constructs | unsupported | fail closed |

Resolution rule: walk scopes inward-out, nearest declaration wins; a read that
resolves to nothing is `OEIR_UNRESOLVED_BINDING` with its span — never silently
treated as a local.

### 4.1 TDZ is a runtime state, not a source-order rule

A resolver must bind names lexically. It must **not** conclude "TDZ error" from the
fact that a read appears textually before the declaration:

```js
const read = () => value;   // closure created while `value` is still in TDZ
let value = 42;             // initialized later
read();                     // legal: the read happens after initialization
```

| Situation | Correct behaviour |
| --- | --- |
| direct read before initialization, in the same execution pass | keep TDZ behaviour; a static diagnostic is allowed only when the compiler can prove the read executes before initialization |
| closure created before initialization, invoked after | **legal**; resolves to the same `BindingId`; no diagnostic |
| closure invoked before initialization | legal to compile; the TDZ error is a **runtime** error, not a compile-time one |
| execution order not statically determinable | **no static TDZ diagnostic**; never guess from source position |

So the acceptance criterion is not "read before declaration is an error" but
"bindings resolve lexically, and a TDZ diagnostic is emitted only where the
compiler can prove the ordering". This matters because the batch-created closure
pattern above is ordinary JavaScript and must not be rejected.

### Destructuring (owner decision: JavaScript semantics, option A)

`const { a, b: renamed, c = 1, ...rest } = props` declares `a`, `renamed`, `c`,
`rest`; **each is an ordinary local snapshot**, consistent with TSX-03.

A destructured **props parameter** is the same operation, so it has the same
semantics:

```tsx
function C({ a, b }) { return <p>{a}/{b}</p>; }
```

`a` and `b` are **snapshots taken once during setup**. Reading them in a JSX slot
is *not* a tracked prop read, and a parent update does not change them. Only a
direct property read on the props object (`props.a`) is a tracked prop read.

This is deliberately less convenient than a reactive props proxy, and it is
required: the approved author contract promises ordinary JavaScript semantics for
destructuring. A resolver must not quietly upgrade a snapshot to a subscription in
order to make its own bookkeeping easier.

Consequences that follow, and are intentional:

- `function C({ a })` components do not re-render on prop change; the author must
  read `props.a` (or take the value via a signal) to get tracking.
- Diagnostics do not "helpfully" treat a destructured prop as reactive. If an
  author destructures and then expects updates, the failure is visible, not
  silently patched.
- If the project later wants reactive destructuring, that is a new **author-facing
  semantic** requiring an approved contract change, not a resolver detail.

Array patterns and nested patterns follow the same rule: destructuring produces
snapshots, at any depth.

`BindingOrigin: 'prop-param'` therefore applies **only** to the original props
object parameter. Every name produced by destructuring it is `form: 'local'`, and
a destructured name can never inherit the props object's reactive dependency.

## 5. Captures, reads, dependencies and evaluation mode are four axes (correction C)

The first draft conflated "captured" with "reactive dependency". They are
independent:

| Axis | Question | Recorded as |
| --- | --- | --- |
| **Identifier read** | which bindings does this expression read? | `reads: BindingId[]` |
| **Lexical capture** | does the read cross a function boundary (closure)? | `captures: BindingId[]` (subset of reads) |
| **Reactive dependency** | should this read subscribe at runtime? | `dependencies: BindingId[]` (subset of reads) |
| **Evaluation mode** | when does the expression run? | `mode: 'setup' \| 'inline' \| 'handler' \| 'derived' \| 'per-entry' \| 'key'` |

A handler may **capture** a signal without **subscribing** to it. A tracked JSX
expression typically does both. A setup read does neither.

Worked examples:

| Expression | Mode | Reads | Captures | Dependencies |
| --- | --- | --- | --- | --- |
| `const x = s.value` (statement) | setup | `s` | — | — (snapshot) |
| `{s.value}` (JSX child) | inline | `s` | — | `s` |
| `computed(() => s.value * 2)` | derived | `s` | `s` (inside the arrow) | `s` |
| `onClick={() => { s.value++ }}` | handler | `s` | `s` | — (no subscription) |
| `items.map(item => <Row item={item} />)` | per-entry | `items`, `item` | `item` (arrow param), `items` read outside | `items` if it is a tracked read |
| `key={item.id}` | key | `item` | — | — |

Rule: dependency selection depends on mode **and** value kind; capture selection
depends only on where the read occurs relative to the nearest function boundary.

## 6. Import classification contract (correction D)

The intrinsic resolver is an **import-provenance mechanism for one package's
compile-time intrinsics**; it is not a general binding classifier. The general
contract is host-supplied:

The classifier must not answer one question, because there are three different
ones. A factory (`signal`) and the value it produces (`count`) must not share a
kind:

```ts
/** What the imported symbol *is* — a role, not a value category. */
type SymbolRole = 'factory' | 'value' | 'type' | 'namespace' | 'unknown';

/** What a binding's value *is*, once it exists. */
type ValueKind = 'signal' | 'computed' | 'prop' | 'plain' | 'unknown';

/** What calling a factory produces, when the host knows it. */
interface FactoryResult {
  readonly call: 'signal' | 'computed' | 'unknown';
}

interface ImportClassifier {
  /** Role of the imported symbol (alias already resolved). */
  classifySymbol(moduleSpecifier: string, importedName: string | null): SymbolRole | undefined;
  /** Value kind of the binding, when the host knows it directly. */
  classifyValue(moduleSpecifier: string, importedName: string | null): ValueKind | undefined;
  /** Result kind of a factory call, when the host knows it. */
  classifyCall(moduleSpecifier: string, importedName: string | null): FactoryResult | undefined;
  /** Optional: classify a namespace member (`ns.x`). */
  classifyMember?(moduleSpecifier: string, memberName: string): SymbolRole | undefined;
}
```

Rules that follow:

| Situation | Resolution |
| --- | --- |
| `import { signal } from 'x'` → `signal` | `SymbolRole: 'factory'`; **not** `ValueKind: 'signal'` |
| `const count = signal(0)` | binding `count` gets `ValueKind: 'signal'` **from the call result**, not from the import |
| `import { count } from 'x'` where `x` exports an instance | `SymbolRole: 'value'` + `classifyValue` may say `'signal'` |
| `import * as ns` then `ns.x` | `classifyMember` may classify the member; otherwise `unknown` |
| re-export in an intermediate module | the classifier is asked about the **final specifier the author wrote**; re-export chains are the host's business, not the resolver's |
| nothing classified | `unknown` + `classifiedBy: 'unresolved'`, fails closed only where a kind is required |

Rules:

| Case | Behaviour |
| --- | --- |
| `import { signal } from 'x'` | alias resolved, then classified by `('x','signal')` |
| `import { signal as s }` | local name `s`, classification for `('x','signal')` |
| `import * as ns` | namespace binding; `ns.x` reads are `unknown` unless the host classifies member access |
| `import def from 'x'` | `importedName: null` (default import) |
| `import type { T }` / `type` specifiers | binding exists but is not a runtime value; reading it in a value position is a diagnostic |
| local declaration shadowing an import | the local wins inside its scope; the import stays untouched in module scope |
| re-export (`export { a } from`) | not a binding in this module; consumers classify through their own specifier |
| unresolved external import | `unknown` + `classifiedBy: 'unresolved'`; fails closed only where a kind is required |

### 6.1 How classifier results flow into the resolver

The three questions are chained, in this order; nothing is inferred from a name:

```ts
import * as Runtime from 'runtime';
const count = Runtime.signal(0);
```

| Step | Question | Answer source |
| --- | --- | --- |
| 1 | what is `Runtime`? | `classifySymbol('runtime', null)` → `namespace` |
| 2 | what is `Runtime.signal`? | `classifyMember('runtime', 'signal')` → `factory` |
| 3 | what does calling it produce? | `classifyCall('runtime', 'signal')` → `{ call: 'signal' }` |
| 4 | what is `count`? | the **call result** fixes `count.valueKind = 'signal'` |

For a direct import the same chain starts at `classifySymbol`:

| Step | Question | Answer source |
| --- | --- | --- |
| 1 | what is the imported `signal`? | `classifySymbol('x', 'signal')` → `factory` |
| 2 | what does calling it produce? | `classifyCall('x', 'signal')` → `{ call: 'signal' }` |
| 3 | what is `const count = signal(0)`? | `count.valueKind = 'signal'` |

Failure behaviour:

- if `classifyMember` is not implemented by the host, `Runtime.signal` is
  `unknown`; the call result is `unknown`; `count.valueKind` is `unknown`;
- `unknown` is only fatal where a kind is **required** (a tracked slot), and there
  the diagnostic says which specifier/member was unclassified;
- the resolver never guesses a factory from the name `signal` itself.

No full `ts.Program` is required for this: the classifier is a lookup the host
provides, exactly like today's intrinsic model. A checker may be consulted for
advisory diagnostics; its symbols never enter the IR.

## 7. Candidate architectures

| Criterion | A1 checker over full program | A2 syntax resolver | A3 hybrid (recommended) | A4 language service |
| --- | --- | --- | --- | --- |
| Local scope correctness | yes | yes | yes | yes |
| Cross-module binding kind | yes | via host classifier | via host classifier | yes |
| Host-independent purity | needs a program host | yes | yes | no |
| Cost per module | whole graph | one walk | one walk + optional advisory | daemon |
| Deterministic | host-dependent | yes | yes | no |
| Fits "string in, string out" | poor | yes | yes | no |
| IR couples to TS symbols | yes | no | no | yes |

**Recommendation: A3.** Syntax resolver authoritative; host classifier for imports;
checker advisory only.

## 8. Cost and compatibility

- *Source-verified:* today's parse path parses twice (`createSourceFile` +
  `transpileModule`, `parse-module.ts:35,43`).
- *Source-verified:* a program is created only in `type-check.ts` behind an
  explicit verification boundary.
- *Hypothesis (to measure in M03-I):* one extra AST walk is a small fraction of
  parse time; removing the duplicate `transpileModule` pass could repay it, but
  that is a behaviour change and not part of this design.

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Scope-path instability under edits | cache invalidation | acceptable: identity only needs to be stable **within one compilation** (see M03-B correction D); cross-build stability is not required |
| Host classifier gaps | `unknown` bindings | fail closed only where a kind is required |
| Resolver/TS divergence on edge semantics | wrong binding | mirror TS rules explicitly; differential tests against `ts` for the corpus |
| Checker used as authority | IR couples to a program | hard rule: advisory only |
| Declaration merging missed | two identities for one binding | the merge table in §3 is the contract |

## 10. Acceptance matrix (for M03-I)

| Case | Expected |
| --- | --- |
| shadowed local | resolves to the inner binding |
| `var` hoisting | read before declaration resolves to the same binding |
| `let` TDZ, direct read before initialization | keep runtime TDZ; static diagnostic only when the compiler can prove the ordering |
| closure created before initialization, invoked after | resolves to the same binding; **no diagnostic** |
| closure invoked before initialization | compiles; TDZ error is runtime, not compile-time |
| block function declaration | block-scoped; no Annex B leakage |
| class declaration | outer binding + inner `class-name` binding, both resolve |
| named class expression | inner name visible only inside the body |
| destructured props parameter | `local` origin, snapshot, not tracked |
| destructured props (rename/default/rest) | distinct bindings, **snapshot** semantics; not tracked in JSX |
| destructured props parameter `function C({a})` | `a` is a snapshot; `{a}` is not tracked; `{props.a}` is |
| a factory import used as a value (`signal`) | `SymbolRole: 'factory'`, not `ValueKind: 'signal'` |
| a call whose result is a signal (`const c = signal(0)`) | binding `c` is `ValueKind: 'signal'` |
| `let x` + `var x` same scope | `OEIR_DECLARATION_CONFLICT` |
| `function f` + `const f` | `OEIR_DECLARATION_CONFLICT` |
| `class C` + `var C` | `OEIR_DECLARATION_CONFLICT` |
| `var`/`function` merge | one binding, two declaration records retained |
| array destructuring | distinct bindings |
| `for (let i…)` closure | captures the per-iteration binding |
| catch parameter | own scope |
| switch block | one shared scope |
| named function expression | self-name bound inside only |
| parameter default referencing an earlier parameter | resolves to that parameter |
| import alias | local name bound, classifier keyed by original name |
| namespace member | `unknown` unless classified |
| type-only import read as value | diagnostic |
| duplicate `let` | diagnostic |
| import + local conflict | diagnostic |
| `this` / `arguments` / `super` / `new.target` / `eval` | coded fail-closed diagnostics |
| handler capturing a signal | capture yes, dependency no |
| computed body | capture and dependency both |
| unresolved identifier in a tracked slot | `OEIR_UNRESOLVED_BINDING` with span |

## 11. Milestone alignment (correction 4)

| Milestone | Scope |
| --- | --- |
| **M03-D** | this document set: design only (scope model, expression identity, contracts) |
| **M03-I** | frontend implementation: resolver + registry + differential tests against TypeScript; no codegen |
| **M04** | runtime primitives and ownership (recipes, lineage, disposal) |
| **M05** | first generated execution (mount/update/dispose) |

Documentation approval does **not** complete M03. M03 completes when M03-I's
acceptance matrix is green.

## 12. Impact on M04 / M05

- M04 needs captures and owner boundaries; the resolver supplies captures,
  recipes supply owners.
- M05 needs concrete identifiers; `BindingId` is what the emitter maps to
  generated variable names.
- Neither may depend on `ts.Symbol`.
