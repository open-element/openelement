# Alpha16–18 architecture audit and compatibility boundary

Date: 2026-11-03. Baseline: `4f1f2001b24909086f7e7efe9e5016d48d615c91`
(alpha.15 source line). Status: **READ-ONLY AUDIT**. No behaviour, dependency,
export, test or version was changed to produce it.

Method: the compiler, runtime, protocol and router source was read directly;
each claim below cites the file and line the claim comes from. Claims taken from
a separate read-only audit rather than first-hand reading are marked
**[audit]** and should be re-checked before they justify a deletion. This is not
an exhaustive line-by-line review: the coverage boundary is §6.

## 1. What alpha.15 actually implements

| Capability | Current implementation | Reuse | Must change for the target | Evidence |
| --- | --- | --- | --- | --- |
| TSX parsing | TypeScript compiler API behind a `ParserPort`; a second direct `ts.createSourceFile` in module analysis | High | Be honest about being TypeScript-bound; unify parse policy where duplicated, not by inventing a backend-neutral AST | `semantic-core/parse-module.ts:23-53`, `module-analysis.ts:550-561` |
| Semantic analysis | `analyzeCompiledModule` (module/class shape), intrinsic binding model | High | Extend to function components and JSX values; class-only assumptions must be isolated | `compile.ts:19-33,134-139` |
| Lowering | `Lowering` walks admitted JSX into Part Program nodes | High | Add lowering for value-position JSX, inline tracked expressions, repeatable children | `lower-program.ts:450-534,818-820` |
| Authoring grammar | Single `return` of one JSX expression; single intrinsic root; no fragments at root; no spread attributes | **Medium** | This is the wall the owner rejects: fragments, multi-root, local statements and arbitrary expressions must be admitted incrementally | `compile.ts:141-152`, `lower-program.ts:450-465,529-536` |
| Program IR | Part Program v2: roots, elements, text, Parts, when/each Blocks, locations, source map | High | Keep as one compiler contract; generated codegen is a second output behind the same semantics | `protocol/part-program.ts:22-47,90-101` |
| Module emission | Generated module carries `__partProgram` JSON + metadata + handler forwarding | High as a bridge, **low as the target** | The target replaces a generic browser program walk with generated mount/claim/update/dispose; the emitted-module shape changes | `emit-module.ts:295,354-356,528` |
| Browser execution | Fixed executors replay the typed program; `fresh-dom.ts` mounts, `hydrate.ts` claims | High (behaviour), Medium (structure) | Direct codegen replaces the generic walk; claim fidelity, pre-upgrade replay, bounded recovery must be preserved | `runtime/fresh-dom.ts:40-70`, `runtime/hydrate.ts:867`, `kernel.ts:1-27` |
| Ownership | `LifetimeScope` tree: parent/child, LIFO cleanups, per-scope error isolation, idempotent dispose, range cleanups | **Directly reusable** | This is already the Owner primitive the hostless model needs | `compiled/lifetime-scope.ts:4-26,28-30,55-69,83-109` |
| Region identity | `WhenBlock`/`EachBlock` with `EachEntry { key, scope, nodes, item, itemBox }` and `byKey` | **Directly reusable** | Generalise "each entry" to "component instance"; keep keyed reuse semantics | `runtime/blocks.ts:119-152,246,303,356,599` |
| Live value on keyed reuse | `itemBox` read at dispatch time so a reused entry keeps current data and handlers | **Directly reusable pattern** | Same idea one level up: props replacement | `runtime/blocks.ts:175-190,204-224` |
| Signals | `@preact/signals-core` under an internal conformance contract | High | Expose tracked props and inline expression tracking on top of it | `packages/element/package.json:52` |
| SSR | Server serializer produces DSD; server function components compose by direct call into `__h/__t` | High | Reuse as the string host for the recipe model; do not rewrite SSR for symmetry | `compiled/server/index.ts:674-681`, `semantic-core/server-component.ts:1-33` |
| JSX at runtime | **Nothing.** `JSX.Element` is uninhabited; every factory throws `JSX_OUTSIDE_COMPILER` | n/a | A runtime representation must be introduced for value-position JSX — the core of Alpha16 | `jsx-runtime.ts:20-42,44-53` |
| Component composition | Class components compose through CE tags; server functions compose by direct call | Medium | Hostless function composition with logical owner + region; CE stays the native export boundary | `lower-program.ts:486-504`, `server-component.ts:5-33` |
| Diagnostics | `OEC####` codes with source locations, one envelope (#1612) | High | New grammar needs new codes; the transport stays | `compiler-diagnostics.ts`, `protocol/diagnostics.ts` |
| Router integration | Framework Mode consumes compiled components; explicit renderer selection (`native`/`lit`) | High | Only the `lit` arm retires later; the native arm is the target | `packages/router/package.json:35-56` |
| Lit renderer | First-party Lit page renderer, `./lit` and `./lit-ssr` subpaths, fixture + E2E | Retires (separate product decision) | Retirement is blocked on native equivalence evidence; not part of this roadmap | `packages/router/src/lit.ts:63-83`, `tests/fixtures/router-lit-framework/README.md:3-12` |
| Failure discipline | Missing program fails closed; JSX outside compiler fails closed; mismatch is bounded, never a silent whole-page rebuild | High | Extend the same discipline to recipes, ownership and props | `open-element-implementation.ts:24-26,72-79`, `runtime/hydrate.ts:76-93` |

## 2. The gap this round must close

The repository can compile *one class component with a single-root render*, and
it can compose *server* functions eagerly into HTML. It cannot represent a JSX
value, cannot insert one twice, cannot project children twice, and cannot run a
component without a DOM host.

That gap is not a matter of relaxing a check. `jsx-runtime.ts` proves the point:
today a JSX expression in value position is **outside the language** the
compiler accepts, and if it escaped to runtime it would throw. Introducing
reusable JSX values therefore adds a runtime concept, not a flag.

The proposed model — compiler-emitted mount recipes, props as tracked getters,
owner-per-insertion — is specified in
[JSX values and repeatable children](./jsx-value-and-children-model.md). It is
built entirely from primitives that already exist (`LifetimeScope.child`,
`addRangeCleanup`, `EachBlock.byKey`, `itemBox`), which is why it is the first
candidate worth prototyping.

## 3. Historical compatibility audit

Nothing here authorises deletion. This table records, for each historical
capability, whether the target model keeps it, migrates it, or eventually
retires it — and what evidence would be required.

| Asset | Disposition | Condition |
| --- | --- | --- |
| Part Program v2 IR and validators | **Keep** | Still the compiler's structural contract; generated codegen consumes the same facts |
| Fixed Part executors (text/attr/prop/event/ref/class/style) | **Keep during migration, retire later** | Retire only with graph evidence that the old path is unreachable and behavioural coverage is complete. Alpha16 release requires that evidence; a missing slice delays the release, it does not lower the bar |
| Block builders (`when`, `each`) and `byKey` | **Keep, generalise** | The recipe model reuses the entry lifecycle rather than duplicating it |
| `LifetimeScope` | **Keep** | Becomes the owner primitive for hostless instances |
| `itemBox` live-value pattern | **Keep, promote** | Becomes props replacement for components |
| Class authoring API (`@element`, `OpenElement`) | **Migrate, not delete** | Existing authors keep working through the shared backend; retirement is a separate decision with consumer evidence and no fixed version |
| Server function components (eager string composition) | **Keep, extend** | Alpha16 extends locals/async/composition; it does not replace them with client instances |
| SSR serializer and DSD output | **Keep** | The string host for recipes; no full server rewrite required |
| Claim/hydrate machinery (markers, pre-upgrade replay, bounded recovery, source maps) | **Keep** | The generated path must preserve all of it; claim fidelity is a gate, not a nice-to-have |
| Signals engine | **Keep** | One engine; tracked props and inline expressions ride on it |
| Router Framework Mode, loaders/actions/forms, navigation | **Keep** | The application layer is not rewritten by this roadmap |
| Lit renderer | **Retire, separately** | Blocked on a native replacement with consumer evidence and an ADR-level migration announcement (ADR-0152 amendment already records the decision; the window is OPEN) |
| Third-party WC / Lit WC interop | **Keep (client-only)** | No automatic SSR promise; foreign DSD hydration is not claimed |
| Compiler semantic core + diagnostics | **Keep, extend** | New grammar lands new codes; the envelope transport stays |
| Published packages and release evidence | **Keep** | No version change, no publication, no rewriting of historical evidence |

Two boundaries must not blur:

- "Retire the old executor" and "retire the class authoring API" are different
  decisions with different evidence.
- "Start Lit retirement" (already decided) and "Lit is gone" (not decided, no
  window) are different states.

## 4. Constraints the implementation inherits

These are not obstacles to remove; they are the properties that make the
existing product trustworthy, and each one has a test today:

1. A component without a compiled program fails closed.
2. JSX reaching the runtime outside the compiler fails closed.
3. Hydration mismatch is attributed to a bounded owner and never silently
   becomes a full-page rebuild.
4. Pre-upgrade user input, focus and selection survive activation.
5. Disposal is idempotent and one throwing cleanup does not stop the rest.
6. Server-only code cannot reach a client graph.
7. Unsafe URL/attribute sinks are screened at the same single source of truth
   the server serializer uses.
8. Published artifacts are qualified from packed consumers, not from workspace
   aliases.

Any Alpha16 slice that weakens one of these to make a demo pass is a failure of
the slice, not a trade-off.

## 5. Where the current design will resist the target

Honest list of friction points, each of which becomes a risk entry:

1. **Class-shaped pipeline.** `analyzeCompiledModule` expects a decorated class
   with a `render()` method (`compile.ts:134-152`). Function components need a
   second admission path, not a rewrite of this one.
2. **Single-root assumption.** Root must be one intrinsic element
   (`lower-program.ts:450-465`). Multi-root/fragment roots are the first grammar
   change and they are not cosmetic: claim anchors depend on it.
3. **Program-as-data emission.** The module currently ships JSON
   (`emit-module.ts:295`). Generated code emission is a different emitter with a
   different size profile; it must be measured, not assumed smaller.
4. **Server composition is eager.** `server-component.ts` calls the imported
   function directly, so server-side recipes need a string host that preserves
   instance *order* for claim — a protocol change, not only a code change.
5. **Claim markers are program-indexed.** Repeated insertion multiplies
   instances per authored site; the marker scheme must encode insertion order
   (§ model note 7).
6. **Props do not exist as a runtime concept.** The facade binds signals to
   element properties (`facade-host.ts`); tracked props are new.

## 6. Coverage and confidence

Directly read for this audit: compiler pipeline and grammar boundaries; module
emission shape; JSX runtime guard; lifetime scope; block/entry/item-box
structure; hydration entry and mismatch attribution types; element facade
lifecycle; protocol program shape; router package boundaries and the first-party
Lit entry.

Read only through a separate read-only audit (**[audit]**, not re-verified here):
some Lit renderer interior branches, packed-consumer gate composition, and parts
of the test matrix.

Not covered: every line of `analyze-module.ts` (1100 lines), `lower-program.ts`
(1689 lines), the hydration implementation in full, router internals beyond the
Lit boundary, and the E2E/browser suites. No test, build, browser or packed run
was executed for this document. Where this audit says "always" or "never", it
means "in the code paths read" — not a proof over the whole tree.

## 7. Conclusion

The repository already owns the hard parts of a hostless model: an owner tree
with disciplined disposal, a region identity model with keyed reuse, a live-value
pattern for reused entries, a claim path with bounded recovery, and a compiler
that already produces source-located diagnostics. What it does not own is a
runtime representation for JSX, and that is exactly where Alpha16 must start.

The right next move is therefore not a compiler rewrite. It is one compiler
grammar extension (value-position JSX + multi-root) plus one runtime primitive
(mount recipe + insertion owner), proven on a stateful list across SSR, claim,
update and dispose — in that order.

## 8. Corroboration from the compiler-lane audit

A separate read-only compiler audit independently reached the same conclusions
and added three details worth recording. They are reported evidence, not first
hand re-verified here:

1. **There is exactly one real "generate a function body" channel today**: the
   alpha15 server function component lane emits `__h/__t/__ssr` string
   construction (`server-component.ts:442`, `server.ts:108-197`). It is not DOM
   codegen, produces no Part Program, and registers no element. Any claim that
   the repository "already generates browser code" is wrong.
2. **Diagnostic codes are string literals at throw sites**; the reference
   catalogue is produced by two generators and two gates, and the generator's
   source scan does not cover `style-imports.ts` (OEC9029) or
   `server-component.ts` (`generate-error-reference.ts:53-58`). Widening the
   grammar multiplies codes, so the catalogue coverage gap becomes a real risk
   for authors rather than a tidiness issue.
3. **The parse seam is no longer described as backend-neutral** — the current
   header says replacing the parser requires auditing every consumer, AST
   assumption, source position and diagnostic (`parse-module.ts:1-13`). This
   supports the audit's earlier point: the honest statement is
   "TypeScript-bound with a single parse helper", not "swap the backend by
   editing one file".
