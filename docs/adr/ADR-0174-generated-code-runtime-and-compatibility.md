# ADR-0174: Generated code, shared runtime and compatibility

- Status: ACCEPTED / AMENDED (2026-11-03, slice prerequisites; fourth-pass Part Program and class-authoring retirement approved; implementation pending)
- Amends: ADR-0143, ADR-0148 and principle P2
- Related: ADR-0158, ADR-0159, ADR-0171, ADR-0173

## Decision and current state

Generate browser mount, claim, update and dispose code, rather than shipping a
generic Part opcode execution loop. Keep one execution foundation for functions
and compatible classes, one Signals engine and one owner per DOM region. This
accepts a direction, not implementation evidence: new codegen, size attribution,
component slices and release qualification are **NOT RUN**. Existing Part Program
behavior remains current until qualified replacement. No ABI, helper signature,
wire encoding or package metadata format is frozen by this document.

## Three contracts, not one executable artifact

1. **Compile-time semantic/structural IR** supports analysis, lowering and
   generation. Do not deliver it as a generic browser-interpreted program.
   Servers may retain suitable serialization IR; no full server rewrite is
   required merely for symmetry.
2. **Generated-module ABI** defines calls, capabilities and compatibility between
   generated modules and shared helpers. Executable code need not pretend to be
   serializable data.
3. **HTML/claim/stream wire** carries location markers, permitted seed data,
   resources and deployment identity. It does not serialize arbitrary closures,
   functions, DOM nodes or complete Signals graphs.

Static templates, location markers, necessary data structures and shared
helpers are permitted. The prohibition targets generic interpretation, not all
data. There is no VNode tree or runtime JSX fallback. Unsupported structures
fail with source-located diagnostics rather than invoking another renderer.

The bundler-neutral semantic core owns author semantics, lowering, identity and
diagnostics. It must not import Vite/Rollup, routing/SSG/deployment, ambient
network/time or mutable global build state. Integration owns resolution, module
graphs, scheduling, caching, HMR, resources, bundling and map composition, not
language semantics. Public compiler packaging remains as recorded in the
2026-10-11 ADR-0148 addendum.

## Necessary runtime, cost and ownership

Identity, regions, Signals, events, cleanup, CE adaptation and bounded recovery
may use shared helpers. Each has one owner, behavior tests, byte attribution
and a retirement condition when no longer needed. P2 becomes build-time first,
with minimal justified runtime, not an impossible claim that no runtime exists.
Measure generated code plus helpers in the full reachable page closure;
relocating bytes must not manufacture a gain. Existing runtime, reference island
and home budgets remain. Codegen is not inherently smaller or faster.

Component update, navigation morph and stream installation cannot concurrently
write the same region. Register actual implementation seams and consumer-form
tests when they land; this decision does not invent a second metadata registry.
Preserve claim fidelity, form input, focus/selection, pre-activation events,
styles, refs, diagnostics, cleanup and bounded recovery through replacement.
The old generic client executor retires only with coverage and qualification;
Alpha16 release requires graph evidence that it is unreachable. Author-class
migration follows ADR-0173 separately.

## Compatibility and independent distribution

Reject incompatible generated ABI and mixed artifacts early with actionable
package/component, expected/actual capability and source diagnostics. ABI
compatibility and deployment build identity are separate checks. Rollback must
match server and client, not replace one side alone.

Start distribution qualification with library-side precompilation: generated
server/client entries, real declarations, relocatable CSS/resources and minimal
metadata consumed from a tarball by a fresh application without monorepo aliases
or library TSX. The application selects entries, links resources and bundles;
the initial supported mode is one validated mode, not arbitrary dependency TSX
recompilation. Check missing entries, server code in client graphs, prop/Children
type errors, missing/duplicated CSS, ABI mismatch, absent sources and build skew.
Two physical runtime/Signals copies crossing ownership boundaries must resolve
to one instance or reject clearly; equal versions do not prove singleton identity.

The distribution schema/version ranges remain unselected. A later consumer-backed
contract must freeze their actual format; this record only accepts requirements.
Internal module consumption and explicit CE exports need distinct proof, including
ordinary HTML/foreign-framework properties/events/slots/forms/SSR/claim for CE.

## Safety and streaming preservation

Publish allowlists, content/serialization safety and request isolation are
independent proofs (ADR-0171). Keep existing route/field streaming regression
coverage under ADR-0158/0159. Their current admission, HTTP commitment, nonce,
typed seeds, ownership, cancellation and bounded recovery are not broadened by
this backend change. Identity/marker/installer changes require migration and
rejection fixtures. Component defer remains separate Alpha18 qualification;
material wire changes require a successor decision before rollout.

## Amendment (2026-11-03): prerequisites and slice order

