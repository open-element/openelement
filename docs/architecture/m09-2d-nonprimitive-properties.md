---
status: active
topic: M09-2d property-only non-primitive retention on the generated element
summary: Bounded array/object/trustedHtml property retention (plan §14): property-only rows, no attribute/JSON wire, fresh-literal defaults per instance and SSR render, the existing brand, an in-process SSR resolver; no server→client seed.
---

# M09-2d: property-only non-primitive property retention

Date: 2026-11-14. Status: **bounded implemented — LOCAL review pending.**
Baseline: merged `main@089ace0a8`. Scope: compiler-private metadata + generated
element shell only; no new author callback API, no attribute/JSON channel, no
converter DSL, no server→client seed.

This slice retains the three non-primitive props live consumers already declare
as property-only (`attribute: false`): `array` (`T[]` / `Array<T>`), `object`
(opaque shape) and `trustedHtml` (the existing brand). It is plan §14's
retention slice, not a generic conversion system.

## What landed

- **Sidecar/scanner and compiler readers.** Both readers of the authored
  `openElement.properties` table accept `attribute: false` explicitly plus a
  static default: a bounded recursively literal array/object graph, or a
  canonical `trustedHtml('<string literal>')` call. An omitted attribute (kebab
  derivation), a string attribute or `reflect: true` refuses; missing defaults
  refuse; spread/identifier/function/`__proto__` defaults and dynamic defaults
  refuse codally. The two readers stay one vocabulary with the drift guard.
- **Typed-member grammar.** `readTypedProps` admits array/object/trustedHtml
  forms: `T[]`/`Array<T>` where `T` is a primitive keyword, an inline object
  type literal or a same-module single non-generic acyclic object ref; opaque
  object literals/local refs; and exactly the canonical named `TrustedHtml`
  type import from `@openelement/element` (no alias, no shadowing). Imported
  value shapes, tuples, `ReadonlyArray`, nested arrays and nested `TrustedHtml`
  stay refused.
- **Descriptor + emitter.** Non-primitive rows spell `attribute: null`,
  `reflect: false` and one of: a generated module-level fresh-literal factory
  (`const __oePropertyDefaultN = () => (graph);`), or the trustedHtml literal
  HTML string. The descriptor never holds a mutable module-level default graph;
  primitive/no-table rows keep byte identity. The generated `__ssrHost` folds
  its in-process props through the new shell helper
  `resolveGeneratedElementProps(descriptor, props)`.
- **Shell runtime.** Normalization accepts only the property-only descriptor
  shape; each array/object default factory runs once per element instance (state
  creation, not per connect) and once per SSR render; `trustedHtml` defaults are
  branded per materialisation. Caller writes preserve the caller's reference
  (no clone), bump `propsChanged`, and pass shape guards: array/plain-object for
  array/object, the internal brand predicate for `trustedHtml` (a plain
  `{html}` object or string is never promoted). `observedAttributes` excludes
  the rows by construction.
- **Brand/sink safety.** `trustedHtmlValue` and the innerHTML sink guard are
  untouched; the only new brand API is the internal `isTrustedHtmlValue`
  predicate beside the existing `WeakSet`. `trustedHtmlValue(plain)` still
  throws, and no path turns a plain object or string into raw HTML.
- **SSR folding.** `resolveGeneratedElementProps` materialises fresh defaults
  per render for omitted rows and passes supplied array/object values by
  reference; supplied trustedHtml values must carry the brand. Host bytes carry
  no attribute or JSON for these rows.

## Pre-upgrade / claim semantics (the reproduced red)

Investigation of the checkpoint's pre-upgrade claim-refresh failure found this
exact reproduction: an SSR-default host (`default: [{id:'seed', …}]`) with a
pre-upgrade own `events = [{id:'pre', …}]` write, then upgrade+append, throws
`OpenElementError` code `OEIR_LEAF_CLAIM_MISMATCH`, message
`server entry key has no client item at /0/1/0/each (authored …)`. The shell
retains the borrowed server DOM, keeps the client value by reference, and
installs no projection/subscription, so a later write cannot repaint it.

Root cause is the bounded claim contract, not a defaults/clone/brand bug: the
shell reconciles pre-upgrade own data properties BEFORE claim (the landed
primitive rule), so the live props record differs from the server-rendered
structure; the leaf's list claim validates server entry keys against live
client props and fails closed. There is no server→client non-primitive seed, so
this mismatch cannot be repaired without inventing the M11 transport. The
correct behavior is fail-closed: no silent structural adoption, no partial
installation, borrowed DOM retained.

