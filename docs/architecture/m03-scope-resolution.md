# M03-A — Lexical scope resolution

Date: 2026-11-03. Milestone: **Alpha16a M03-A (design only)**. Base:
`017bd3e8775e8d74fc8778b6321bbbe5d74486c6` (M02 merged).

Status: **DESIGN PROPOSAL — NOT IMPLEMENTED.** No codegen, no runtime, no public
API, no ABI. Every claim below is marked as *measured*, *read from source*, or
*hypothesis* (unverified).

## 1. Why this exists

M02's spike resolves bindings with a **flat name table**:

```ts
// packages/compiler/src/internal/compiler/semantic-ir/build.ts (M02)
interface Scope { readonly bindings: Map<string, IrBindingKind>; }
```

That is enough to prove the IR shape, and it is wrong for a real compiler:

- a shadowed `value` overwrites the outer binding instead of nesting;
- destructuring (`const { name } = props`) declares no binding at all;
- closures capture whatever the table holds at walk time;
- imports and aliases are not modelled;
- the table cannot say *which* declaration a read refers to, which is exactly
  what M05 codegen needs to emit the right identifier.

Scope resolution is the first thing M03 must decide, because **every later
artefact keys off binding identity**: the IR's reads, expression captures, and
codegen's variable naming.

## 2. What the repository does today (read from source)

| Fact | Evidence |
| --- | --- |
| The compiler parses with `ts.createSourceFile` and separately runs `ts.transpileModule` for syntax diagnostics | `semantic-core/parse-module.ts:35,43` |
| No semantic type checker is used in the compile path: `ts.createProgram` appears only in the emitted-module verification boundary | `semantic-core/type-check.ts:143`; no `getTypeChecker` anywhere in `packages/compiler/src` |
| Intrinsic bindings are resolved by **import provenance** (module specifier + imported name + alias), not by type | `semantic-core/module-analysis.ts:74-158` (`createModuleIntrinsicBindings`, `isCompileTimeOnlyIntrinsic`) |
| The semantic core is forbidden ambient state and file-system access; hosts hand it sources | ADR-0148; `server-component.ts` `resolveModule` callback |
| The existing class grammar never needed scope: it only admits `this.<field>` and one-action handlers | `lower-program.ts` sink rules |

Consequence: today the compiler is **syntax-only**. Any design that requires a
`ts.Program` for correctness must justify the cost and must not break the
"no ambient state" boundary.

## 3. Requirements

1. **Stable binding identity** — a read resolves to a declaration, not a name.
2. **Shadowing** — nearest enclosing declaration wins; nested scopes nest.
3. **Destructuring** — object/array patterns, renaming, defaults, rest.
4. **Nested closures** — captures resolve to ancestor declarations.
5. **Function parameters** — including defaults that reference earlier params.
6. **Component props** — the props parameter is an implicit, typed scope.
7. **Imports and aliases** — `import { a as b }`, default, namespace, type-only.
8. **Read modes** — direct read, captured read, handler read, JSX inline read.
9. **Reactivity classification** — which reads are reactive and *when* they are
   read (that timing is the semantics, not the name).
10. **Host independence** — resolution must not read the filesystem; cross-module
    binding facts arrive through the host's resolver.

## 4. Candidate architectures

### A1 — TypeScript checker over a full `ts.Program`

Use `ts.createProgram`, then `checker.getSymbolAtLocation` / `getTypeAtLocation`.

- Fidelity: highest (real symbol table, real types, cross-module).
- Cost: building a program pulls the whole module graph; the compile path is
  currently one file in, one string out. `type-check.ts` already shows the shape:
  a custom `CompilerHost`, virtual files, `noEmit`, and a caller-supplied
  resolution map.
- Risk: the semantic core would need a program per build; incremental memory and
  determinism become the host's problem; and the IR must never store a
  `ts.Symbol` (it is mutable, tied to a program instance, and not serializable).

### A2 — Self-built syntax-only scope resolver

Walk the `ts.SourceFile` the compiler already has, maintain a scope stack, build
declarations from syntax, resolve reads lexically.

- Fidelity: sufficient for TSX component code (no type-directed resolution).
- Cost: one extra AST walk; no program, no global state.
- Limits: cannot answer "is this import a signal?" when the import comes from a
  package the host did not resolve; cannot resolve `enum`/namespace merging; no
  type information for diagnostic quality.

