# ADR-0125: Hydration Does Not Serialize or Cache the SSR Instance

- Status: ACCEPTED (recorded on the v0.42.0-alpha.15 train, #891)
- Date: 2026-08-08
- Builds on: #891, #631 (hydration-mismatch diagnostics), ADR-0067 (signal-native hydration)

## Context

During DSD hydration, OpenElement re-derives the VNode tree to collect
event markers and Show/For branch tokens, then compares the derived tree
against the SSR DOM (`HydrationScope.hydrate` →
`collectEventBindings` → `visitComponentBranch`,
`packages/element/src/internal/core/event-hydration.ts:142-153`).
Component branches are re-instantiated with `new tag()` and `render()` is
invoked on a fresh instance, never the SSR instance. If `render()` is
impure (Date.now, Math.random, async-init state), the derived VNode
diverges from the SSR DOM and the mismatch guard degrades the whole shadow
root to a client-side re-render.

#891 proposed three fixes:

1. Serialize the SSR VNode tree into the DSD output (e.g. a
   `<script type="application/json" data-open-vnode>` sibling).
2. Cache the SSR instance in a WeakMap keyed by host element, restored on
   upgrade.
3. Document the constraint: component `render()` must be pure.

## Decision

1. **REJECTED — VNode serialization.** `VNode.tag` is
   `string | ComponentFn | ComponentCtor | symbol`
   (`packages/element/src/internal/protocol/vnode.ts:26`), `props` carries
   live event-handler functions, and `ref` is a callback. A JSON projection
   cannot carry any of these, so serializing the "SSR VNode" requires a
   second, serializable VNode dialect — a protocol redesign, not a bug fix.
   Worse, the projection is the wrong payload: the only marker-relevant
   data (eids + branch tokens) is already serialized in the DSD DOM
   (`data-eid` attributes, `<!--oe-branch:...-->` comments), and the
   mismatch guard exists precisely because the client VNode may legitimately
   differ (signal drift). Hydration from the SSR snapshot would bind stale
   handlers to live signals — the guard exists to catch this, not to
   bypass it.
2. **REJECTED — instance caching.** SSR runs in the server process; DSD
   hydration runs in the client process. There is no shared heap, so the
   WeakMap is empty at hydration by construction. Within one JS context
   (OpenElement's own DSD path) the real upgraded element's `render()` is
   already invoked on the live instance (`open-element-hydration.ts:33`,
   `open-element-render.ts:53,88`) — the re-instantiation that remains is
   only for nested branches, which have no SSR-side counterpart client-side.
3. **ACCEPTED — documented purity constraint.** `render()` must be a pure
   function of (declared props, attributes, declared signals) — the same
   contract every hydration framework (React, Solid, Preact) imposes. The
   guarded degrade path stays as the safety net for violations; #631 tracks
   the diagnostics that surface them.

## Consequences

- The Element architecture contract carries an explicit render-purity
  requirement.
- Authoring guidance documents the constraint.
- No serializer, no wire-format change, no WeakMap cache. The mismatch
  degrade path (correctness-preserving) remains the response to render
  impurity; per-branch localization of the degrade was considered and
  deferred — the degrade is already correct, and localization is a
  rewrite of the marker-alignment pass (M2/L5 machinery) with no
  correctness gain.

## Evidence

- `visitComponentBranch` re-instantiation: `event-hydration.ts:142-153`
- VNode live references: `vnode.ts:26` (`tag`), `props` handlers, `ref`
- Live-instance render on the OpenElement path: `open-element-hydration.ts:33`
- SSR-side instantiation: `render-dsd.ts:114`, `render-ir.ts:406`
- CSR instantiation: `jsx-render-dom.ts:463`
