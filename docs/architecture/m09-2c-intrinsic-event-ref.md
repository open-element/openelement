---
status: active
topic: M09-2c intrinsic event/ref on the generated leaf
summary: The bounded intrinsic onClick/ref capability on the generated Native Custom Element — coded invalid-callable errors, client-only mount/claim phase-2 installation with branch-owned scopes, and the phase-labelled SSR setup-pruning contract; not full authored CE parity or the M09 exit.
---

# M09-2c: intrinsic event/ref channels on the generated leaf

Date: 2026-11-14. Status: **bounded implemented — LOCAL review in progress.**
Baseline: merged `main@089ace0a8`. Scope: compiler-private codegen only; no new
author callback API, runtime module, package export or version change.

This slice admits the existing JSX `onClick` / `ref` attributes on **intrinsic**
elements of a generated island element. It reuses the class path's ownership
idioms instead of inventing a second callback mechanism: listeners are
`addEventListener` + `LifetimeScope.add(remove)`, and a ref is
`(element) => void | Unsubscribe` with the unsubscribe and `ref(null)` run on
detach.

## What landed

- **Frontend mode** (`function-frontend.ts`): `event` and `ref` dynamic
  attributes lower in `handler` (attach-once) mode: reads recorded, no reactive
  dependencies. Expression-local bindings (handler/ref parameters, nested
  locals) are not host reads (`scope-resolution.ts`), so
  `onClick={(event) => …}` / `ref={(el) => …}` do not create `requireBinding`
  lookups for their own parameters.
- **Admission split** (`generated-leaf/generate.ts`): intrinsic channels admit
  `event`/`ref`; component-reference props keep the previous three channels
  (a child callback/ref prop stays a second-API refusal). Custom-element hosts
  and list entry templates stay refused: the host contract / the M06b2c
  per-entry update hook own those shapes.
- **Installation** (mount + claim): handler/ref values are evaluated once and
  validated callable BEFORE any listener/ref side effect; listeners are owned
  by the mount/claim scope, refs queue the class-path detach (unsubscribe when
  callable, then `handler(null)` in a `finally`). Claim installation is emitted
  only in the phase-2 tail after the structural mismatch walk, so a claim
  mismatch installs nothing; a throwing later step is released by the existing
  owner rollback (`claimRecipe` rollback / shell connect catch) while borrowed
  DOM is retained — bounded, nontransactional.
- **Coded-error dialect**: the two invalid-callable failures are
  `OpenElementError`s built by the shared internal `leafRuntimeError` helper
  (`claim-invariants.ts`) as `frameworkError(code, locatedDetail(detail,
  origin), { phase: 'csr' })`, with the authored
  `(authored file:line:column)` suffix from the ONE compile-time `originArgs`
  writer. Codes stay internal identities (`OEIR_LEAF_EVENT_HANDLER_INVALID`,
  `OEIR_LEAF_REF_HANDLER_INVALID`); no public catalogue growth.
- **Conditional branches**: event/ref inside a conditional branch ARE admitted
  (deliberate widening over the class lane's narrower branch refusal). The
  installation is branch-owned: mount/claim activation runs under the branch
  scope, a toggle detaches the listener/ref through that scope, and re-activating
  the branch installs exactly once. List entry templates, custom-element hosts
  and component-reference props remain refused.
- **SSR exclusion and setup pruning**: event/ref render no bytes and are skipped
  by both producers, preserving the M08-1a static `__ssr()` no-argument form and
  bytes. Dynamic SSR declares local setup resources only when the server output
  transitively reads them (dynamic text/attribute/boolean, condition/list
  expressions, component-reference prop records, insertion-site/children recipe
  targets and their recipe bodies); a local reachable only from a client-only
  channel is pruned, surviving locals keep authored order. This is a
  **phase-labelled evaluation contract**, recorded in
  [`jsx-value-and-children-model.md`](./jsx-value-and-children-model.md) §4.2a:
  handler-only setup side effects are 0 in SSR and 1 per client mount/claim;
  server-read local side effects are 1 in SSR as well.
- **Ref cleanup semantics** (class-path parity): attach calls the handler with
  the element; detach calls the returned cleanup (when a function) and then
  `handler(null)` even when the cleanup throws; reconnect re-attaches under the
  fresh claim scope.

## Refusals / non-claims

- Imported/module-function handlers and closures over owned signals remain
  **unsupported in the generated-element lane**: they are host bindings and the
  existing `OEIR_GENERATED_ELEMENT_UNBOUND_BINDING` gate refuses the module. No
  fake binding/import channel and no production wiring is claimed.
- No component-reference event/ref props, custom-element host handlers/refs,
  per-item handlers in list entry templates, listener replacement/update
  semantics, SSR host-attribute serialization (M11), forms, styles, event
  catalogue or class-lane changes. Class semantics are the regression baseline
  and were not edited.
- One browser engine (Chromium), LOCAL evidence; not the M13 matrix, not the
  M09 exit and not a release-qualification claim.

## Evidence (LOCAL, branch `feat/m09-event-ref-impl`)

- Node contract:
  [`generated-leaf.event-ref.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-leaf.event-ref.test.ts)
  — admission/refusals, frontend modes, expression-local bindings, coded
  validation ordering, ref attach/detach, SSR exclusion + transitive
  reachability (component-ref props, children recipe, insertion target, typed
  condition), conditional branch install shape, claim phase-2 ordering, carry
  refusals, M08 shape regression.
- Chromium vertical:
  [`generated-element.event-ref.browser.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.event-ref.browser.test.ts)
  — SSR parse → claim → listener/ref → reconnect → dispose; CSR mount/reconnect;
  CLI, claim-mismatch no-install and phase-2 rollback; coded-error shape/
  phase/origin; conditional toggle detach/reinstall exactly once (mount and
  claim paths); SSR 0 / CSR 1 setup-phase counters.
- Regressions/gates: full compiler/element/router projects, M08 S2/maps suites,
  `vp run check`, `generate:all`, interface snapshot, docs-index and seams
  checks (recorded in the outside implementation report).

## Seam

Registered in [`seams.md`](./seams.md) as "Intrinsic event/ref installation on
the generated leaf (M09-2c)": the generator owns admission/install/SSR-pruning
emission; the shell owns scope disposal; the runtime claim helpers own the
coded-error formatter. Consumer-form guards are the two test files above.