### A3 — Hybrid: syntax resolver first, checker only for ambiguity

A2 does the work; the host may additionally supply a **binding classifier** (a
map from import specifier → binding kind, already how intrinsics are resolved),
and A1 is used *only* when a rule needs type information and the host opted in.

- Fidelity: A2 for everything local; classifier for imports; checker optional.
- Cost: A2 cost always, A1 cost only on opt-in.
- Risk: two paths that can disagree → mitigated by making the checker strictly
  advisory and never authoritative over the IR.

### A4 — Language service / LSP (`ts.createLanguageService`)

Rejected: incremental state, latency, and a persistent process model are far
outside a per-module pure function. It solves editor problems, not compile-time
binding identity.

### Comparison

| Criterion | A1 full program | A2 syntax resolver | A3 hybrid (recommended) | A4 language service |
| --- | --- | --- | --- | --- |
| Correct for local scope semantics | yes | yes | yes | yes |
| Cross-module binding kind | yes | only via host classifier | via host classifier | yes |
| Host-independent purity | needs a program host | yes | yes | no |
| Cost per module | whole-graph | one walk | one walk + optional | tainted by daemon |
| Deterministic output | host-dependent | yes | yes | no |
| Incremental friendly | heavy | trivial (per module) | trivial + classifier cache | n/a |
| Fits the current compile entry (string in, string out) | poor | yes | yes | no |
| Risk of IR depending on TS internals | high | low | low (advisory only) | high |

**Recommendation: A3.** The resolver is syntax-based and pure; the host supplies
binding classifiers for imports; a checker may be consulted for advisory
diagnostics but its symbols never enter the IR.

## 5. Binding identity model (the core artefact)

```ts
type BindingKind = 'local' | 'signal' | 'computed' | 'prop' | 'import' | 'component' | 'unknown';

interface BindingId {
  /** Module the declaration lives in (host-supplied id, not a path). */
  readonly module: string;
  /** Deterministic position of the declaration within the module's scope tree. */
  readonly path: string;      // e.g. "0.2.1" — scope index chain
  readonly name: string;
  readonly kind: BindingKind;
}
```

Why a path and not a byte offset: an offset changes on every edit above it, which
would invalidate cached expression captures and make incremental builds thrash.
A scope-chain path is stable under edits *inside* a scope body and changes only
when the scope structure changes — which is exactly when re-resolution is
required anyway.

Why not a `ts.Symbol`: it is bound to a program instance, mutable, and not
serializable; storing one would silently couple the IR to a specific program.

**Hypothesis to verify in M03 implementation:** scope-chain paths remain stable
enough for incremental compiles in practice; if they do not, switch to a content
hash of `(name, kind, declaration shape)` with the path retained for diagnostics.

## 6. Scope model

| Scope | Declares | Notes |
| --- | --- | --- |
| module | imports, top-level `const`/`function`/`class` | imports carry a host-provided classifier |
| component function params | props parameter | props is `prop` kind; a destructured props param declares each property as `prop` |
| function body | `const`/`let`/`var`/`function`/`class` | block scoping for `let`/`const` |
| block (if/for/while/try/catch) | block-scoped declarations | `catch` introduces its own binding |
| arrow / nested function | params + body | captures resolve outward |
| JSX callback (`.map(item => …)`) | the mapper parameter | a per-entry value, never reactive by itself |

Resolution rule: walk scopes inward-out; first declaration of the name wins.
A read that resolves to no declaration is `unknown` and produces a diagnostic
(`OEIR_UNRESOLVED_BINDING`) rather than silently becoming a local.

### Destructuring

`const { a, b: renamed, c = 1, ...rest } = props` declares `a`, `renamed`,
`c`, `rest`. Object patterns **read the source expression once** at declaration
time; the declared names are ordinary locals (snapshots), not props. This is the
same rule TSX-03 already states for `const { value } = props`.

Array patterns behave the same: `const [first, second] = items`.

### Closures

A nested function captures ancestor bindings. Capture is a property of the read,
not of the declaration: the same `BindingId` can be read directly in one place
and captured in another. Codegen needs the capture list, so the IR records for
each expression **which bindings it reads** (already true in M02) and M03 must
also record **whether the read crosses a function boundary** (new).

