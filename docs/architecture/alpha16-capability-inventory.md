---
status: active
topic: Alpha16 capability inventory (P5 evidence)
summary: The tracked capability inventory §13.5 requires — what the retiring class path provided, what replaces it on the generated path, and each replacement's state. Not a sign-off; P5 stays unclaimable until the owner signs; the final-SHA matrix/verdict rows are re-recorded in the 2026-11-20 remediation.
---

# Alpha16 capability inventory

The tracked capability inventory §13.5 requires for P5: what the retiring class
authoring path provided, what replaces it on the generated path, and the state of
each replacement at a named SHA. The final-SHA matrix is the `class authoring`
column beside the `generated lane` column — a capability counts as MIGRATED only
when both columns describe a working surface, never when only the replacement
exists.

**Status of this document.** It is tracked and reproducible; it is **not** a
sign-off. §13.5 requires four things — this inventory, the final-SHA matrix, the
migration note and the owner sign-off — and the signature is the owner's to give.
Until it is given, P5 is not claimable and Alpha16 release qualification is not
openable. Nothing below should be read as a release claim.

**Re-record note (2026-11-20).** The final-SHA matrix and the verdict rows are
re-recorded in the 2026-11-20 remediation (see the `p1-applicability-record`
re-record); this file carries the mechanisms and the capability states, and the
verdict paragraph below carries the 2026-11-20 corrections to the 2026-11-19
reading. No new numbers are asserted here — Wave 2 of the remediation owns the
measured re-record.

**Evidence rule.** Every row cites the mechanism by file and the acceptance by
test name, and the numbers are per-SHA. A capability is `MIGRATED` when the
generated lane delivers the same SEMANTICS (not merely a same-named export), with
the parenthesised note naming what the class path did that the generated path now
does differently or refuses.

**Verdict (2026-11-19; corrected 2026-11-20).** Four capabilities have a full
replacement: lifecycle (root scope, extended by the depth-1 nested/hostless
hooks and the connection-scope `env` helper), context, refs and the
per-component property/attribute channel. The error boundary is **PARTIAL /
OWED-ALPHA17**: the capture points are delivered (connect/claim, plus
update/refresh and event dispatch sharing the existing `guardUpdate` sink) and
the SSR fallback is deferred to Alpha17 by the owner-approved plan amendment
(`alpha16-18-execution-plan.md` §18.3), so the row is not a full replacement.
Form participation is PARTIAL: the bounded mechanism is delivered and its
non-claims are recorded. `useHost` is FUTURE/OWED. Everything listed under
"Still owed" is genuinely unfinished, not deferred paperwork. The final-SHA
matrix and the verdict rows are re-recorded in the 2026-11-20 remediation (see
the `p1-applicability-record` re-record); this file asserts no new numbers.

## Slice index (§13.2 obligation → row)

§13.2 names five Alpha16b obligation slices. The rows above are organised by
capability, so this index maps each slice ID to the rows that satisfy it — a
reader holding the plan should not have to infer the correspondence.

| Slice | Capability | Rows in this document | State |
| --- | --- | --- | --- |
| `16b-LC` | Class lifecycle (CAP-03) | author lifecycle: connect / disconnect / property change | **PARTIAL** — root scope delivered; depth-1 nested/hostless hooks and the connection-scope `env` helper are delivered (migration note 2026-11-16 amendments), while depth ≥ 2, recipe/list placement, non-retained targets and pre-DOM timing remain in "Still owed" |
| `16b-EB` | Error boundary (CAP-05) | error boundary | **PARTIAL / OWED-ALPHA17** — capture points delivered (2: connect/claim; update/refresh + event dispatch share one `guardUpdate` sink); **no SSR fallback** — deferred to Alpha17 (execution plan §18.3), so not MIGRATED (corrected 2026-11-20) |
| `16b-CTX` | Context (CAP-09) | context provider / consumer | **MIGRATED** (`e8ea72b95`) |
| `16b-REF` | Refs (CAP-11) | node refs | **MIGRATED** (`d135576d0`) |
| `16b-MN` | Migration note (CAP-26) | this document plus `16b-migration-note.md` | **TRACKED** — both are tracked and indexed; the owner sign-off is the remaining §13.5 item |