Use the [author candidate contract](../architecture/tsx-author-candidate-contract.md)
before expanding codegen. A real leaf mount/update/dispose slice precedes related
owner/region structures; then retain the stateful hostless list, the same list's
SSR/claim/failure slice and the independent precompiled tarball consumer, in that
order of prerequisites. Begin the consumer slice early once the list foundation
exists, not after freezing ABI or completing all SSR work. Props replacement,
ordinary-local snapshots, JSX insertion ownership and renderability must be
explicit before their dependent extensions. Runtime guards for unknown values
are legitimate safety checks, not a generic renderer fallback.

G1 is running generated code; G2 is identity/owner evidence before related
expansion; G3 is author and consumer evidence before public API/default Starter.
These are the existing gates, not an extra generic approval process. Alpha16
owns the foundation and qualified old-executor retirement, Alpha17 Full TSX
productization, and Alpha18 bounded defer. If evidence fails, harden or narrow
the dependent scope rather than claiming completion. First-party Lit retirement
is the separate ADR-0152 product decision with its release window still OPEN;
it is neither accomplished nor versioned by this backend milestone. Current
Part execution, class APIs and alpha.15 Lit support are not removed here.

## Verification before expansion or freeze

Retain the stateful list, SSR/claim/failure and independent tarball slices from
ADR-0173. Validate exception-safe cleanup and initial byte attribution before
large executor replacement; validate related identity/owner/region structures
before expansion and stable ABI; validate public types, author examples and
consumers before API freeze/default-starter recommendation. Independent output
safety, server-only work and validated leaves need not wait for every slice.

Run old Part/Block behavior, mixed classes/functions, SSR/create/claim, styles,
refs/events/pre-activation and mismatch matrices. Prove compiler/Vite/server-only
code and retired executor are absent from browser graphs; use real packed
consumers and Chromium/Firefox/WebKit. Record full JS/CSS closure measurements,
including helper and duplicated generated code costs. Failed evidence blocks
its dependent expansion, not unrelated work. Do not weaken state, cleanup or
native guarantees to make a test green.

## Amendment (2026-11-03, owner-approved): Alpha16a / Alpha16b split

The owner approved splitting Alpha16 into two milestones. This amendment records
the split without amending the retirement gate itself.

**Alpha16a — internal compiler-native foundation.** Build the new execution
model, introduce the generated path, keep the existing generic executor for
capabilities not yet migrated, prove the leaf and stateful foundations, and
complete the applicable identity/ownership evidence. Alpha16a creates no public
version, tag, publication, Starter promise or release claim, and it is not a
licence to ship two execution models.

**Alpha16b — Alpha16 release qualification.** Complete migration of required
browser execution capabilities, generated mount/update/claim/disposal, the
class-authoring migration and retirement (no adapter — see the fourth-pass
amendment below), Router integration, packed-consumer and browser/server
qualification, and produce graph evidence that the old generic browser executor is
unreachable from every applicable production browser entry graph.

**The hard gate above is unchanged.** A formal Alpha16 release with the old
generic browser executor still reachable does not qualify. Alpha16a's existence
neither amends nor bypasses that requirement.

Scope clarification: the gate concerns the old generic **browser execution
path**. It does not require deleting the Part Program artifact, its validator,
its metadata, or the server-side serialization and streaming consumers that read
program data. `__partProgram` is a compiler **output** carrying the serializable
artifact; it is not the compiler's internal semantic IR, and it must not be
renamed or removed by this roadmap.

> **Correction (2026-11-03, fourth pass — approved):** the sentence above that
> "the gate … does not require deleting the Part Program artifact, its validator,
> its metadata" describes *the gate only*. The separately approved retirement
> policy (P-2/P-3/P-4) does require Part Program v2, `validatePartProgram`,
> `PART_PROGRAM_VERSION` and `__partProgram` to leave the **target production
> contract**, replaced by a narrow ABI. The gate and the retirement policy are two
> obligations; satisfying one does not satisfy the other. Server-private
> structures, SSR/streaming data, DSD, claim markers and security sinks are
> preserved.

Consumer migration is staged (owner-approved D-O2): the layer boundary between
compiler semantic IR, Part Program v2, the emitted `__partProgram` field, the
generated-module ABI and the HTML/claim/stream wire is defined first, and each
consumer migrates on evidence. No new ABI is frozen by this record.

**SUPERSEDED HISTORY (2026-11-03, D-O3).** Class authoring was to be retained
through a long-lived compatibility adapter on the shared backend; it was
compatibility infrastructure, not a second execution architecture, and no
retirement version was scheduled. The fourth-pass amendment below supersedes this:
the Class/Decorator authoring API retires in Alpha16b with **no adapter**, and the
2026-11-03 baseline of 219 in-tree files recorded as matching `@element(` is the
migration surface (a historical size metric, not a current count; its scan
predicate was not recorded, so it is not reproducible here, and it was not
re-verified by this revision; re-inventory at execution) with a per-file matrix
and capability/replacement inventory. See [ADR-0173](./ADR-0173-component-execution-and-composition.md).

