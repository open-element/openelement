---
status: active
topic: M09-shadow generated-element root, DSD and claim parent
summary: The generated-element shell's root resolution (light/open/closed), declarative shadow DOM takeover, native slots, delegatesFocus and the real-ShadowRoot claim-parent rule; a bounded LOCAL slice record, not the M09 exit.
---

# M09-shadow: generated-element root, DSD and claim parent

Date: 2026-11-13. Status: **bounded implemented — not the M09 exit.**
Baseline: `origin/main@fcb8d4ae` (the #1771 input/void squash merge); the
M09-0 shell is #1768, `735749b1c`. Evidence is LOCAL: one Chromium engine
(147, Playwright 1.59.1), the focused compiler tests, the full element project
and the source gates. This is not M09-1 registration, not the style consumer,
not the M09-2 platform surface and not the M13 browser matrix.

## Landing scope

| Path | Role |
| --- | --- |
| [`shell.ts`](../../packages/element/src/internal/compiled/generated-element/shell.ts) | Descriptor gains `root?: RootMode` and `delegatesFocus?`; the resolved root is retained on element state and is the claim/mount parent. |
| [`root.ts`](../../packages/element/src/internal/compiled/generated-element/root.ts) | New browser-safe leaf: the one root resolver (`light`, `shadow-open`, `shadow-closed`), coded failures, and the single `ElementInternals` discovery record for closed roots. |
| [`dsd.ts`](../../packages/element/src/internal/compiled/dsd.ts) | New browser-safe leaf: canonical `serializeDsdAttributes` and `serializeShadowTemplate`; typed options only, no raw-markup prefix. |
| [`server/index.ts`](../../packages/element/src/internal/compiled/server/index.ts) | Deletes the private DSD attribute copy and imports/re-exports the canonical leaf; wire bytes are unchanged. |
| [`claim-invariants.ts`](../../packages/element/src/internal/compiled/runtime/claim-invariants.ts) | `isClaimParentShadowRoot` uses the native `ShadowRoot.prototype.host` brand; `assertElementInHtmlNamespace` accepts a real ShadowRoot parent and validates its host and the host's ancestors. The emitted name is unchanged, so no generator edit is needed. |
| [`static-sibling-ranges.ts`](../../packages/element/src/internal/compiled/runtime/static-sibling-ranges.ts) | The static directory parent is `Element \| ShadowRoot`; a bare `DocumentFragment` is still refused. |
| [`generated-element.shadow.test.ts`](../../packages/compiler/__tests__/semantic-ir/generated-element.shadow.test.ts) | 20 focused tests: canonical DSD bytes/sharing, real Vite module graph, open/closed DSD and CSR, slots, focus delegation, reconnect, ownership and cross-realm brand checks. |
| `docs/architecture/m09-shadow-dsd.md` | This record. The seams row and the generated docs index entry land with it. |

No package barrel, `package.json`, `tsconfig`, workflow, allowlist, progress
ledger, semantic test matrix or public-interface snapshot changes in this slice.

## Root resolution

`createGeneratedElementClass` resolves the root once, before the recipe is
created and before `claimRecipe`/`insertRecipe`, then keeps the same root for
the element lifetime (disconnect, reconnect, retry and teardown):

- **light** — the host is the parent. An existing `host.shadowRoot` is a coded
  `OEIR_SHELL_ROOT_MODE_MISMATCH`; light never calls `attachInternals()`.
- **shadow-open** — an existing `host.shadowRoot` is adopted after its `mode`
  and `delegatesFocus` facts are checked. A direct
  `template[shadowrootmode]` that the parser did not adopt is
  `OEIR_SHELL_DSD_NOT_ADOPTED` before any attach; otherwise the shell calls
  `attachShadow({ mode: 'open', delegatesFocus })`.
- **shadow-closed** — discovery is only `attachInternals().shadowRoot`; the
  internals instance is stored in one shell-owned record and reused, so a retry
  cannot consume the one-shot channel again. An unreachable or already-consumed
  channel is `OEIR_SHELL_CLOSED_ROOT_UNREACHABLE`. The shell never calls
  `attachShadow()` to guess: on Chromium a same-mode declarative root would be
  cleared, and an imperative or different-mode root throws. Both outcomes are
  unsafe discovery, so they stay fail-closed.
- Platform throws from `attachShadow()` are wrapped as
  `OEIR_SHELL_ATTACH_SHADOW_FAILED` with the original error as `cause`; a
  `mode`/`delegatesFocus` drift is `OEIR_SHELL_ROOT_OPTION_MISMATCH`.

A coded root failure keeps the resolved root and the existing content, creates
no projection and no generated DOM write, and reports the same identity on
retry. The slice does not promise zero allocation or zero writes: pre-upgrade
property reconciliation may already have reflected an attribute before the root
fails, and that is tested rather than claimed away.

The first connect observes whether a generated region exists exactly once
(light children, or an adopted shadow root's children). Reconnect and teardown
use that stored fact, never the current `childNodes`: after `dispose(true)` the
root may legitimately retain foreign nodes, and they must not be mistaken for
server-rendered content. A shell-created root starts empty and mounts; an
adopted DSD or imperative root is claimed.

Host light children are slotted content for a shadow element. They are never
claimed, never recorded as owned and never deleted. `dispose(true)` removes only
the recorded owned range and the root itself is retained.

## Claim parent: a real ShadowRoot, never a DocumentFragment

The claim parent rule accepts exactly a real platform `ShadowRoot`. The check
captures the native `ShadowRoot.prototype.host` getter once at module load and
applies it with `Reflect.apply`; the getter reads the platform's internal slot,
so a `DocumentFragment` cannot pass by spoofing `Symbol.toStringTag`, `host` or
`mode`, and a real ShadowRoot from another realm still passes. With no
`ShadowRoot` global (a DOM-less Node import) the predicate fails closed; there
is no polyfill and no duck-typed fallback.

For an accepted root the host and the host's element ancestors take the place
of an element parent's ancestors. A bare fragment is still rejected with the
existing internal `OEIR_LEAF_CLAIM_MISMATCH`. The directory consumer uses the
same predicate and keys its reservation by the ShadowRoot or element parent, so
two opens of one root share one consumption record.

## One canonical DSD spelling

`dsd.ts` is the ONE DSD spelling. The old server serializer imports it instead
of carrying a private `serializeDsdAttributes` copy, and the generated-element
producer primitives use the same `serializeShadowTemplate`. The leaf imports
only the shared validation error from `runtime/values.ts`; it is browser-safe
and imports no server, kernel, shell or executor module. It emits no `<style>`,
`<link>` or other raw prefix: style delivery remains the separate typed
link-resource slice.

Publication boundary: `dsd.ts` lives in `src/internal/compiled/`, which is
inside the element package's packed `src/**` set, and `server/index.ts` imports
it, so the packed server entry can reach the leaf. The experimental
`src/internal/compiled/generated-element/` directory (`shell.ts`, `root.ts`) is
still excluded from the published files until M09-1 wires the first official
consumer; that exclusion is unchanged here. No new public export is added, so
the public interface snapshot is unchanged.

## Evidence

```sh
node_modules/.bin/vitest run --project compiler \
  packages/compiler/__tests__/semantic-ir/generated-element.shadow.test.ts   # 20/20
node_modules/.bin/vitest run --project compiler \
  packages/compiler/__tests__/semantic-ir/generated-element.shell.test.ts    # 21/21
node_modules/.bin/vitest run --project element                               # full project
./node_modules/.bin/tsc --noEmit -p packages/element/tsconfig.json
./node_modules/.bin/tsc --noEmit -p packages/compiler/tsconfig.json
```

The slice was independently reviewed; the five blockers from that review
(B1 platform-fact wording, B2 foreign nodes after `dispose(true)`, B3
zero-write promise, B4 raw `prefixMarkup` sink, B5 old-server/canonical-leaf
byte and error equivalence) are fixed and covered by the focused tests above.
That review does not authorize an M09 exit and this record does not claim one.

## Residuals (not fixed here)

- **R7 nested shadow ancestor namespace** — `ShadowRoot.parentNode` is `null`,
  so a shadow boundary still truncates ancestor traversal in the claim-parent
  rule. This is pre-existing and unchanged.
- **Light descriptor + closed DSD** — a light descriptor cannot see a closed
  declarative root, so it cannot detect that producer/build mismatch.
- **Forms** — a closed root consumes `ElementInternals`; a host whose internals
  were already attached fails closed. No `formAssociated`, reset or validation
  hand-off is added.
- **Styles, M09-1 emitter/registration, M09-2, M13** — all remain open. This is
  a LOCAL slice record, not an exit criterion.