## Capability map

| Capability | Class authoring (retiring) | Generated lane (replacement) | State |
| --- | --- | --- | --- |
| Component declaration | `@element('tag')` + `class X extends OpenElement` | local default-exported function + `defineIslandConfig`/`defineComponentConfig` sidecar (`root`, `tag`, `properties`) | **MIGRATED** — the compiler emits the `OpenElementBase` subclass; island admission refuses a re-export default (`lane-declined / compiler-declined`) so the body must live in the admitted module |
| Reactive render | `render()` returning compiled JSX | function component returning compiled JSX; every sink is a compiled slot | **MIGRATED** (depends on emission: a value bound to a local identifier yields ZERO refreshes while the same expression inlined yields two — R1b, pinned by a regression test) |
| Derived values | `computed(() => …)` | none — values are inlined at each sink | **DELIBERATELY ABSENT** (a computed closure cannot track the shell's coarse `propsChanged`, so it would go permanently stale; adding it is a new capability, not a port) |
| Property / attribute channel | `@property({ reflect, attribute })` | `properties` row in the sidecar: `{ reflect, attribute, default }` | **MIGRATED** — primitive rows convert through the same `convertFromAttribute`/`coercePropertyValue` leaves |
| Non-primitive property wire | runtime property assignment on the instance | `data-oe-prop-seed` host attribute carrying JSON (ADR-0182 D-18c), consumed once by `applyGeneratedPropSeed` | **MIGRATED** — `array`/`object` only; `trustedHtml` is excluded because the brand is object identity in a `WeakSet` and any wire transfer would re-forge trust from bytes |
| Author lifecycle: connect | `connectedCallback()` | `onConnect(env)` intrinsic, erased by the compiler into the claim/mount prologue | **MIGRATED** (runs BEFORE the generated region exists — a handler that scans the rendered subtree must defer one macrotask) |
| Author lifecycle: disconnect | `disconnectedCallback()` | `onDispose(env)` plus the connection-scope `abort` signal | **MIGRATED** (a disconnect keeps the generated DOM, LC-0, so a teardown that wrote state must restore the declared seed or the next claim fails) |
| Author lifecycle: property change | `attributeChangedCallback` / property setter | `onPropertyChange({ host, signal, states, name, value })` | **MIGRATED** |
| Error boundary | static `isErrorBoundary` + `catchError()` | `onError(env)` with the shell's capture points (connect/claim; update/refresh and event dispatch share the existing `guardUpdate` sink); **no SSR fallback** — deferred to Alpha17 (execution plan §18.3) | **PARTIAL / OWED-ALPHA17** — the capture points are delivered, but the SSR fallback is a named Alpha17 carry, so the row is not MIGRATED; no handler registered keeps the pre-existing rollback-then-rethrow byte-identically (corrected 2026-11-20) |
| Context provider / consumer | `provideContext(host, token, value)` + subscription | `provideContext(token, () => value)` / `useContext(token)` over the generated owner tree, hostless owners included | **MIGRATED** (`e8ea72b95`) — nested providers shadow, sibling subtrees are isolated, a declared-property commit re-reads the thunk, reconnect republishes from retained intents, and a consumer-reading component IS server-renderable (the scope rides the producer argument list, so per-render isolation is structural) |
| Node refs | `@query`/manual `querySelector` in `connectedCallback` | `ref(cb?)` declaration intrinsic handed to the existing `ref` JSX channel; `current` survives mount/claim/reconnect | **MIGRATED** (`d135576d0`) — no second attachment mechanism; `current` is deliberately not reactive (a tracked-slot read is refused with `OEC9042`) |
| Form participation | `static formAssociated` + `ElementInternals` access | sidecar `formAssociated` + the shell's form controller; value/required/disabled with `required → valueMissing` | **PARTIAL** (`fa6e5232d`) — the slice declares a "host access gap" non-claim and does not reach full `open-input` parity; full constraint mirroring (type/email, minlength) is a deferred sub-obligation, not an exception |
| Slots / light DOM | `static styles`, `<slot>` in the template | compiler-emitted slot anchors (`oe:s:<ordinal>:<hex>`) plus the light-root producer; `projectedChildren` substitution walks comment tokens only | **MIGRATED** |
| Styles | `static styles = css\`…\`` | file-based `.oe-style.css` imports (the string-template tag retired with #1558) | **MIGRATED** — one delivery shape; the generated root joins the same `themeManager` broadcaster |
| Registration / packaging | `customElements.define` at module scope | compiler-emitted Native Custom Element tail + `generated-manifest.json` / `custom-elements.json` | **MIGRATED** |

## Generated-only capabilities (no class counterpart)

These exist BECAUSE the generated lane is a different execution model. They are
not ports and have no retiring counterpart.

| Capability | Mechanism | Note |
| --- | --- | --- |
| Executor-free page floor | `@openelement/element/document-services` + the narrow `leaf-runtime` entry | A page whose islands are all generated-lane emits no `element-services` loader, so the document-level services need a surface that reaches no executor module |
| Claim verification | `assertStaticAttributeSeed` + `assertGeneratedRootOptions` | A runtime write onto a claimed static attribute fails with `OEIR_LEAF_CLAIM_MISMATCH` rather than silently diverging from the rendered bytes |
| JSON prop seed | `data-oe-prop-seed` (ADR-0182 D-18c) | The one channel a non-primitive declared row crosses SSR→claim on |

## Still owed (stated, not deferred as paperwork)

| Item | Why it is open |
| --- | --- |
| `16b-LC` depth ≥ 2 nested hooks, recipe/list placement and pre-DOM timing | Root lifecycle, depth-1 nested/hostless hooks and the connection-scope `env` helper are delivered (migration note 2026-11-16 amendments); the remaining placements are still refused (`OEIR_LEAF_INVALID_ARTIFACT` / `OEC9041`), so the slice stays PARTIAL. |
| `16b-EB` SSR fallback | Deferred to Alpha17 as a named carry by the owner-approved plan amendment (`alpha16-18-execution-plan.md` §18.3) — not a §13.3 exception and not delivered by the capture points. |
| `useHost` host-element accessor (D-17b) | **FUTURE/OWED** — listed in ADR-0182 D-18b-4 and execution plan §17.1, not implemented; the migration note's 16b-REF record says "No `useHost`-style host accessor (a separate D-17b item)". It is not part of the experience edition's delivered surface, and the 2026-11-20 remediation records the status without implementing it; `env.host` remains the only delivered host access. |
| Depth ≥ 2 generated owner tree | Refused with `OEIR_LEAF_INVALID_ARTIFACT`; ADR-0181 owns depth-1 retention and has not extended it. |
| Form constraint mirroring | The bounded mechanism covers `required → valueMissing`; type/email/minlength and the full input parity are a named deferred sub-obligation. |
| Reactive refs and component refs | `ref.current` is not reactive by design (a tracked read is refused), and component (non-element) refs stay out of scope per ADR-0182 D-18b-5. |
| Server-side context reactivity | A consumer value resolves once per producer call. There is nothing to react to before bytes leave, so this is a property of SSR rather than a gap — recorded so a future reader does not read it as one. |

## How a reader verifies a row

Each `MIGRATED` row names a mechanism by file and an acceptance by test. To
re-check one at a candidate SHA:

```sh
vp run --no-cache --fail-if-no-match --filter @openelement/compiler test
vp run --no-cache --fail-if-no-match --filter @openelement/element test
vp run --no-cache --fail-if-no-match --filter @openelement/router test
node tools/repo/check-browser-entry-graph.ts www/dist/client/.vite/oe-browser-entry-graph.json
```

The last command is the P1 evidence; the three suites carry the capability tests.
A row that cannot be reproduced from these commands is a defect in this document.