## Superseding amendment (2026-11-03, fourth pass — APPROVED)

Status: **APPROVED 2026-11-03.** This supersedes the "keep the Part Program as a
transitional serialized artifact" reading of the D-O2 amendment above; the staging
discipline and the release gate remain in force.

The approved decision (2026-11-03) is that Part Program v2 ceases to be a
serialized browser execution protocol in the target contract: the compiler keeps a
compiler-owned Semantic IR, server and client backends render from it
independently, and the generated module carries a **narrow ABI**
(identity/registration, property and attribute metadata, style/scope metadata,
generated client and server entrypoints, build-time feature flags, ABI version and
build identity) instead of `__partProgram`. Under the same decision,
`validatePartProgram` and `PART_PROGRAM_VERSION` retire with the schema, and
`COMPILED_MODULE_ABI_VERSION` is superseded by the new ABI version.

At adoption, the Part Program still shipped and the ABI remained open. The
D-O2 staging discipline continued to govern the migration through packed-consumer
verification.

Alpha17 removed the serialized executor, its validator and version, and its
component exchange schema. Server JSX lowering retains its node and binding
types. Generated host markup still carries root and stylesheet markers.

Full analysis: fourth-pass reassessment (retired into Git history on 2026-11-10).

## Amendment (2026-11-08, owner ruling): Lit retirement executed

The 2026-11-03 prerequisites amendment above records first-party Lit retirement
as "the separate ADR-0152 product decision with its release window still OPEN"
and states that alpha.15 Lit support "is not removed here". That window fact is
superseded: the ADR-0152 2026-11-08 owner ruling executed the retirement
zero-compat — no last supported version, no compatibility period, no adapter and
no dual-renderer lane — merged as PR #1719 `ec09d444e`. The `./lit` and
`./lit-ssr` subpaths, their entry modules and the renderer branch are removed,
and `renderer: 'lit'` fails with an explicit migration error. Third-party Lit
Web Components remain a client-only interoperability use case, with no automatic
SSR and no openElement-managed Lit DSD hydration. The rest of this ADR — the
generated-code runtime direction, the release gate and the Alpha16a/Alpha16b
split — is unchanged.

## Prior art (P7.4)

Added 2026-11-15 to complete the P7 four-question record; no decision text changes.

The nearest mature precedent for "the compiler emits the component's runtime
code" is the compiled-framework generation this decision sits in. Four systems
bracket the design space; each is stated with the difference this record takes
deliberately.

1. **Marko** compiles every template into a registered component plus
   rendered-output code — the longest-running compiled-component precedent.
   Its current-generation compiler moves further in this record's direction,
   compiling to direct DOM instructions with no virtual DOM at runtime. The
   deliberate difference: Marko ships compiled modules and its component
   runtime as one coupled release surface, while this decision makes the
   generated-module ABI an explicit compatibility contract — version,
   capability and deployment build identity checked separately, incompatible
   or mixed artifacts rejected early with package/component and
   expected/actual diagnostics, and rollback that replaces server and client
   together. None of that compatibility discipline is part of Marko's model.
2. **Svelte** is the namesake precedent for P2's "the compiler pays": a
   component compiles to plain JS plus small shared helpers, and updates are
   generated assignments rather than a diff loop. The deliberate difference:
   Svelte inlines the update logic into each component, while this record
   keeps ONE shared runtime — one Signals engine, one owner per DOM region —
   and measures generated code plus helpers together in the full reachable
   page closure, so relocating bytes between generated output and helpers
   cannot manufacture a size gain. Svelte's hydration also re-runs compiled
   component code against server markup; it has no counterpart to claim
   fidelity (form input, focus/selection, pre-activation events, styles,
   refs) or to bounded recovery on claim failure.
3. **Solid** compiles JSX to fine-grained DOM creation over reactive
   computations, with components executing once and no virtual DOM — the same
   generated-mount shape as this decision. The deliberate difference: Solid's
   updates stay implicit inside a live reactive graph the runtime owns, while
   this record generates explicit update and dispose code per structure,
   refuses unsupported structures with source-located diagnostics instead of
   falling back to another renderer, and pairs the client path with a
   claim/stream wire contract the server render must satisfy.