### Props and imports

- Props: the props parameter is a `prop` binding; property reads on it
  (`props.value`) are prop reads. Destructuring it at the top is a snapshot.
- Imports: kind comes from the host classifier (module specifier + imported name,
  alias-resolved) — the same proven mechanism used for intrinsics today
  (`module-analysis.ts:74-158`). An import with no classifier is `unknown` and
  reading it in a tracked position is an error, not a guess.

## 7. Read modes and reactivity classification

| Read site | Mode | Reactive? |
| --- | --- | --- |
| setup statement (`const x = s.value`) | direct | no — snapshot at setup |
| JSX dynamic text / attribute | inline | yes if it reads `signal`, `computed` or `prop` |
| nested function body | captured | depends on the same rule; the read happens when called |
| event handler | handler | **not tracked** (dispatch-time read), never counted as a dependency |
| list mapper body | per-entry | the mapper parameter is a local; reads of outer signals stay reactive |
| `computed(() => …)` body | derivation | yes — the body's reads are dependencies |

The classification is a function of `(read site kind, resolved binding kind)`, not
of the name. That is the property M02's flat table could not provide.

## 8. Cost and compatibility

**Measured / read from source:**

- today's parse path parses **twice**: `createSourceFile` for the AST and
  `transpileModule` for syntax diagnostics (`parse-module.ts:35,43`);
- `ts.createProgram` exists only in `type-check.ts`, behind an explicit
  "verification boundary" and a caller-supplied host.

**Hypothesis (needs measurement in M03):**

- one extra AST walk costs a small fraction of parse time;
- avoiding the second `transpileModule` pass (using `parseDiagnostics` off the
  `SourceFile`) would repay the resolver's cost — worth measuring, but it is a
  behaviour change and therefore out of scope for M03 design approval.

**Compatibility:** the resolver is a pure function of `(sourceFile, hostFacts)`.
It does not need the filesystem, does not need a program, and can run inside the
existing `buildSemanticIr` call. Nothing in Alpha15 changes.

## 9. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Scope-path instability under edits | incremental rebuild invalidation | measure; fall back to declaration-shape hash |
| Import classifier gaps | `unknown` bindings in tracked positions | fail closed with a coded diagnostic; host can extend the classifier |
| Resolver and TS disagree on edge semantics (e.g. `var` hoisting) | wrong binding identity | mirror TS rules explicitly; conformance tests against `ts` for cases in the corpus |
| Checker used as authority by accident | IR coupled to a program | hard rule: checker output is advisory only, never written into the IR |
| Two code paths (syntax vs checker) disagree | silent inconsistency | the IR has exactly one source of truth; checker only adds diagnostics |

## 10. Acceptance matrix (for the M03 implementation, not this document)

| Case | Expected |
| --- | --- |
| shadowed local in nested block | read resolves to the inner declaration |
| destructured props (rename/default/rest) | each name is a distinct binding; snapshots |
| array destructuring | each element binding distinct |
| closure capturing an outer signal | read is captured; capture list on the expression |
| nested closures two levels deep | resolves to the outermost declaration |
| param default referencing an earlier param | resolves to the earlier binding |
| import alias (`a as b`) | `b` resolves to the import binding, classifier kind kept |
| namespace import member read | member read is `unknown` unless classified |
| JSX `.map(item => …)` parameter | per-entry local binding, not reactive |
| handler reading a signal | handler read; not a dependency |
| unresolved identifier in tracked position | `OEIR_UNRESOLVED_BINDING` diagnostic with span |
| class component (Alpha15 path) | untouched — resolver not on that path |

## 11. Impact on M04 / M05

- **M04** (ownership/recipes) needs capture lists to know what a recipe closes
  over; the resolver supplies them.
- **M05** (codegen) needs concrete identifiers; `BindingId` is what the emitter
  maps to generated variable names. If `BindingId` is unstable, every emitted
  name churns and diffs become unreadable.
- Neither milestone may depend on a `ts.Symbol`.

## 12. Explicitly not decided here

- Whether the second parse pass is removed (behaviour change, separate decision).
- Whether a checker is ever enabled by default.
- Incremental compilation strategy (M03 only defines stability requirements).