The design's pre-upgrade evidence obligation is the **CSR mount** path (no SSR
bytes): parser-created unknown element, own array/object/trustedHtml properties,
then upgrade. That path is covered by the Chromium vertical and works: values
are preserved by reference, the DOM renders from them, later writes refresh,
reconnect retains, and both `dispose(false)` (owned DOM stays) and
`dispose(true)` (owned region removed) hold. A pre-upgrade value whose structure
matches the claimed SSR structure also wins and refreshes; a structurally
divergent one fails closed as above.

## Hardening from the self-risk review

- **Property names are canonical dangerous keys.** `__proto__`, `constructor`
  and `prototype` are refused as property names in every authored reader
  (router scanner, compiler sidecar/typed-props, runtime `defineIslandConfig`)
  and in the shell descriptor, through the canonical protocol
  `forbiddenSinkReason('prop', …)` predicate — no local denylist. The scanner's
  property table and the SSR resolved-props record are null-prototype records,
  and rows are written with `Object.defineProperty`, so a name can never mutate
  a record's prototype. An evaluated default object carrying an own dangerous
  key (e.g. `JSON.parse('{"__proto__":…}')`) is refused by the runtime guard;
  default-graph literal keys already refuse `__proto__` in both readers. Tests:
  compiler dangerous-name refusals, scanner/authoring own-key and prototype
  checks, drift corpus dangerous rows, shell descriptor refusals.
- **SSR folding keeps the approved per-read props contract.** The resolved
  record is getter-backed: a supplied row delegates to the caller's props on
  every read (array/object references stay caller-owned; trustedHtml is
  brand-checked on read), the fold itself executes no supplied getter, and an
  unused supplied getter never runs. Omitted rows use a lazy memoised default:
  the generated factory/brand runs at most once per render and only when read;
  an unused declared row is never materialised. The client shell still
  materialises each instance's default exactly once at state creation (reads
  reuse it). Tests pin SSR Host getter counts (eager fold: 0, used rows per
  read, unused 0), Node lazy-default counts, and the per-instance client count.
- **Nested `TrustedHtml` is refused until a type-honest carrier exists.**
  Opaque object/array element shapes are scanned (including local alias/interface
  chains and canonical aliased type imports) and a nested canonical brand
  reference refuses with `PROPS_TYPE_UNSUPPORTED`; the top-level property-only
  `trustedHtml` member remains the only admitted brand row. The scanner now
  rejects type-only `trustedHtml` imports exactly like the compiler, and the
  drift corpus covers canonical aliases, type-only forms and shadowed callees.
- **Defensive descriptor validation.** The shell now fails closed on an invalid
  primitive default carrier and on duplicate descriptor property names instead
  of silently zeroing/overwriting; generated descriptors are unaffected.

## Refusals / non-claims

- No server→client props seed/JSON wire; M11 owns a future transport. Host bytes
  never carry these values.
- No attribute channel, reflection, string→array/object JSON parsing or
  converter DSL; the conversion leaf is untouched.
- No imported/cross-module value shapes, tuples, `ReadonlyArray`, nested
  `TrustedHtml`, generic local refs, merged declarations or cycles.
- `innerHTML`/`html` sink, forms, styles and event/ref channels remain out of
  this slice; class-lane semantics are the regression baseline and were not
  edited (events fix work is a separate branch).
- One browser engine (Chromium), LOCAL evidence; not the M13 matrix, not the
  M09 exit and not a release-qualification claim. Internal shell subpath export
  `resolveGeneratedElementProps` moves `interface:snapshot`; it is not a public
  author API.

## Evidence (LOCAL, branch `feat/m09-nonprimitive-properties`)

- Node grammar/emitter/SSR-helper contract and the runtime brand/shape guards:
  [`generated-element.nonprimitive-properties.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.nonprimitive-properties.test.ts).
- Chromium vertical: deep-fresh instance isolation (all depths, mutation
  independence, branded defaults), SSR claim content, caller writes/reconnect,
  CSR pre-upgrade mount + write/reconnect/dispose(false|true), matching and
  structurally-divergent pre-upgrade claim paths, plain-`{html}` rejection and
  no attribute/JSON wire:
  [`generated-element.nonprimitive-properties.browser.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.nonprimitive-properties.browser.test.ts).
- Two-reader drift: [`island-metadata-drift-guard.test.ts`](../../packages/router/__tests__/island-metadata-drift-guard.test.ts).
- Gates/snapshot/pack evidence: recorded in the outside implementation report.

## Seam

Registered in [`seams.md`](./seams.md) as "Property-only non-primitive retention
on the generated element (M09-2d, plan §14)".