4. **Qwik** is the nearest precedent for treating the HTML wire as a
   load-bearing serialization boundary: it serializes state and listener
   references into the HTML so a page resumes without hydration replay. The
   deliberate difference is the opposite serialization stance. Our wire
   carries location markers, permitted seed data, resources and deployment
   identity — never arbitrary closures, functions, DOM nodes or complete
   Signals graphs — and interactivity is restored by generated claim code
   re-binding to server-rendered DOM, not by deserializing a paused
   application. Qwik accepts a serialization schema constraint on application
   state; we accept an explicit claim protocol instead.

What no one of the four carries — and what this record adds deliberately — is
the three-contract split as separate, versioned surfaces: compiler-owned
semantic IR, a generated-module ABI qualified against independent tarball
consumers, and an HTML/claim/stream wire with its own admission rules. The
single-artifact alternatives (a generic opcode interpreter, a serialized
program the browser executes, a wire that ships the framework's closures) are
exactly the shapes this decision rejects.

## Amendment (2026-11-15): assertion memoization evidence and boundaries

PR #1804 added memoization of the full server assertion pass
(`packages/element/src/internal/compiled/server/shared.ts`: `assertedByProgram`
WeakMap keyed by the raw program object) and of descriptor normalization
(`packages/element/src/internal/compiled/generated-element/shell.ts`:
`normalizedByDescriptor`). The dispatch is unchanged — this amendment records
the evidence the change owes P2 and names the boundary it does not enforce.

### Evidence: the property is behavioral, not a counter

The original test seam exported `serverAssertionPassCount()` from the shipped
server module (`shared.ts`) and asserted an exact pass count. That export is
removed: a shipped module should not carry a diagnostics counter to prove a
property of its own call graph. The property is now proven behaviorally in
`packages/element/__tests__/compiled-server/compiled-server.test.ts`:

- after a successful assertion, mutating the SAME raw program into the
  duplicate-sink shape the validator rejects still returns the memoized IR
  without throwing — the validation surface was not re-walked;
- the same invalid shape under a NEW object identity throws (the control), so
  the absence of a throw above can only be the cache hit;
- a failing program re-validates and re-throws on every call (failures are not
  memoized).

The same shape is pinned for descriptors in
`packages/compiler/__tests__/semantic-ir/generated-element.properties.test.ts`.

### Boundary: mutated raw programs and descriptors are not detected

The raw object is a compile-time literal each generated module evaluates once;
no caller in this repository mutates it (the tree has no `program.x =` or
`descriptor.x =` writes, and `validatePartProgram` is read-only). It is NOT
frozen at runtime, and freezing is deliberately not added:

- the test-shaped mutation is on a **descriptor** (`normalizedByDescriptor`,
  `shell.ts`) while the assertion memo is on the **raw program**
  (`assertedByProgram`, `shared.ts`) — different objects, different WeakMaps;
- `Object.freeze` is shallow: `freeze(descriptor)` still permits
  `descriptor.properties.push(...)`, and the deep-freeze helper is private to
  `runtime-program.ts` and only applies to the JSON-round-tripped normalized
  copy;
- `__partProgram` is a generated-module export (`emit-module.ts`) read by
  `public-runtime.ts`; 4 normalize and 3 assert call sites share the object, so
  a freeze is a cross-server/client ABI change requiring consumer evidence —
  the opposite of this change set's "no new runtime surface" direction.

A mutated object therefore keeps its stale normalized result. That is a
documented limitation, not a contract: a fresh identity always validates from
scratch and fails closed.

### Emitted bytes: "verdicts unchanged" is not "bytes unchanged"

`entry-orchestrator.ts` serializes the admission plan into the generated entry
(`export const ssrAdmissionPlan = …`), and the plan carries each island's
`renderPath` and the `renderableTags` / `clientOnlyTags` sets. A half-empty
Tier-2 (CEM) scan therefore changes the emitted module, not only a diagnostic:

`packages/router/__tests__/tier2-emitted-bytes.test.ts` renders the same
package-island fixture twice — once with the `ssr-capable` classification, once
with an empty classification list — and prints the pair. At this head:

| Input | Emitted entry | Render path for the package island |
| --- | --- | --- |
| CEM full (`ssr-capable`) | 18114 bytes | `ssr+client` |
| CEM half-empty (`[]`) | 17424 bytes | `client-only` |

The +690-byte delta is the plan block plus the island's registration. The
"validation verdicts are unchanged" claim in the PR body is true only at the
verdict layer and only for a clean scan; it is not a byte-level claim, and the
Tier-2 skip is visible in the emitted artifact. Reproduce with:

```
./node_modules/.bin/vitest run --project router packages/router/__tests__/tier2-emitted-bytes.test.ts
```

This amendment does not change the admission contract: the classification is
an input to the existing plan, and a missing classification still resolves
through the documented fallback (`entry-descriptor.ts`: package islands with
`openElement.ssr !== true` degrade to `client-only`, which is the conservative
direction).
